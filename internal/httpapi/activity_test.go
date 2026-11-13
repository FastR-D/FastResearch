package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/FastR-D/FastResearch/internal/integrations"
	"github.com/FastR-D/FastResearch/internal/store"
)

func TestWorkspaceActivityUsesAuthenticatedSubjectAndTrustedLinks(t *testing.T) {
	a, server, _ := setup(t)
	t.Setenv("FASTNEWS_PUBLIC_URL", "https://news.example.test/base/")
	state, path := "active", "/inbox?tab=unread"
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]string
		_ = json.NewDecoder(r.Body).Decode(&body)
		if body["subject"] != "central-user" || len(body) != 1 || r.Header.Get("X-API-Key") != "fixture" {
			t.Error("untrusted recipient or missing service credential", body)
		}
		if state == "error" {
			w.WriteHeader(503)
			return
		}
		write(w, 200, store.Object{"schemaVersion": integrations.ActivitySchema, "appId": "fast-news", "accountState": state, "registrationPath": "https://evil.test/", "metrics": []any{store.Object{"id": "unread", "label": "未读订阅", "value": 2}}, "items": []any{store.Object{"id": "notice", "kind": "subscription", "title": "New paper", "path": path}}})
	}))
	defer upstream.Close()
	a.ActivityClients = map[string]*integrations.Client{"fast-news": {Base: upstream.URL, Key: "fixture", Scope: "workspace:read"}}
	status, _ := request(t, server.Client(), "GET", server.URL+"/api/workspace/apps/fast-news/activity", "")
	if status != 401 {
		t.Fatal("guest accepted", status)
	}
	client := login(t, server)
	status, result := request(t, client, "GET", server.URL+"/api/workspace/apps/fast-news/activity?subject=victim", "")
	if status != 200 || result["accountState"] != "active" || !strings.Contains(store.JSON(result), "https://news.example.test/base/inbox?tab=unread") {
		t.Fatal(status, result)
	}
	state = "missing"
	_, result = request(t, client, "GET", server.URL+"/api/workspace/apps/fast-news/activity", "")
	if result["accountState"] != "missing" || result["registrationPath"] != "/api/workspace/apps/fast-news/register" || strings.Contains(store.JSON(result), "New paper") {
		t.Fatal(result)
	}
	state = "error"
	_, result = request(t, client, "GET", server.URL+"/api/workspace/apps/fast-news/activity", "")
	if result["accountState"] != "unavailable" || result["registrationPath"] != nil {
		t.Fatal("outage became registration invitation", result)
	}
	state = "active"
	path = "https://evil.test/leak"
	_, result = request(t, client, "GET", server.URL+"/api/workspace/apps/fast-news/activity", "")
	if result["accountState"] != "unavailable" {
		t.Fatal("untrusted deep link accepted", result)
	}
}

func TestKeyLoginRemainsMemberAndUnmappedKeyDoesNotGuessCASIdentity(t *testing.T) {
	a, server, _ := setup(t)
	a.Config.LegacyKeys = true
	a.CAS.Config.LegacyKeys = true
	account := &store.Account{ID: "key-owner", KeyID: "key-id", Content: store.Object{"person": "Member"}, Credential: store.Object{"keyHash": store.Hash("personal-key"), "credentialVersion": 1}}
	if e := a.Store.Save(account); e != nil {
		t.Fatal(e)
	}
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	status, result := request(t, client, "POST", server.URL+"/api/content/unlock", `{"key":"personal-key"}`)
	if status != 200 || result["role"] != "member" {
		t.Fatal(status, result)
	}
	status, _ = request(t, client, "GET", server.URL+"/api/admin/me", "")
	if status != 403 && status != 401 {
		t.Fatal("key granted admin", status)
	}
	_, result = request(t, client, "GET", server.URL+"/api/workspace/apps/fast-read/activity", "")
	if result["accountState"] != "requires_cas" {
		t.Fatal(result)
	}
	account.Credential["credentialVersion"] = 2
	if e := a.Store.Save(account); e != nil {
		t.Fatal(e)
	}
	status, _ = request(t, client, "GET", server.URL+"/api/content/me", "")
	if status != 401 {
		t.Fatal("rotated key session accepted", status)
	}
}

func TestGenericTaskSummaryReplacesSpecialTaskRoutes(t *testing.T) {
	a, server, _ := setup(t)
	t.Setenv("FASTTASK_PUBLIC_URL", "https://task.example.test")
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input map[string]string
		json.NewDecoder(r.Body).Decode(&input)
		if r.URL.Path != "/api/integrations/fastresearch/workspace" || r.Method != "POST" || len(input) != 1 || input["subject"] != "central-user" {
			t.Errorf("untrusted task identity or protocol: %s %#v", r.URL, input)
		}
		write(w, 200, store.Object{"schemaVersion": integrations.ActivitySchema, "appId": "fast-task", "accountState": "active", "metrics": []any{}, "items": []any{}, "tasks": store.Object{"received": true, "date": "2026-11-13", "items": []any{store.Object{"id": "task-1", "title": "Read evidence", "status": "planned"}}, "progress": store.Object{"total": 1, "completed": 0, "inProgress": 0, "planned": 1, "skipped": 0}}})
	}))
	defer upstream.Close()
	a.ActivityClients = map[string]*integrations.Client{"fast-task": {Base: upstream.URL, Key: "fixture"}}
	client := login(t, server)
	status, result := request(t, client, "GET", server.URL+"/api/workspace/apps/fast-task/activity?subject=victim&receiver_ref=victim", "")
	if status != 200 || result["accountState"] != "active" || len(array(object(result["tasks"])["items"])) != 1 {
		t.Fatalf("generic task summary: %d %#v", status, result)
	}
	status, team := request(t, client, "GET", server.URL+"/api/workflow/team", "")
	if status != 200 || !strings.Contains(store.JSON(team), "Read evidence") || strings.Contains(store.JSON(team), "central-user") {
		t.Fatalf("team task summary: %d %#v", status, team)
	}
	for _, path := range []string{"/api/fasttask/today", "/api/fasttask/tasks", "/api/fasttask/login", "/api/sso/launch?audience=fast-task", "/api/sso/ticket", "/api/sso/consume"} {
		if status, _ := request(t, client, "GET", server.URL+path, ""); status != 404 {
			t.Fatalf("retired special route still exists: %s %d", path, status)
		}
	}
}
