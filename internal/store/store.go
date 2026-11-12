// Package store owns persistent account content and opaque, hashed sessions.
package store

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

type Object = map[string]any
type Account struct {
	ID         string `json:"accountId"`
	KeyID      string `json:"keyId"`
	Content    Object `json:"content"`
	Credential Object `json:"-"`
}
type Session struct {
	AccountID         string  `json:"accountId"`
	Source            string  `json:"authSource"`
	Issuer            string  `json:"casIssuer,omitempty"`
	Subject           string  `json:"casSubject,omitempty"`
	SID               string  `json:"casSid,omitempty"`
	Role              string  `json:"role"`
	ExpiresAt         int64   `json:"expiresAt"`
	CheckedAt         int64   `json:"checkedAt"`
	ProviderToken     string  `json:"providerToken,omitempty"`
	CredentialVersion float64 `json:"credentialVersion,omitempty"`
}
type Store struct{ DB *sql.DB }

func Hash(s string) string { v := sha256.Sum256([]byte(s)); return hex.EncodeToString(v[:]) }
func Random() string {
	var v [32]byte
	if _, err := rand.Read(v[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(v[:])
}
func JSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(b)
}
func Decode(s string) Object { v := Object{}; _ = json.Unmarshal([]byte(s), &v); return v }
func String(v any) string    { s, _ := v.(string); return s }
func Number(v any) float64   { n, _ := v.(float64); return n }
func Now() string            { return time.Now().UTC().Format(time.RFC3339Nano) }
func Open(file string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(file), 0700); err != nil {
		return nil, err
	}
	f, err := os.OpenFile(file, os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	f.Close()
	if err = os.Chmod(file, 0600); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite3", "file:"+file+"?_foreign_keys=on&_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	s := &Store{db}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS fr_accounts(id TEXT PRIMARY KEY,key_id TEXT UNIQUE NOT NULL,content TEXT NOT NULL,credential TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS fr_identities(issuer TEXT NOT NULL,client_id TEXT NOT NULL,subject TEXT NOT NULL,account_id TEXT NOT NULL REFERENCES fr_accounts(id),PRIMARY KEY(issuer,client_id,subject),UNIQUE(issuer,client_id,account_id));
 CREATE TABLE IF NOT EXISTS fr_sessions(hash TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS fr_transactions(state TEXT PRIMARY KEY,payload TEXT NOT NULL,expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS fr_events(issuer TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(issuer,id));
 CREATE TABLE IF NOT EXISTS fr_migrations(id TEXT PRIMARY KEY);
 CREATE TABLE IF NOT EXISTS fr_limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires INTEGER NOT NULL);`)
	if err == nil {
		err = s.importLegacy(filepath.Join(filepath.Dir(file), "access.json"))
	}
	if err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}
func (s *Store) Close() error { return s.DB.Close() }

// One atomic import, with source tables/files untouched. Stable IDs and all JSON
// fields are retained. Never merge people by name or email.
func (s *Store) importLegacy(file string) error {
	var done string
	if s.DB.QueryRow(`SELECT id FROM fr_migrations WHERE id='legacy-v1'`).Scan(&done) == nil {
		return nil
	}
	accounts := []Account{}
	var table string
	for _, name := range []string{"accounts", "accounts_main_legacy", "legacy_accounts"} {
		rows, e := s.DB.Query(`SELECT id,legacy_key_id,content FROM ` + name + ` LIMIT 0`)
		if e == nil {
			rows.Close()
			table = name
			break
		}
	}
	if table == "" {
		var existing int
		if e := s.DB.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN ('accounts','accounts_main_legacy','legacy_accounts','credentials')`).Scan(&existing); e != nil {
			return e
		}
		if existing > 0 {
			return errors.New("unsupported legacy account schema; migration stopped")
		}
	}
	if table != "" {
		rows, e := s.DB.Query(`SELECT a.id,a.legacy_key_id,a.content,c.credential FROM ` + table + ` a JOIN credentials c ON c.account_id=a.id`)
		if e != nil {
			return e
		}
		for rows.Next() {
			var a Account
			var content, credential string
			if e = rows.Scan(&a.ID, &a.KeyID, &content, &credential); e != nil {
				rows.Close()
				return e
			}
			if e = json.Unmarshal([]byte(content), &a.Content); e != nil || a.Content == nil {
				rows.Close()
				return errors.New("invalid legacy account content")
			}
			if e = json.Unmarshal([]byte(credential), &a.Credential); e != nil || a.Credential == nil {
				rows.Close()
				return errors.New("invalid legacy credential JSON")
			}
			accounts = append(accounts, a)
		}
		e = rows.Err()
		rows.Close()
		if e != nil {
			return e
		}

		var expected int
		if e = s.DB.QueryRow(`SELECT count(*) FROM ` + table).Scan(&expected); e != nil {
			return e
		}
		if len(accounts) != expected {
			return errors.New("legacy accounts are missing credentials; migration stopped")
		}
	} else if b, e := os.ReadFile(file); e == nil {
		var snapshot struct {
			Keys []Object `json:"keys"`
		}
		if e = json.Unmarshal(b, &snapshot); e != nil {
			return fmt.Errorf("invalid legacy snapshot: %w", e)
		}
		if snapshot.Keys == nil {
			return errors.New("legacy snapshot must have a keys array")
		}
		for _, r := range snapshot.Keys {
			id := String(r["id"])
			digest, decodeErr := hex.DecodeString(String(r["keyHash"]))
			if id == "" || decodeErr != nil || len(digest) != 32 {
				return errors.New("invalid legacy credential; migration stopped")
			}
			accountID := String(r["accountId"])
			if accountID == "" {
				accountID = "account_" + Hash("FastResearch:legacy:" + id)[:32]
			}
			cred := Object{}
			for _, k := range []string{"id", "keyHash", "keyPreview", "expiresAt", "revokedAt", "credentialVersion"} {
				if v, ok := r[k]; ok {
					cred[k] = v
					delete(r, k)
				}
			}
			accounts = append(accounts, Account{accountID, id, r, cred})
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	for _, a := range accounts {
		if _, e = tx.Exec(`INSERT INTO fr_accounts VALUES(?,?,?,?)`, a.ID, a.KeyID, JSON(a.Content), JSON(a.Credential)); e != nil {
			return e
		}
	}
	if _, e = tx.Exec(`INSERT INTO fr_migrations VALUES('legacy-v1')`); e != nil {
		return e
	}
	return tx.Commit()
}
func scanAccount(row interface{ Scan(...any) error }) (*Account, error) {
	var a Account
	var c, k string
	err := row.Scan(&a.ID, &a.KeyID, &c, &k)
	if err != nil {
		return nil, err
	}
	if err = json.Unmarshal([]byte(c), &a.Content); err != nil || a.Content == nil {
		return nil, errors.New("invalid account content")
	}
	if err = json.Unmarshal([]byte(k), &a.Credential); err != nil || a.Credential == nil {
		return nil, errors.New("invalid credential JSON")
	}
	return &a, nil
}
func (s *Store) Account(id string) (*Account, error) {
	return scanAccount(s.DB.QueryRow(`SELECT id,key_id,content,credential FROM fr_accounts WHERE id=?`, id))
}
func (s *Store) Accounts() ([]Account, error) {
	rows, e := s.DB.Query(`SELECT id,key_id,content,credential FROM fr_accounts ORDER BY json_extract(content,'$.person')`)
	if e != nil {
		return nil, e
	}
	defer rows.Close()
	list := []Account{}
	for rows.Next() {
		a, e := scanAccount(rows)
		if e != nil {
			return nil, e
		}
		list = append(list, *a)
	}
	return list, rows.Err()
}
func (s *Store) Save(a *Account) error {
	_, e := s.DB.Exec(`INSERT INTO fr_accounts VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET content=excluded.content,credential=excluded.credential`, a.ID, a.KeyID, JSON(a.Content), JSON(a.Credential))
	return e
}
func (s *Store) UpdateContent(id string, fn func(Object) error) error {
	tx, e := s.DB.Begin()
	if e != nil {
		return e
	}
	defer tx.Rollback()
	var raw string
	if e = tx.QueryRow(`SELECT content FROM fr_accounts WHERE id=?`, id).Scan(&raw); e != nil {
		return e
	}
	var c Object
	if e = json.Unmarshal([]byte(raw), &c); e != nil || c == nil {
		return errors.New("invalid account content")
	}
	if e = fn(c); e != nil {
		return e
	}
	if _, e = tx.Exec(`UPDATE fr_accounts SET content=? WHERE id=?`, JSON(c), id); e != nil {
		return e
	}
	return tx.Commit()
}

// Only a verified existing central identity may create this local projection.
func (s *Store) Provision(issuer, client, subject, name string) (*Account, error) {
	tx, e := s.DB.Begin()
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	var id string
	e = tx.QueryRow(`SELECT account_id FROM fr_identities WHERE issuer=? AND client_id=? AND subject=?`, issuer, client, subject).Scan(&id)
	if e == sql.ErrNoRows {
		// Existing explicit FastCAS links take precedence. Revoked/prepared links
		// must never silently turn into a new local account.
		var state string
		e = tx.QueryRow(`SELECT account_id,state FROM fastcas_links WHERE issuer=? AND client_id=? AND subject=? ORDER BY version DESC LIMIT 1`, issuer, client, subject).Scan(&id, &state)
		if e == nil && state != "active" {
			return nil, errors.New("legacy FastCAS link is not active")
		}
		if e != nil && e != sql.ErrNoRows {
			var exists int
			if check := tx.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='fastcas_links'`).Scan(&exists); check != nil || exists != 0 {
				return nil, e
			}
		}
		if e != nil {
			id = "account_" + Random()[:32]
			a := &Account{id, Random()[:20], Object{"person": name, "createdAt": Now(), "recentArticles": []any{}, "insightItems": []any{}, "followedAuthors": []any{}, "customResearchTags": []any{}, "inbox": []any{}}, Object{}}
			if _, e = tx.Exec(`INSERT INTO fr_accounts VALUES(?,?,?,?)`, id, a.KeyID, JSON(a.Content), JSON(a.Credential)); e != nil {
				return nil, e
			}
		}
		if _, e = tx.Exec(`INSERT INTO fr_identities VALUES(?,?,?,?)`, issuer, client, subject, id); e != nil {
			return nil, e
		}
	} else if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return s.Account(id)
}
func (s *Store) PutSession(raw string, v *Session) error {
	_, e := s.DB.Exec(`INSERT INTO fr_sessions VALUES(?,?,?) ON CONFLICT(hash) DO UPDATE SET payload=excluded.payload,expires=excluded.expires`, Hash(raw), JSON(v), v.ExpiresAt)
	return e
}
func (s *Store) Session(raw string) (*Session, error) {
	var p string
	e := s.DB.QueryRow(`SELECT payload FROM fr_sessions WHERE hash=? AND expires>?`, Hash(raw), time.Now().UnixMilli()).Scan(&p)
	if e != nil {
		return nil, e
	}
	var v Session
	e = json.Unmarshal([]byte(p), &v)
	return &v, e
}
func (s *Store) DeleteSession(raw string) error {
	_, e := s.DB.Exec(`DELETE FROM fr_sessions WHERE hash=?`, Hash(raw))
	return e
}
func (s *Store) AllowAttempt(id string, limit int) bool {
	var count int
	e := s.DB.QueryRow(`INSERT INTO fr_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=CASE WHEN expires>? THEN attempts+1 ELSE 1 END,expires=CASE WHEN expires>? THEN expires ELSE excluded.expires END RETURNING attempts`, Hash(id), time.Now().Add(15*time.Minute).UnixMilli(), time.Now().UnixMilli(), time.Now().UnixMilli()).Scan(&count)
	return e == nil && count <= limit
}

// Refresh only an existing session. A concurrent logout/event must never be
// undone by an in-flight provider validation.
func (s *Store) UpdateSession(raw string, v *Session) error {
	r, e := s.DB.Exec(`UPDATE fr_sessions SET payload=?,expires=? WHERE hash=? AND expires>?`, JSON(v), v.ExpiresAt, Hash(raw), time.Now().UnixMilli())
	if e != nil {
		return e
	}
	n, e := r.RowsAffected()
	if e != nil {
		return e
	}
	if n != 1 {
		return errors.New("session revoked during validation")
	}
	return nil
}
