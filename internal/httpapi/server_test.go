package httpapi

import (
	"crypto/rand"
	"crypto/rsa"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	jose "github.com/go-jose/go-jose/v4"

	"github.com/FastR-D/FastResearch/internal/config"
	"github.com/FastR-D/FastResearch/internal/identity"
	"github.com/FastR-D/FastResearch/internal/integrations"
	"github.com/FastR-D/FastResearch/internal/store"
	"github.com/FastR-D/FastResearch/internal/workflow"
)

type providerFixture struct {
	key           *rsa.PrivateKey
	expireInitial bool
	allowOffline  bool
	URL           string
	signer        jose.Signer
	mu            sync.Mutex
	role, subject string
	disabled      bool
	codes         map[string]string
	refreshes     int
}

func (f *providerFixture) sign(t *testing.T, typ string, claims store.Object) string {
	t.Helper()
	key, e := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: f.key, KeyID: "test-key"}}, (&jose.SignerOptions{}).WithType(jose.ContentType(typ)))
	if e != nil {
		t.Fatal(e)
	}
	raw, e := key.Sign([]byte(store.JSON(claims)))
	if e != nil {
		t.Fatal(e)
	}
	s, e := raw.CompactSerialize()
	if e != nil {
		t.Fatal(e)
	}
	return s
}
func newProvider(t *testing.T) *providerFixture {
	t.Helper()
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	signer, e := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: jose.JSONWebKey{Key: key, KeyID: "test-key"}}, (&jose.SignerOptions{}).WithType("JWT"))
	if e != nil {
		t.Fatal(e)
	}
	f := &providerFixture{key: key, signer: signer, role: "admin", subject: "central-user", codes: map[string]string{}}
	mux := http.NewServeMux()
	server := httptest.NewServer(mux)
	f.URL = server.URL
	t.Cleanup(server.Close)
	mux.HandleFunc("GET /.well-known/openid-configuration", func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, store.Object{"issuer": f.URL, "authorization_endpoint": f.URL + "/authorize", "token_endpoint": f.URL + "/token", "jwks_uri": f.URL + "/jwks", "userinfo_endpoint": f.URL + "/userinfo", "introspection_endpoint": f.URL + "/introspect", "id_token_signing_alg_values_supported": []string{"RS256"}})
	})
	mux.HandleFunc("GET /jwks", func(w http.ResponseWriter, r *http.Request) {
		write(w, 200, jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &key.PublicKey, KeyID: "test-key", Algorithm: "RS256", Use: "sig"}}})
	})
	mux.HandleFunc("GET /authorize", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if r.URL.Query().Get("code_challenge_method") != "S256" {
			t.Error("PKCE S256 required")
		}
		if strings.Contains(r.URL.Query().Get("scope"), "offline_access") && !f.allowOffline {
			u, _ := url.Parse(r.URL.Query().Get("redirect_uri"))
			q := u.Query()
			q.Set("error", "invalid_scope")
			q.Set("state", r.URL.Query().Get("state"))
			u.RawQuery = q.Encode()
			http.Redirect(w, r, u.String(), 302)
			return
		}
		code := store.Random()
		f.codes[code] = r.URL.Query().Get("nonce")
		u, _ := url.Parse(r.URL.Query().Get("redirect_uri"))
		q := u.Query()
		q.Set("code", code)
		q.Set("state", r.URL.Query().Get("state"))
		u.RawQuery = q.Encode()
		http.Redirect(w, r, u.String(), 302)
	})
	mux.HandleFunc("POST /token", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		_ = r.ParseForm()
		nonce, ok := f.codes[r.Form.Get("code")]
		if r.Form.Get("grant_type") == "refresh_token" {
			f.refreshes++
			ok = true
		}
		if !ok || r.Form.Get("grant_type") == "authorization_code" && r.Form.Get("code_verifier") == "" {
			write(w, 400, store.Object{"error": "invalid_grant"})
			return
		}
		delete(f.codes, r.Form.Get("code"))
		claims := store.Object{"iss": f.URL, "sub": f.subject, "aud": "research", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "nonce": nonce, "sid": "central-session"}
		token := f.sign(t, "JWT", claims)
		lifetime := 3600
		if f.expireInitial && r.Form.Get("grant_type") == "authorization_code" {
			lifetime = 1
		}
		response := store.Object{"access_token": "provider-access-secret", "token_type": "Bearer", "expires_in": lifetime, "id_token": token}
		if f.allowOffline {
			response["refresh_token"] = "provider-refresh-secret"
		}
		write(w, 200, response)
	})
	mux.HandleFunc("GET /userinfo", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.disabled || r.Header.Get("Authorization") != "Bearer provider-access-secret" {
			write(w, 401, store.Object{"error": "invalid_token"})
			return
		}
		write(w, 200, store.Object{"sub": f.subject, "name": "研究员", "email": "research@example.test", "email_verified": true, "role": f.role})
	})

	mux.HandleFunc("POST /introspect", func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		_ = r.ParseForm()
		signed, e := jose.ParseSigned(r.Form.Get("token"), []jose.SignatureAlgorithm{jose.RS256})
		if e != nil {
			write(w, 200, store.Object{"active": false})
			return
		}
		raw, e := signed.Verify(&key.PublicKey)
		if e != nil {
			write(w, 200, store.Object{"active": false})
			return
		}
		claims := store.Decode(string(raw))
		write(w, 200, store.Object{"active": !f.disabled, "sub": claims["sub"], "client_id": claims["client_id"], "aud": claims["aud"], "scope": claims["scope"]})
	})
	return f
}
func setup(t *testing.T) (*Server, *httptest.Server, *providerFixture) {
	t.Helper()
	provider := newProvider(t)
	data := t.TempDir()
	static := t.TempDir()
	if e := os.WriteFile(filepath.Join(static, "index.html"), []byte("<!doctype html><title>Research</title>"), 0600); e != nil {
		t.Fatal(e)
	}
	c := config.Config{DataDir: data, Database: filepath.Join(data, "accounts.sqlite"), StaticDir: static, CookieName: "fr_session", Issuer: provider.URL, ClientID: "research", ClientSecret: "client-secret", AllowLoopbackHTTP: true, Origins: map[string]bool{}}
	server := httptest.NewUnstartedServer(nil)
	c.PublicURL = "http://" + server.Listener.Addr().String()
	c.RedirectURI = c.PublicURL + "/api/auth/fastcas/callback"
	c.Origins[c.PublicURL] = true
	s, e := store.Open(c.Database)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { s.Close() })
	cas, e := identity.New(c, s)
	if e != nil {
		t.Fatal(e)
	}
	wf, e := workflow.Open(data)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { wf.DB.Close() })
	a := New(c, s, cas, wf, &integrations.Client{})
	server.Config.Handler = a
	server.Start()
	t.Cleanup(server.Close)
	return a, server, provider
}
func request(t *testing.T, client *http.Client, method, url, raw string) (int, store.Object) {
	t.Helper()
	req, e := http.NewRequest(method, url, strings.NewReader(raw))
	if e != nil {
		t.Fatal(e)
	}
	if raw != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	defer resp.Body.Close()
	data := store.Object{}
	_ = json.NewDecoder(resp.Body).Decode(&data)
	return resp.StatusCode, data
}
func login(t *testing.T, server *httptest.Server) *http.Client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, Timeout: 5 * time.Second}
	resp, e := client.Get(server.URL + "/api/auth/fastcas/login")
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.Request.URL.Path != "/workspace" || resp.Request.URL.Query().Get("fastcas") != "complete" {
		t.Fatalf("login failed: %s", resp.Request.URL)
	}
	return client
}
func TestCentralLoginAndLiveAdminRole(t *testing.T) {
	a, server, provider := setup(t)
	client := login(t, server)
	status, me := request(t, client, "GET", server.URL+"/api/content/me", "")
	if status != 200 || me["role"] != "admin" || me["source"] != "fastcas" || me["session"] != "" {
		t.Fatalf("identity response: %d %#v", status, me)
	}
	id := store.String(me["accountId"])
	for _, route := range []string{"/api/admin/me", "/api/admin/keys"} {
		status, _ = request(t, client, "GET", server.URL+route, "")
		if status != 200 {
			t.Fatalf("central administrator denied %s: %d", route, status)
		}
	}
	status, _ = request(t, client, "PUT", server.URL+"/api/content/impression", `{"text":"keep this research note"}`)
	if status != 200 {
		t.Fatal(status)
	}
	var payload string
	if e := a.Store.DB.QueryRow(`SELECT payload FROM fr_sessions`).Scan(&payload); e != nil {
		t.Fatal(e)
	}
	if strings.Contains(payload, "provider-access-secret") || strings.Contains(payload, "provider-refresh-secret") {
		t.Fatal("plaintext provider token persisted")
	}
	provider.mu.Lock()
	provider.role = "member"
	provider.mu.Unlock()
	status, _ = request(t, client, "GET", server.URL+"/api/admin/keys", "")
	if status != 403 {
		t.Fatalf("downgraded administrator retained access: %d", status)
	}
	second := login(t, server)
	status, me = request(t, second, "GET", server.URL+"/api/content/me", "")
	if status != 200 || me["role"] != "member" || me["accountId"] != id {
		t.Fatalf("stable identity: %d %#v", status, me)
	}
	if object(me["impression"])["text"] != "keep this research note" {
		t.Fatal("research content lost")
	}
	provider.mu.Lock()
	provider.disabled = true
	provider.mu.Unlock()
	status, _ = request(t, second, "GET", server.URL+"/api/admin/keys", "")
	if status != 401 {
		t.Fatalf("disabled identity retained access: %d", status)
	}
	for _, route := range []string{"/api/auth/register", "/api/register", "/api/auth/signup", "/api/auth/fastcas/register", "/api/auth/fastcas/registration", "/api/admin/login", "/api/content/unlock", "/api/admin/keys"} {
		status, _ = request(t, client, "POST", server.URL+route, `{"role":"admin","email":"attacker@example.test"}`)
		if status < 400 {
			t.Fatalf("registration/local auth allowed at %s", route)
		}
	}
	accounts, e := a.Store.Accounts()
	if e != nil || len(accounts) != 1 {
		t.Fatalf("untrusted registration created account: %v %d", e, len(accounts))
	}
}
func TestCallbackBindingAndReplay(t *testing.T) {
	a, server, _ := setup(t)
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, e := client.Get(server.URL + "/api/auth/fastcas/login")
	if e != nil {
		t.Fatal(e)
	}
	location := resp.Header.Get("Location")
	resp.Body.Close()
	resp, e = client.Get(location)
	if e != nil {
		t.Fatal(e)
	}
	callback := resp.Header.Get("Location")
	resp.Body.Close()
	stranger := &http.Client{CheckRedirect: client.CheckRedirect}
	resp, e = stranger.Get(callback)
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.Header.Get("Location") != "/workspace?fastcas=failed" {
		t.Fatal("callback without browser binding accepted")
	}
	resp, e = client.Get(callback)
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.Header.Get("Location") != "/workspace?fastcas=complete" {
		t.Fatal("bound callback failed")
	}
	resp, e = client.Get(callback)
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.Header.Get("Location") != "/workspace?fastcas=failed" {
		t.Fatal("replayed callback accepted")
	}
	var n int
	_ = a.Store.DB.QueryRow(`SELECT count(*) FROM fr_accounts`).Scan(&n)
	if n != 1 {
		t.Fatalf("replay created %d accounts", n)
	}
}
func TestOriginBoundaryLogoutAndStaticRoutes(t *testing.T) {
	_, server, _ := setup(t)
	client := login(t, server)
	req, _ := http.NewRequest("PUT", server.URL+"/api/content/impression", strings.NewReader(`{"text":"forged"}`))
	req.Header.Set("Origin", "https://evil.test")
	resp, e := client.Do(req)
	if e != nil {
		t.Fatal(e)
	}
	resp.Body.Close()
	if resp.StatusCode != 403 {
		t.Fatal("cross-site mutation allowed")
	}
	for _, p := range []string{"/", "/workspace", "/intro/write"} {
		resp, e = client.Get(server.URL + p)
		if e != nil {
			t.Fatal(e)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 {
			t.Fatalf("static %s: %d", p, resp.StatusCode)
		}
	}
	for _, p := range []string{"/.env", "/unknown.js", "/api/not-found"} {
		status, _ := request(t, client, "GET", server.URL+p, "")
		if status != 404 {
			t.Fatalf("unexpected fallback %s: %d", p, status)
		}
	}
	status, _ := request(t, client, "POST", server.URL+"/api/auth/logout", `{}`)
	if status != 200 {
		t.Fatal(status)
	}
	status, _ = request(t, client, "GET", server.URL+"/api/content/me", "")
	if status != 401 {
		t.Fatal("logout retained session")
	}
}

func TestSignedLogoutAndDisableNotifications(t *testing.T) {
	a, server, provider := setup(t)
	client := login(t, server)
	now := time.Now()
	claims := store.Object{"iss": provider.URL, "sub": "central-user", "aud": "research", "iat": now.Unix(), "exp": now.Add(time.Minute).Unix(), "jti": "logout-event", "sid": "central-session", "events": store.Object{"http://schemas.openid.net/event/backchannel-logout": store.Object{}}}
	signed := provider.sign(t, "logout+jwt", claims)
	post := func(path, contentType, raw string) int {
		req, _ := http.NewRequest("POST", server.URL+path, strings.NewReader(raw))
		req.Header.Set("Content-Type", contentType)
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if status := post("/api/auth/fastcas/backchannel-logout", "application/x-www-form-urlencoded", url.Values{"logout_token": []string{signed}}.Encode()); status != 200 {
		t.Fatalf("signed logout rejected: %d", status)
	}
	if status, _ := request(t, client, "GET", server.URL+"/api/content/me", ""); status != 401 {
		t.Fatal("backchannel did not revoke session")
	}
	if status := post("/api/auth/fastcas/backchannel-logout", "application/x-www-form-urlencoded", url.Values{"logout_token": []string{signed}}.Encode()); status != 200 {
		t.Fatal("logout retry failed")
	}
	client = login(t, server)
	envelope := store.Object{"iss": provider.URL, "aud": "research", "iat": now.Unix(), "exp": now.Add(time.Minute).Unix(), "jti": "disable-event", "event": store.Object{"type": "identity.status_changed", "subject": "central-user", "status": "disabled", "version": 2}}
	notification := provider.sign(t, "fastcas-event+jwt", envelope)
	if status := post("/api/auth/fastcas/events", "application/jwt", notification+"broken"); status != 401 {
		t.Fatal("invalid signature accepted")
	}
	if status, _ := request(t, client, "GET", server.URL+"/api/content/me", ""); status != 200 {
		t.Fatal("invalid notification revoked session")
	}
	if status := post("/api/auth/fastcas/events", "application/jwt", notification); status != 200 {
		t.Fatalf("disable event rejected: %d", status)
	}
	if status, _ := request(t, client, "GET", server.URL+"/api/content/me", ""); status != 401 {
		t.Fatal("disable event did not revoke session")
	}
	var n int
	if e := a.Store.DB.QueryRow(`SELECT count(*) FROM fr_events`).Scan(&n); e != nil || n != 2 {
		t.Fatalf("notification dedupe: %d %v", n, e)
	}
}
func TestProviderTokenRefreshAndMissingRole(t *testing.T) {
	a, server, provider := setup(t)
	provider.expireInitial = true
	provider.allowOffline = true
	a.CAS.Config.OfflineAccess = true
	a.Config.OfflineAccess = true
	provider.role = ""
	client := login(t, server)
	if status, _ := request(t, client, "GET", server.URL+"/api/admin/keys", ""); status != 403 {
		t.Fatal("missing role granted administrator")
	}
	provider.mu.Lock()
	refreshes := provider.refreshes
	provider.role = "admin"
	provider.mu.Unlock()
	if refreshes != 1 {
		t.Fatalf("refresh token was not used: %d", refreshes)
	}
	// Reload the identity adapter to prove the vault key is persistent.
	restarted, e := identity.New(a.Config, a.Store)
	if e != nil {
		t.Fatal(e)
	}
	a.CAS = restarted
	if status, _ := request(t, client, "GET", server.URL+"/api/admin/keys", ""); status != 200 {
		t.Fatal("promoted central role not recognized")
	}
	provider.mu.Lock()
	provider.subject = "another-user"
	provider.mu.Unlock()
	if status, _ := request(t, client, "GET", server.URL+"/api/admin/keys", ""); status != 401 {
		t.Fatal("userinfo subject substitution accepted")
	}
}

func TestServicePublishingRequiresLiveScopedAccountGrant(t *testing.T) {
	a, server, provider := setup(t)
	client := login(t, server)
	_, me := request(t, client, "GET", server.URL+"/api/content/me", "")
	id := store.String(me["accountId"])
	t.Setenv("FASTRESEARCH_FASTCAS_INGEST_CLIENT_ID", "fastinsight")
	t.Setenv("FASTRESEARCH_FASTCAS_INGEST_ALLOWED_ACCOUNT_IDS", id)
	claims := store.Object{"iss": provider.URL, "sub": "fastinsight", "client_id": "fastinsight", "aud": []string{"research-api"}, "scope": "insight:publish", "service": true, "token_use": "access", "iat": time.Now().Unix(), "exp": time.Now().Add(time.Minute).Unix()}
	token := provider.sign(t, "JWT", claims)
	publish := func(raw, recipient string) int {
		req, _ := http.NewRequest("POST", server.URL+"/api/insight/publish", strings.NewReader(store.JSON(store.Object{"receiver_ref": recipient, "item": store.Object{"title": "New evidence"}})))
		req.Header.Set("Authorization", "Bearer "+raw)
		req.Header.Set("Content-Type", "application/json")
		resp, e := http.DefaultClient.Do(req)
		if e != nil {
			t.Fatal(e)
		}
		resp.Body.Close()
		return resp.StatusCode
	}
	if status := publish(token, "another-account"); status != 403 {
		t.Fatalf("cross-account publish allowed: %d", status)
	}
	if status := publish(token, id); status != 201 {
		t.Fatalf("service publish failed: %d", status)
	}
	provider.mu.Lock()
	provider.disabled = true
	provider.mu.Unlock()
	if status := publish(token, id); status != 401 {
		t.Fatal("revoked service token accepted")
	}
	record, e := a.Store.Account(id)
	if e != nil || len(array(record.Content["insightItems"])) != 1 {
		t.Fatal("failed service request changed content", e)
	}
}
func TestFastWriteHealthAndCompileWithoutBody(t *testing.T) {
	a, server, _ := setup(t)
	client := login(t, server)
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/health" {
			write(w, 200, store.Object{"ok": true})
			return
		}
		if r.Method != "POST" || r.URL.Path != "/api/integration/projects/project-1/compile" {
			t.Errorf("wrong compile target: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("X-FastResearch-Receiver-Ref") == "" {
			t.Error("missing account binding")
		}
		if r.ContentLength != 0 {
			t.Error("unexpected compile body")
		}
		write(w, 200, store.Object{"compiled": true})
	}))
	defer upstream.Close()
	a.WriteClient = &integrations.Client{Base: upstream.URL, Key: "fixture-key"}
	status, data := request(t, client, "GET", server.URL+"/api/fastwrite/status", "")
	if status != 200 || data["healthy"] != true {
		t.Fatal("health status did not reflect upstream", status, data)
	}
	status, data = request(t, client, "POST", server.URL+"/api/fastwrite/projects/project-1/compile", "")
	if status != 200 || data["compiled"] != true {
		t.Fatal("bodyless compile rejected", status, data)
	}
}

