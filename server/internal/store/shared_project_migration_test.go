package store

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func TestSharedProjectConsolidationMigration(t *testing.T) {
	db := os.Getenv("STEER_TEST_DATABASE_URL")
	if db == "" {
		t.Skip("set STEER_TEST_DATABASE_URL")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, db)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	tx, err := conn.Begin(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer tx.Rollback(ctx)
	schema := "shared_migration_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if _, err = tx.Exec(ctx, `CREATE SCHEMA `+schema+`; SET LOCAL search_path TO `+schema); err != nil {
		t.Fatal(err)
	}
	files, err := os.ReadDir("migrations")
	if err != nil {
		t.Fatal(err)
	}
	for _, f := range files {
		if f.Name() >= "000032" || !strings.HasSuffix(f.Name(), ".sql") {
			continue
		}
		sql, err := os.ReadFile(filepath.Join("migrations", f.Name()))
		if err != nil {
			t.Fatal(err)
		}
		if _, err = tx.Exec(ctx, string(sql)); err != nil {
			t.Fatalf("%s: %v", f.Name(), err)
		}
	}
	_, err = tx.Exec(ctx, `INSERT INTO users(id,email,display_name,password_hash) VALUES('owner','owner@test','Owner','test'),('guest','guest@test','Guest','test');
 INSERT INTO workspaces(id,name,owner_user_id) VALUES('owner-w','Owner','owner'),('guest-w','Guest','guest');
 INSERT INTO resource_shares(id,kind,resource_id,workspace_id,owner_user_id,recipient_email,recipient_user_id,permission,status,project_id) VALUES
 ('grant-a','agent','agent-a','owner-w','owner','guest@test','guest','execute','accepted','source'),
 ('grant-b','agent','agent-b','owner-w','owner','guest@test','guest','execute','accepted','source');
 INSERT INTO projects(id,workspace_id,name,workspace_kind,workspace_source,shared_agent_grant_id) VALUES
 ('source','owner-w','Code','git','https://example.com/code.git',NULL),
 ('personal','guest-w','Code','git','https://example.com/personal.git',NULL),
 ('copy-a','guest-w','Code · Agent A','git','https://example.com/code.git','grant-a'),
 ('copy-b','guest-w','Code · Agent B','git','https://example.com/code.git','grant-b');
 INSERT INTO chat_sessions(id,workspace_id,title,agent_id,project_id,workspace_key,shared_agent_grant_id) VALUES
 ('session-a','guest-w','Task A','agent-a','copy-a','worktree-a','grant-a'),
 ('session-b','guest-w','Task B','agent-b','copy-b','worktree-b','grant-b');`)
	if err != nil {
		t.Fatal(err)
	}
	sql, err := os.ReadFile("migrations/000032_shared_project_agents.sql")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = tx.Exec(ctx, string(sql)); err != nil {
		t.Fatal(err)
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM projects WHERE workspace_id='guest-w' AND shared_source_project_id='source' AND name='Code'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("shared grouping: %d %v", count, err)
	}
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM projects WHERE id='personal' AND name='Code' AND shared_source_project_id IS NULL`).Scan(&count); err != nil || count != 1 {
		t.Fatal("personal project changed", err)
	}
	var projectA, projectB, keyA, keyB string
	if err = tx.QueryRow(ctx, `SELECT a.project_id,b.project_id,a.workspace_key,b.workspace_key FROM chat_sessions a,chat_sessions b WHERE a.id='session-a' AND b.id='session-b'`).Scan(&projectA, &projectB, &keyA, &keyB); err != nil {
		t.Fatal(err)
	}
	if projectA != projectB || keyA != "worktree-a" || keyB != "worktree-b" {
		t.Fatal("migration lost grouping or worktree identity")
	}
	// An updated grant may later authorize a different source project.
	if _, err = tx.Exec(ctx, `INSERT INTO projects(id,workspace_id,name,workspace_kind,workspace_source,shared_agent_grant_id,shared_source_project_id,shared_source_workspace_id) VALUES('new-source-copy','guest-w','Other','git','https://example.com/other.git','grant-a','other-source','owner-w')`); err != nil {
		t.Fatal("legacy grant uniqueness remains", err)
	}
}
