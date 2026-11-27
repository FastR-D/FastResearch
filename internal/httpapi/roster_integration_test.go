package httpapi

import (
	"context"
	"encoding/json"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/FastR-D/FastResearch/internal/store"
)

// Opt in when both repositories are checked out. This runs the real Python
// importer/router/publisher against the real Go API and an isolated database.
func TestFastInsightDatabaseRoutingIntegration(t *testing.T) {
	source := os.Getenv("FASTINSIGHT_SOURCE_DIR")
	if source == "" {
		t.Skip("set FASTINSIGHT_SOURCE_DIR to run the cross-repository contract")
	}
	source, err := filepath.Abs(source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(source, "scripts", "auto_pipeline.py")); err != nil {
		t.Fatal(err)
	}
	a, server, _ := setup(t)
	admin := login(t, server)
	_, me := request(t, admin, "GET", server.URL+"/api/content/me", "")
	refA := store.String(me["accountId"])
	second := store.Account{ID: "account-second", KeyID: "key-second", Content: store.Object{"person": "同名成员"}, Credential: store.Object{}}
	if err = a.Store.Save(&second); err != nil {
		t.Fatal(err)
	}
	t.Setenv("FASTRESEARCH_ALLOW_LEGACY_FASTINSIGHT_KEY", "true")
	t.Setenv("FASTINSIGHT_INGEST_KEY", "integration-test-secret")
	u, _ := url.Parse(server.URL)
	var adminToken string
	for _, cookie := range admin.Jar.Cookies(u) {
		if cookie.Name == a.Config.CookieName {
			adminToken = cookie.Value
		}
	}
	if adminToken == "" {
		t.Fatal("missing fixture administrator session")
	}
	runPython := func(code string, input any) store.Object {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		defer cancel()
		python := os.Getenv("FASTINSIGHT_PYTHON")
		if python == "" {
			python = filepath.Join(source, ".venv", "bin", "python")
		}
		cmd := exec.CommandContext(ctx, python, "-c", code)
		cmd.Dir = source
		cmd.Env = append(os.Environ(), "FASTINSIGHT_FASTCAS_ISSUER=", "FASTINSIGHT_FASTCAS_CLIENT_ID=", "FASTINSIGHT_FASTCAS_CLIENT_SECRET=", "FASTINSIGHT_ROSTER=/nonexistent/obsolete.yaml", "FASTRESEARCH_URL="+server.URL, "FASTRESEARCH_ADMIN_SESSION="+adminToken)
		cmd.Stdin = strings.NewReader(store.JSON(input))
		output, err := cmd.CombinedOutput()
		if err != nil {
			t.Fatalf("Python contract failed: %v\n%s", err, output)
		}
		var result store.Object
		if err = json.Unmarshal(output, &result); err != nil {
			t.Fatalf("invalid Python output: %v\n%s", err, output)
		}
		return result
	}
	legacy := filepath.Join(t.TempDir(), "roster.json")
	ownerA := store.Object{"name": "同名成员", "receiver_ref": refA}
	ownerB := store.Object{"name": "同名成员", "receiver_ref": second.ID}
	legacyRoster := store.Object{"directions": []any{store.Object{"name": "安全", "keywords": []string{"Agent"}, "owners": []any{ownerA, ownerB}}}, "default_owner": ownerB}
	if err = os.WriteFile(legacy, []byte(store.JSON(legacyRoster)), 0600); err != nil {
		t.Fatal(err)
	}
	imported := runPython(`import json,os,sys
from scripts.import_roster import import_roster
print(json.dumps(import_roster(json.load(sys.stdin)["source"],os.environ["FASTRESEARCH_URL"],os.environ["FASTRESEARCH_ADMIN_SESSION"])))`, store.Object{"source": legacy})
	if imported["storage"] != "database" {
		t.Fatal("import did not use database")
	}
	// Remove the migration source entirely: runtime must remain functional.
	if err = os.Remove(legacy); err != nil {
		t.Fatal(err)
	}
	pipeline := `import json,sys
from scripts.auto_pipeline import process
print(json.dumps(process(json.load(sys.stdin),trend_text="Integration trend summary.",skip_verify=True)))`
	first := runPython(pipeline, store.Object{"title": "Agent security", "url": "https://example.test/first"})
	if len(array(first["delivered"])) != 2 || len(array(first["errors"])) != 0 || first["roster_revision"] != imported["revision"] {
		t.Fatalf("keyword route failed: %#v", first)
	}
	// Edit through the same administrator API used by the visual settings page.
	_, snapshot := request(t, admin, "GET", server.URL+"/api/admin/fastinsight/roster", "")
	roster := object(snapshot["roster"])
	object(array(roster["directions"])[0])["keywords"] = []any{}
	status, updated := request(t, admin, "PUT", server.URL+"/api/admin/fastinsight/roster", store.JSON(store.Object{"roster": roster, "revision": snapshot["revision"]}))
	if status != 200 {
		t.Fatalf("admin update: %d %#v", status, updated)
	}
	secondRun := runPython(pipeline, store.Object{"title": "Agent security", "url": "https://example.test/second"})
	if len(array(secondRun["delivered"])) != 1 || secondRun["roster_revision"] != updated["revision"] || object(secondRun["route"])["routing_mode"] != "default" {
		t.Fatalf("updated default route failed: %#v", secondRun)
	}
	accountA, err := a.Store.Account(refA)
	if err != nil {
		t.Fatal(err)
	}
	accountB, err := a.Store.Account(second.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(array(accountA.Content["insightItems"])) != 1 || len(array(accountB.Content["insightItems"])) != 2 {
		t.Fatal("same-name accounts received incorrect papers")
	}
}
