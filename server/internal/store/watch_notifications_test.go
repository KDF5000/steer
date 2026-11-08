package store

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"os"
	"testing"
	"time"
)

func TestWatchNotificationsBindingAndDelivery(t *testing.T) {
	db := os.Getenv("STEER_TEST_DATABASE_URL")
	if db == "" {
		t.Skip("set STEER_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	st, err := Open(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	if err := st.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	wid := "watch-push-" + uuid.NewString()
	other := wid + "-other"
	for _, w := range []string{wid, other} {
		if err := st.EnsureWorkspace(ctx, w, "Push tests"); err != nil {
			t.Fatal(err)
		}
	}
	agent, err := st.CreateAgent(ctx, wid, Agent{Name: "Builder", RuntimeProvider: "test"})
	if err != nil {
		t.Fatal(err)
	}
	session := uuid.NewString()
	if _, err := st.EnsureSession(ctx, wid, session, "Task", agent.ID, nil, nil, nil, nil); err != nil {
		t.Fatal(err)
	}
	key, err := st.CreateWorkspaceAPIKey(ctx, WorkspaceAPIKey{WorkspaceID: wid, Name: "Watch", TokenHash: uuid.NewString(), TokenPrefix: "test", Scopes: []string{"tasks:read"}, CreatedByUserID: "test"})
	if err != nil {
		t.Fatal(err)
	}
	createTask := func() Task {
		t.Helper()
		_, _, task, err := st.SaveTaskRun(ctx, wid, session, agent.ID, "Request", uuid.NewString(), "running", Task{Source: "api"})
		if err != nil {
			t.Fatal(err)
		}
		return task
	}
	old := createTask()
	if _, err := st.pool.Exec(ctx, `UPDATE run_usage SET status='succeeded',completed_at=now()-interval '1 minute' WHERE relay_run_id=$1`, old.RelayRunID); err != nil {
		t.Fatal(err)
	}
	device := WatchPushDevice{ID: uuid.NewString(), WorkspaceID: wid, APIKeyID: &key.ID, BindingHash: "proof", AccountFingerprint: "account", Token: "token", Topic: "com.steer.watch", Environment: "sandbox"}
	if err := st.RegisterWatchPush(ctx, device); err != nil {
		t.Fatal(err)
	}
	if err := st.EnqueueWatchPush(ctx, device.Topic); err != nil {
		t.Fatal(err)
	}
	items, err := st.ClaimWatchPush(ctx, 10)
	if err != nil || len(items) != 0 {
		t.Fatalf("historical task notification: %+v %v", items, err)
	}
	task := createTask()
	if _, err := st.pool.Exec(ctx, `UPDATE run_usage SET status='failed',completed_at=clock_timestamp() WHERE relay_run_id=$1`, task.RelayRunID); err != nil {
		t.Fatal(err)
	}
	if err := st.EnqueueWatchPush(ctx, device.Topic); err != nil {
		t.Fatal(err)
	}
	if err := st.EnqueueWatchPush(ctx, device.Topic); err != nil {
		t.Fatal(err)
	}
	items, err = st.ClaimWatchPush(ctx, 10)
	if err != nil || len(items) != 1 || items[0].TaskID != task.ID || items[0].Device.WorkspaceID != wid {
		t.Fatalf("wrong delivery: %+v %v", items, err)
	}
	again, err := st.ClaimWatchPush(ctx, 10)
	if err != nil || len(again) != 0 {
		t.Fatal("active delivery lease was claimed twice")
	}
	if err := st.FinishWatchPush(ctx, items[0], false, false); err != nil {
		t.Fatal(err)
	}
	again, _ = st.ClaimWatchPush(ctx, 10)
	if len(again) != 0 {
		t.Fatal("failed delivery has no backoff")
	}
	impostor := device
	impostor.WorkspaceID = other
	impostor.BindingHash = "wrong-proof"
	impostor.APIKeyID = nil
	if err := st.RegisterWatchPush(ctx, impostor); !errors.Is(err, ErrWatchBinding) {
		t.Fatalf("binding hijack accepted: %v", err)
	}
	transfer := device
	transfer.WorkspaceID = other
	transfer.APIKeyID = nil
	if err := st.RegisterWatchPush(ctx, transfer); err != nil {
		t.Fatal(err)
	}
	if _, err := st.pool.Exec(ctx, `UPDATE watch_push_deliveries SET available_at=$2,lease_until=NULL WHERE device_id=$1`, device.ID, time.Now().Add(-time.Minute)); err != nil {
		t.Fatal(err)
	}
	again, _ = st.ClaimWatchPush(ctx, 10)
	if len(again) != 0 {
		t.Fatal("old workspace notification survived device transfer")
	}
	if err := st.RegisterWatchPush(ctx, device); err != nil {
		t.Fatal(err)
	}
	next := createTask()
	if _, err := st.pool.Exec(ctx, `UPDATE run_usage SET status='succeeded',completed_at=clock_timestamp() WHERE relay_run_id=$1`, next.RelayRunID); err != nil {
		t.Fatal(err)
	}
	if err := st.EnqueueWatchPush(ctx, device.Topic); err != nil {
		t.Fatal(err)
	}
	if _, err := st.pool.Exec(ctx, `UPDATE workspace_api_keys SET revoked_at=now() WHERE id=$1`, key.ID); err != nil {
		t.Fatal(err)
	}
	again, _ = st.ClaimWatchPush(ctx, 10)
	if len(again) != 0 {
		t.Fatal("revoked key still receives notifications")
	}
}
