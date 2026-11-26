package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FastR-D/FastDeploy/pgstore"
)

func TestAllowAttemptSQLite(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "limits.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { s.Close() })
	testAllowAttempt(t, s)
}

func TestAllowAttemptPostgres(t *testing.T) {
	dsn := os.Getenv("FASTRESEARCH_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("set FASTRESEARCH_TEST_POSTGRES_DSN to test PostgreSQL")
	}
	db, err := pgstore.Open(dsn)
	if err != nil {
		t.Fatal(err)
	}
	// A connection-local table avoids touching application tables in this database.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	t.Cleanup(func() { db.Close() })
	if _, err = db.Exec(`CREATE TEMP TABLE fr_limits(id TEXT PRIMARY KEY,attempts BIGINT NOT NULL,expires BIGINT NOT NULL)`); err != nil {
		t.Fatal(err)
	}
	testAllowAttempt(t, &Store{DB: db})
}

func testAllowAttempt(t *testing.T, s *Store) {
	t.Helper()
	for i := 0; i < 3; i++ {
		if allowed, err := s.AllowAttempt("login:client-a", 3); err != nil || !allowed {
			t.Fatalf("attempt %d rejected before limit", i+1)
		}
	}
	if allowed, err := s.AllowAttempt("login:client-a", 3); err != nil || allowed {
		t.Fatal("rate limit was not enforced")
	}
	if allowed, err := s.AllowAttempt("login:client-b", 3); err != nil || !allowed {
		t.Fatal("another client inherited the limit")
	}
	if allowed, err := s.AllowAttempt("key:client-a", 3); err != nil || !allowed {
		t.Fatal("another login method inherited the limit")
	}
	if _, err := s.DB.Exec(`UPDATE fr_limits SET expires=? WHERE id=?`, time.Now().Add(-time.Second).UnixMilli(), Hash("login:client-a")); err != nil {
		t.Fatal(err)
	}
	if allowed, err := s.AllowAttempt("login:client-a", 3); err != nil || !allowed {
		t.Fatal("expired limit did not reset")
	}
	var count int
	if err := s.DB.QueryRow(`SELECT attempts FROM fr_limits WHERE id=?`, Hash("login:client-a")).Scan(&count); err != nil || count != 1 {
		t.Fatalf("reset count=%d: %v", count, err)
	}
}

func TestAllowAttemptReportsDatabaseFailure(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "limits.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	s.Close()
	allowed, err := s.AllowAttempt("login:client-a", 60)
	if err == nil || allowed {
		t.Fatalf("database failure treated as rate limit: allowed=%v error=%v", allowed, err)
	}
}
