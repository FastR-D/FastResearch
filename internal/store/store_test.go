package store

import (
	"database/sql"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestSnapshotMigrationRetainsStableIdentityAndContent(t *testing.T) {
	dir := t.TempDir()
	legacy := Object{"keys": []any{Object{"id": "legacy-key", "accountId": "existing-account", "person": "同名研究员", "keyHash": Hash("key-secret"), "credentialVersion": 3, "insightItems": []any{Object{"id": "paper-1", "title": "Paper"}}, "workflow": Object{"id": "workflow-1", "tasks": []any{Object{"id": "task-1"}}}, "researchImpression": Object{"text": "original note"}, "customField": "preserve me"}}}
	raw := JSON(legacy)
	file := filepath.Join(dir, "access.json")
	if e := os.WriteFile(file, []byte(raw), 0600); e != nil {
		t.Fatal(e)
	}
	s, e := Open(filepath.Join(dir, "accounts.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	a, e := s.Account("existing-account")
	if e != nil {
		t.Fatal(e)
	}
	if a.KeyID != "legacy-key" || a.Content["customField"] != "preserve me" || Number(a.Credential["credentialVersion"]) != 3 {
		t.Fatalf("migration changed identity/content: %#v", a)
	}
	s.Close()
	s, e = Open(filepath.Join(dir, "accounts.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	list, e := s.Accounts()
	if e != nil || len(list) != 1 {
		t.Fatal("import was not idempotent", e, len(list))
	}
	after, _ := os.ReadFile(file)
	if string(after) != raw {
		t.Fatal("legacy snapshot was modified")
	}
	// Matching names/email never authorize merging a central account.
	central, e := s.Provision("https://cas.test", "research", "central-subject", "同名研究员")
	if e != nil {
		t.Fatal(e)
	}
	if central.ID == a.ID {
		t.Fatal("display-name merge")
	}
	again, e := s.Provision("https://cas.test", "research", "central-subject", "renamed")
	if e != nil || again.ID != central.ID {
		t.Fatal("central identity is not stable", e)
	}
}
func TestSQLiteMigrationAndExistingExplicitBinding(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "accounts.sqlite")
	db, e := sql.Open("sqlite3", file)
	if e != nil {
		t.Fatal(e)
	}
	_, e = db.Exec(`CREATE TABLE accounts_main_legacy(id TEXT PRIMARY KEY,legacy_key_id TEXT,content TEXT);CREATE TABLE credentials(id TEXT PRIMARY KEY,account_id TEXT,legacy_key_id TEXT,credential TEXT);CREATE TABLE fastcas_links(issuer TEXT,id TEXT,client_id TEXT,account_id TEXT,subject TEXT,state TEXT,version INTEGER,payload TEXT);INSERT INTO accounts_main_legacy VALUES('stable-id','key-id','{"person":"Researcher","inbox":[{"id":"note"}]}');INSERT INTO credentials VALUES('key','stable-id','key-id','{}');INSERT INTO fastcas_links VALUES('https://cas.test','link','research','stable-id','subject','active',2,'{}');`)
	db.Close()
	if e != nil {
		t.Fatal(e)
	}
	s, e := Open(file)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	a, e := s.Provision("https://cas.test", "research", "subject", "new name")
	if e != nil || a.ID != "stable-id" {
		t.Fatalf("explicit mapping lost: %v %#v", e, a)
	}
	if _, e = s.DB.Exec(`INSERT INTO fastcas_links VALUES('https://cas.test','revoked','research','stable-id','revoked-subject','revoked',3,'{}')`); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Provision("https://cas.test", "research", "revoked-subject", "name"); e == nil {
		t.Fatal("revoked binding silently reprovisioned")
	}
}
func TestOpaqueSessionsPersistAndLogoutRevokes(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "accounts.sqlite")
	s, e := Open(file)
	if e != nil {
		t.Fatal(e)
	}
	session := &Session{AccountID: "account", Source: "fastcas", Role: "member", ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}
	raw := "opaque-secret"
	if e = s.PutSession(raw, session); e != nil {
		t.Fatal(e)
	}
	s.Close()
	s, e = Open(file)
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	if _, e = s.Session(raw); e != nil {
		t.Fatal(e)
	}
	var hash string
	if e = s.DB.QueryRow(`SELECT hash FROM fr_sessions`).Scan(&hash); e != nil || hash == raw {
		t.Fatal("raw bearer persisted", e)
	}
	if e = s.DeleteSession(raw); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Session(raw); e == nil {
		t.Fatal("revoked session accepted")
	}
}
func TestRefreshCannotResurrectRevokedSession(t *testing.T) {
	s, e := Open(filepath.Join(t.TempDir(), "accounts.sqlite"))
	if e != nil {
		t.Fatal(e)
	}
	defer s.Close()
	v := &Session{AccountID: "account", Source: "fastcas", Role: "admin", ExpiresAt: time.Now().Add(time.Hour).UnixMilli()}
	if e = s.PutSession("token", v); e != nil {
		t.Fatal(e)
	}
	if e = s.DeleteSession("token"); e != nil {
		t.Fatal(e)
	}
	if e = s.UpdateSession("token", v); e == nil {
		t.Fatal("revoked session refreshed")
	}
	if _, e = s.Session("token"); e == nil {
		t.Fatal("revoked session resurrected")
	}
}
func TestInvalidLegacySnapshotDoesNotCommitMigration(t *testing.T) {
	for _, raw := range []string{`{}`, `{"keys":null}`, `{"keys":[{"id":"key","keyHash":"invalid"}]}`} {
		dir := t.TempDir()
		file := filepath.Join(dir, "accounts.sqlite")
		if e := os.WriteFile(filepath.Join(dir, "access.json"), []byte(raw), 0600); e != nil {
			t.Fatal(e)
		}
		if s, e := Open(file); e == nil {
			s.Close()
			t.Fatal("invalid legacy source accepted")
		}
		db, e := sql.Open("sqlite3", file)
		if e != nil {
			t.Fatal(e)
		}
		var n int
		e = db.QueryRow(`SELECT count(*) FROM fr_migrations`).Scan(&n)
		db.Close()
		if e != nil || n != 0 {
			t.Fatal("failed import committed migration", e, n)
		}
	}
}