func TestLoginScopesRespectClientRegistration(t *testing.T) {
	a, server, provider := setup(t)
	// Mirrors the production research client: standard OIDC login scopes only.
	client := login(t, server)
	if status, me := request(t, client, "GET", server.URL+"/api/content/me", ""); status != 200 {
		t.Fatal("restricted client login failed", status)
	} else if store.Number(me["expiresAt"]) > float64(time.Now().Add(61*time.Minute).UnixMilli()) {
		t.Fatal("non-refreshable session exceeds provider credential", me["expiresAt"])
	}
	a.CAS.Config.OfflineAccess = true
	a.Config.OfflineAccess = true
	// The optional scope must be explicitly permitted by the provider as well.
	provider.allowOffline = true
	client = login(t, server)
	if status, _ := request(t, client, "GET", server.URL+"/api/content/me", ""); status != 200 {
		t.Fatal("registered offline access login failed", status)
	}
}

func TestCASLoginLifetimeAndWorkspaceReturn(t *testing.T) {
	for _, refresh := range []bool{false, true} {
		t.Run(fmt.Sprintf("refresh=%t", refresh), func(t *testing.T) {
			a, server, provider := setup(t)
			provider.allowOffline = refresh
			a.CAS.Config.OfflineAccess = refresh
			a.CAS.Config.CASSessionTTL = 14 * 24 * time.Hour
			jar, _ := cookiejar.New(nil)
			client := &http.Client{Jar: jar, Timeout: 5 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
				if req.URL.Path == "/workspace" {
					return http.ErrUseLastResponse
				}
				return nil
			}}
			response, err := client.Get(server.URL + "/api/auth/fastcas/login?next=" + url.QueryEscape("/workspace?view=insight"))
			if err != nil {
				t.Fatal(err)
			}
			response.Body.Close()
			target, _ := url.Parse(response.Header.Get("Location"))
			if target.Path != "/workspace" || target.Query().Get("view") != "insight" || target.Query().Get("fastcas") != "complete" {
				t.Fatalf("return state lost: %s", target)
			}
			var sessionCookie *http.Cookie
			for _, c := range response.Cookies() {
				if c.Name == a.Config.CookieName {
					sessionCookie = c
				}
			}
			if sessionCookie == nil {
				t.Fatal("session cookie missing")
			}
			session, err := a.Store.Session(sessionCookie.Value)
			if err != nil {
				t.Fatal(err)
			}
			want := time.Hour
			if refresh {
				want = 14 * 24 * time.Hour
			}
			remaining := time.Until(time.UnixMilli(session.ExpiresAt))
			if remaining < want-time.Minute || remaining > want+time.Minute {
				t.Fatalf("session lifetime %v, want %v", remaining, want)
			}
			if sessionCookie.MaxAge < int(want.Seconds())-60 || sessionCookie.MaxAge > int(want.Seconds()) {
				t.Fatalf("cookie lifetime disagrees with session: %d", sessionCookie.MaxAge)
			}
			if status, _ := request(t, client, "GET", server.URL+"/api/admin/keys", ""); status != 200 {
				t.Fatalf("admin validation failed: %d", status)
			}
			if status, _ := request(t, client, "POST", server.URL+"/api/content/logout", ""); status != 200 {
				t.Fatalf("logout failed: %d", status)
			}
			if _, err := a.Store.Session(sessionCookie.Value); err == nil {
				t.Fatal("long session survived explicit logout")
			}
		})
	}
}
