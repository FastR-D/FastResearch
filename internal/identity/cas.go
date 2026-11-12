// Package identity is the only boundary that turns verified FastCAS identities
// into local accounts. Registration and local administrator passwords are absent.
package identity

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sync"
	"time"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"
	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"

	"github.com/FastR-D/FastResearch/internal/config"
	"github.com/FastR-D/FastResearch/internal/store"
)

type CAS struct {
	Config    config.Config
	Store     *store.Store
	Client    *fastcas.Client
	HTTP      *http.Client
	cipher    cipher.AEAD
	mu        sync.Mutex
	provider  *oidc.Provider
	refreshMu sync.Mutex
}

func New(c config.Config, s *store.Store) (*CAS, error) {
	a := &CAS{Config: c, Store: s, HTTP: &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	if c.Issuer == "" {
		return a, nil
	}
	var err error
	a.Client, err = fastcas.New(fastcas.Config{Issuer: c.Issuer, ClientID: c.ClientID, ClientSecret: c.ClientSecret, RedirectURI: c.RedirectURI, AllowLoopbackHTTP: c.AllowLoopbackHTTP, HTTPClient: a.HTTP}, a)
	if err != nil {
		return nil, err
	}
	// The key is persisted separately from SQLite and backed up with the data volume.
	if err := os.MkdirAll(c.DataDir, 0700); err != nil {
		return nil, err
	}
	keyFile := filepath.Join(c.DataDir, "session-vault.key")
	key, err := os.ReadFile(keyFile)
	if os.IsNotExist(err) {
		key = make([]byte, 32)
		if _, err = rand.Read(key); err != nil {
			return nil, err
		}
		f, e := os.OpenFile(keyFile, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if e == nil {
			_, e = f.Write(key)
			if e == nil {
				e = f.Sync()
			}
			f.Close()
		}
		if os.IsExist(e) {
			key, e = os.ReadFile(keyFile)
		}
		err = e
	}
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	a.cipher, err = cipher.NewGCM(block)
	return a, err
}
func (a *CAS) Put(ctx context.Context, t fastcas.Transaction) error {
	_, e := a.Store.DB.ExecContext(ctx, `INSERT INTO fr_transactions VALUES(?,?,?)`, t.State, store.JSON(t), t.ExpiresAt.UnixMilli())
	return e
}
func (a *CAS) Take(ctx context.Context, state string) (*fastcas.Transaction, error) {
	var raw string
	e := a.Store.DB.QueryRowContext(ctx, `DELETE FROM fr_transactions WHERE state=? RETURNING payload`, state).Scan(&raw)
	if e == sql.ErrNoRows {
		return nil, nil
	}
	if e != nil {
		return nil, e
	}
	var t fastcas.Transaction
	e = json.Unmarshal([]byte(raw), &t)
	return &t, e
}
func (a *CAS) Begin(ctx context.Context) (string, string, error) {
	if a.Client == nil {
		return "", "", errors.New("FastCAS is not configured")
	}
	binding := fastcas.RandomBinding()
	location, e := a.Client.BeginLogin(ctx, fastcas.BeginOptions{BrowserBinding: binding, ReturnTo: "/workspace", Scopes: []string{"openid", "profile", "email", "offline_access"}})
	return location, binding, e
}
func (a *CAS) Provider(ctx context.Context) (*oidc.Provider, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.provider == nil {
		p, e := oidc.NewProvider(oidc.ClientContext(ctx, a.HTTP), a.Config.Issuer)
		if e != nil {
			return nil, e
		}

		var metadata fastcas.Metadata
		if e = p.Claims(&metadata); e != nil {
			return nil, e
		}
		for _, raw := range []string{metadata.TokenEndpoint, metadata.UserinfoEndpoint} {
			u, e := url.Parse(raw)
			if e != nil || u.User != nil || u.Fragment != "" || u.Scheme+"://"+u.Host != a.Config.Issuer {
				return nil, errors.New("provider endpoint does not belong to configured issuer")
			}
		}
		a.provider = p
	}
	return a.provider, nil
}
func (a *CAS) profile(ctx context.Context, token *oauth2.Token, subject string) (string, *oauth2.Token, error) {
	p, e := a.Provider(ctx)
	if e != nil {
		return "", nil, e
	}
	endpoint := p.Endpoint()
	endpoint.AuthStyle = oauth2.AuthStyleInHeader
	cfg := oauth2.Config{ClientID: a.Config.ClientID, ClientSecret: a.Config.ClientSecret, Endpoint: endpoint}
	token, e = cfg.TokenSource(oidc.ClientContext(ctx, a.HTTP), token).Token()
	if e != nil {
		return "", nil, e
	}
	profile, e := p.UserInfo(oidc.ClientContext(ctx, a.HTTP), oauth2.StaticTokenSource(token))
	if e != nil || profile.Subject != subject {
		return "", nil, errors.New("central identity unavailable or subject mismatch")
	}
	var claims struct {
		Role string `json:"role"`
	}
	if e = profile.Claims(&claims); e != nil {
		return "", nil, e
	}
	// Unknown or absent role can never grant administrator access.
	role := "member"
	if claims.Role == "admin" {
		role = "admin"
	}
	return role, token, nil
}
func (a *CAS) seal(token *oauth2.Token, subject string) string {
	nonce := make([]byte, a.cipher.NonceSize())
	if _, e := rand.Read(nonce); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(a.cipher.Seal(nonce, nonce, []byte(store.JSON(token)), []byte(a.Config.Issuer+"\x00"+subject)))
}
func (a *CAS) unseal(raw, subject string) (*oauth2.Token, error) {
	b, e := base64.RawURLEncoding.DecodeString(raw)
	if e != nil || len(b) < a.cipher.NonceSize() {
		return nil, errors.New("invalid token vault")
	}
	n := a.cipher.NonceSize()
	b, e = a.cipher.Open(nil, b[:n], b[n:], []byte(a.Config.Issuer+"\x00"+subject))
	if e != nil {
		return nil, e
	}
	var t oauth2.Token
	e = json.Unmarshal(b, &t)
	return &t, e
}
func (a *CAS) Finish(ctx context.Context, callback, binding string) (string, error) {
	result, e := a.Client.FinishLogin(ctx, callback, fastcas.FinishOptions{BrowserBinding: binding})
	if e != nil {
		return "", e
	}
	if result.Transaction.Purpose != "login" {
		return "", errors.New("self registration and linking are disabled")
	}
	role, token, e := a.profile(ctx, result.Token, result.Identity.Subject)
	if e != nil {
		return "", e
	}
	// The central identity already exists and is active. This creates only the
	// local content projection; no FastCAS account or registration intent is made.
	name := result.Identity.Name
	if name == "" {
		name = result.Identity.Email
	}
	if name == "" {
		name = "FastCAS 用户"
	}
	// An imported legacy binding must still be active at the provider.
	var id string
	e = a.Store.DB.QueryRow(`SELECT id FROM fastcas_links WHERE issuer=? AND client_id=? AND subject=? LIMIT 1`, a.Config.Issuer, a.Config.ClientID, result.Identity.Subject).Scan(&id)
	if e == nil {
		link, e := a.Client.ResolveLink(ctx, result.Identity.Subject)
		if e != nil || link.ID != id || link.State != "active" {
			return "", errors.New("legacy link is no longer active")
		}
	}
	account, e := a.Store.Provision(a.Config.Issuer, a.Config.ClientID, result.Identity.Subject, name)
	if e != nil {
		return "", e
	}
	if store.String(account.Content["accountDisabledAt"]) != "" {
		return "", errors.New("account disabled")
	}
	raw := store.Random()
	s := &store.Session{AccountID: account.ID, Source: "fastcas", Issuer: a.Config.Issuer, Subject: result.Identity.Subject, SID: result.Identity.SessionID, Role: role, ExpiresAt: time.Now().Add(48 * time.Hour).UnixMilli(), CheckedAt: time.Now().UnixMilli(), ProviderToken: a.seal(token, result.Identity.Subject)}
	if e = a.Store.PutSession(raw, s); e != nil {
		return "", e
	}
	return raw, nil
}
func (a *CAS) Validate(ctx context.Context, raw string, s *store.Session, privileged bool) error {
	if s.Source != "fastcas" {
		if !a.Config.LegacyKeys || privileged {
			return errors.New("FastCAS login required")
		}
		return nil
	}
	if a.Client == nil || s.Issuer != a.Config.Issuer {
		return errors.New("FastCAS disabled")
	}
	if !privileged && s.CheckedAt > time.Now().Add(-time.Minute).UnixMilli() {
		return nil
	}
	// Serialize refreshes so concurrent requests cannot replay a rotated refresh token.
	a.refreshMu.Lock()
	defer a.refreshMu.Unlock()
	fresh, e := a.Store.Session(raw)
	if e != nil {
		return e
	}
	*s = *fresh
	if !privileged && s.CheckedAt > time.Now().Add(-time.Minute).UnixMilli() {
		return nil
	}
	token, e := a.unseal(s.ProviderToken, s.Subject)
	if e != nil {
		return e
	}
	role, token, e := a.profile(ctx, token, s.Subject)
	if e != nil {
		return e
	}
	s.Role = role
	s.CheckedAt = time.Now().UnixMilli()
	s.ProviderToken = a.seal(token, s.Subject)
	return a.Store.UpdateSession(raw, s)
}

// Apply verified events and deduplication in one transaction. Failed commits
// propagate to the webhook so FastCAS can retry delivery.
func (a *CAS) Logout(ctx context.Context, id, subject, sid string, link *fastcas.Link) error {
	tx, e := a.Store.DB.BeginTx(ctx, nil)
	if e != nil {
		return e
	}
	defer tx.Rollback()
	r, e := tx.Exec(`INSERT OR IGNORE INTO fr_events VALUES(?,?)`, a.Config.Issuer, id)
	if e != nil {
		return e
	}
	n, _ := r.RowsAffected()
	if n == 0 {
		return tx.Commit()
	}
	if link != nil {
		_, e = tx.Exec(`UPDATE fastcas_links SET state='revoked',version=?,payload=? WHERE issuer=? AND id=? AND account_id=? AND subject=? AND version<=?`, link.Version, store.JSON(link), a.Config.Issuer, link.ID, link.LocalRef, link.Subject, link.Version)
		if e != nil {
			var exists int
			if err := tx.QueryRow(`SELECT count(*) FROM sqlite_master WHERE name='fastcas_links'`).Scan(&exists); err != nil || exists != 0 {
				return e
			}
		}
	}
	_, e = tx.Exec(`DELETE FROM fr_sessions WHERE json_extract(payload,'$.authSource')='fastcas' AND json_extract(payload,'$.casIssuer')=? AND json_extract(payload,'$.casSubject')=? AND (?='' OR json_extract(payload,'$.casSid')=?)`, a.Config.Issuer, subject, sid, sid)
	if e != nil {
		return e
	}
	return tx.Commit()
}
