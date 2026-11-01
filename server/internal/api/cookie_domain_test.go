package api

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRunStreamHeartbeatAndCancellation(t *testing.T) {
	closed := make(chan struct{})
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "event: relay.event\ndata: {\"sequence\":1,\"type\":\"run.started\"}\n\n")
		w.(http.Flusher).Flush()
		<-r.Context().Done()
		close(closed)
	}))
	defer upstream.Close()
	s := New(nil, upstream.URL, "", "", "default", nil)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		s.streamRunEventsForID(w, r, "run")
	}))
	defer server.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	req, _ := http.NewRequestWithContext(ctx, "GET", server.URL, nil)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	scanner := bufio.NewScanner(resp.Body)
	sawEvent, sawHeartbeat := false, false
	for scanner.Scan() {
		if scanner.Text() == "event: relay.event" {
			sawEvent = true
		}
		if scanner.Text() == ": heartbeat" {
			sawHeartbeat = true
			break
		}
	}
	if !sawEvent || !sawHeartbeat {
		t.Fatalf("event=%v heartbeat=%v error=%v", sawEvent, sawHeartbeat, scanner.Err())
	}
	cancel()
	select {
	case <-closed:
	case <-time.After(time.Second):
		t.Fatal("Relay stream did not close after browser cancellation")
	}
}

func TestSharedSessionCookieScope(t *testing.T) {
	s := New(nil, "http://relay.invalid", "", "", "default", nil, WithSessionCookieDomain("api.example.test"))
	for _, tc := range []struct{ host, domain string }{
		{"direct.api.example.test:8443", "api.example.test"},
		{"api.example.test", "api.example.test"},
		{"legacy.example.test:8443", ""},
		{"evilapi.example.test", ""},
	} {
		t.Run(tc.host, func(t *testing.T) {
			req := httptest.NewRequest("GET", "https://"+tc.host+"/api/v1/auth/me", nil)
			for _, value := range []string{"session", ""} {
				recorder := httptest.NewRecorder()
				s.setSessionCookie(recorder, req, value, time.Now().Add(time.Hour))
				cookies := recorder.Result().Cookies()
				if len(cookies) != 1 {
					t.Fatalf("cookies=%v", cookies)
				}
				c := cookies[0]
				if c.Domain != tc.domain || !c.HttpOnly || !c.Secure || c.SameSite != http.SameSiteLaxMode {
					t.Fatalf("cookie=%+v", c)
				}
				if value == "" && c.MaxAge != -1 {
					t.Fatal("logout did not delete shared cookie")
				}
			}
		})
	}
}

func TestRouteHealthIsPublicAndNotCached(t *testing.T) {
	s := New(nil, "http://relay.invalid", "", "", "default", []string{"https://app.example.test"}, WithAuthentication(time.Hour))
	r := httptest.NewRequest("GET", "/api/v1/health", nil)
	r.Header.Set("Origin", "https://app.example.test")
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusOK || w.Header().Get("Cache-Control") != "no-store" || w.Header().Get("Access-Control-Allow-Origin") != "https://app.example.test" {
		t.Fatalf("health=%d %v %s", w.Code, w.Header(), w.Body.String())
	}
}
