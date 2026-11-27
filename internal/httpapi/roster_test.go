package httpapi

import (
	"encoding/json"
	"github.com/FastR-D/FastResearch/internal/store"
	"net/http"
	"testing"
	"time"
)

func TestRosterDatabaseAPI(t *testing.T) {
	_, server, provider := setup(t)
	// An absent legacy path must not prevent bootstrapping/editing the database.
	t.Setenv("FASTINSIGHT_ROSTER", "/nonexistent/colleagues.yaml")
	endpoint := server.URL + "/api/admin/fastinsight/roster"
	status, _ := request(t, http.DefaultClient, "GET", endpoint, "")
	if status != 401 {
		t.Fatal("unauthenticated roster access", status)
	}
	client := login(t, server)
	status, initial := request(t, client, "GET", endpoint, "")
	if status != 200 || initial["storage"] != "database" || initial["file"] != nil {
		t.Fatalf("initial snapshot: %d %#v", status, initial)
	}
	legacy := store.Object{"directions": []any{store.Object{"name": "安全", "keywords": []string{"Agent"}, "owners": []any{store.Object{"name": "研究员"}}}}, "default_owner": store.Object{"name": "研究员"}}
	payload := store.JSON(store.Object{"revision": initial["revision"], "roster": legacy})
	status, saved := request(t, client, "PUT", endpoint, payload)
	if status != 200 {
		t.Fatalf("save: %d %#v", status, saved)
	}
	status, _ = request(t, client, "PUT", endpoint, payload)
	if status != 409 {
		t.Fatal("stale revision accepted", status)
	}
	status, loaded := request(t, client, "GET", endpoint, "")
	if status != 200 || store.JSON(loaded) != store.JSON(saved) {
		t.Fatal("saved snapshot did not round trip")
	}
	for _, invalid := range []string{`null`, `{"directions":"invalid"}`, `{"keywords":[""]}`, `{"members":[],"default_owner":{"name":"missing"}}`} {
		status, _ = request(t, client, "PUT", endpoint, `{"revision":"`+store.String(saved["revision"])+`","roster":`+invalid+`}`)
		if status != 400 {
			t.Fatalf("invalid input %s returned %d", invalid, status)
		}
	}
	// Empty configuration and default-only routing can both be persisted.
	status, empty := request(t, client, "PUT", endpoint, store.JSON(store.Object{"revision": saved["revision"], "roster": store.Object{"directions": []any{}, "keywords": []any{}, "members": []any{}}}))
	if status != 200 {
		t.Fatalf("empty save: %d %#v", status, empty)
	}
	status, defaultOnly := request(t, client, "PUT", endpoint, store.JSON(store.Object{"revision": empty["revision"], "roster": store.Object{"directions": []any{}, "default_owner": store.Object{"name": "默认成员"}}}))
	if status != 200 {
		t.Fatalf("default-only save: %d %#v", status, defaultOnly)
	}
	provider.mu.Lock()
	provider.role = "member"
	provider.mu.Unlock()
	status, _ = request(t, client, "GET", endpoint, "")
	if status != 403 && status != 401 {
		t.Fatal("non-admin read allowed", status)
	}
	status, _ = request(t, client, "PUT", endpoint, payload)
	if status != 403 && status != 401 {
		t.Fatal("non-admin write allowed", status)
	}
}

func TestServiceRosterUsesDatabaseAndLiveServiceAuthorization(t *testing.T) {
	a, server, provider := setup(t)
	client := login(t, server)
	adminURL := server.URL + "/api/admin/fastinsight/roster"
	_, initial := request(t, client, "GET", adminURL, "")
	_, me := request(t, client, "GET", server.URL+"/api/content/me", "")
	ref := store.String(me["accountId"])
	input := store.Object{"directions": []any{store.Object{"name": "安全", "keywords": []string{"Agent"}, "owners": []any{store.Object{"name": "研究员", "receiver_ref": ref}}}}, "default_owner": store.Object{"name": "研究员", "receiver_ref": ref}}
	status, saved := request(t, client, "PUT", adminURL, store.JSON(store.Object{"revision": initial["revision"], "roster": input}))
	if status != 200 {
		t.Fatalf("admin save: %d %#v", status, saved)
	}
	t.Setenv("FASTRESEARCH_FASTCAS_INGEST_CLIENT_ID", "fastinsight")
	claims := store.Object{"iss": provider.URL, "sub": "fastinsight", "client_id": "fastinsight", "aud": []string{"research-api"}, "scope": "insight:publish", "service": true, "token_use": "access", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()}
	get := func(token, key string, want int) store.Object {
		t.Helper()
		req, _ := http.NewRequest("GET", server.URL+"/api/fastinsight/roster", nil)
		if token != "" {
			req.Header.Set("Authorization", "Bearer "+token)
		}
		if key != "" {
			req.Header.Set("X-FastInsight-Key", key)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer resp.Body.Close()
		var data store.Object
		if err = json.NewDecoder(resp.Body).Decode(&data); err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != want {
			t.Fatalf("expected %d, got %d: %#v", want, resp.StatusCode, data)
		}
		return data
	}
	get("", "", 401)
	token := provider.sign(t, "JWT", claims)
	if actual := get(token, "", 200); store.JSON(actual) != store.JSON(saved) {
		t.Fatal("service did not read the admin's database snapshot")
	}
	for _, change := range []store.Object{{"scope": "research:read"}, {"aud": []string{"another-api"}}, {"service": false}, {"sub": "member"}} {
		changed := store.Decode(store.JSON(claims))
		for k, v := range change {
			changed[k] = v
		}
		get(provider.sign(t, "JWT", changed), "", 401)
	}
	other := store.Decode(store.JSON(claims))
	other["sub"] = "other-service"
	other["client_id"] = "other-service"
	get(provider.sign(t, "JWT", other), "", 403)
	t.Setenv("FASTINSIGHT_INGEST_KEY", "legacy-secret")
	get("", "legacy-secret", 401)
	t.Setenv("FASTRESEARCH_ALLOW_LEGACY_FASTINSIGHT_KEY", "true")
	get("", "wrong-key", 401)
	get("", "legacy-secret", 200)
	get("invalid-token", "legacy-secret", 401) // Never downgrade invalid bearer auth.
	// A save is visible on the next request; no file or process cache is involved.
	snapshot, err := a.Store.Roster()
	if err != nil {
		t.Fatal(err)
	}
	snapshot.Roster.DefaultOwner = nil
	updated, err := a.Store.SaveRoster(snapshot.Roster, snapshot.Revision)
	if err != nil {
		t.Fatal(err)
	}
	if actual := get(token, "", 200); actual["revision"] != updated.Revision || object(actual["roster"])["default_owner"] != nil {
		t.Fatal("service returned stale routing data")
	}
	provider.mu.Lock()
	provider.disabled = true
	provider.mu.Unlock()
	get(token, "", 401)
}
