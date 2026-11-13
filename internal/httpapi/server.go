package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/FastR-D/FastResearch/internal/config"
	"github.com/FastR-D/FastResearch/internal/identity"
	"github.com/FastR-D/FastResearch/internal/integrations"
	"github.com/FastR-D/FastResearch/internal/store"
	"github.com/FastR-D/FastResearch/internal/workflow"
)

type Server struct {
	Workflows       *workflow.Store
	WriteClient     *integrations.Client
	ActivityClients map[string]*integrations.Client
	Config          config.Config
	Store           *store.Store
	CAS             *identity.CAS
	mux             *http.ServeMux
	HTTP            *http.Client
}
type principal struct {
	Session *store.Session
	Account *store.Account
	Raw     string
}
type apiError struct {
	Status  int
	Message string
}

func (e *apiError) Error() string       { return e.Message }
func fail(status int, msg string) error { return &apiError{status, msg} }
func New(c config.Config, s *store.Store, cas *identity.CAS, workflows *workflow.Store, writeClient *integrations.Client) *Server {
	a := &Server{Config: c, Store: s, CAS: cas, mux: http.NewServeMux(), HTTP: &http.Client{Timeout: 15 * time.Second}}
	a.Workflows = workflows
	a.WriteClient = writeClient
	a.routes()
	return a
}
func write(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	if status != 204 {
		_ = json.NewEncoder(w).Encode(v)
	}
}
func body(r *http.Request) (store.Object, error) {
	defer r.Body.Close()
	d := json.NewDecoder(io.LimitReader(r.Body, 1048577))
	var b store.Object
	if e := d.Decode(&b); e != nil || b == nil {
		return nil, fail(400, "请求体必须是 JSON 对象")
	}
	if d.Decode(new(any)) != io.EOF {
		return nil, fail(400, "请求体过大或包含多余数据")
	}
	return b, nil
}
func (a *Server) endpoint(pattern string, fn func(http.ResponseWriter, *http.Request) error) {
	a.mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
		if e := fn(w, r); e != nil {
			var api *apiError
			if errors.As(e, &api) {
				write(w, api.Status, store.Object{"error": api.Message})
			} else {
				slog.Error("request failed", "path", r.URL.Path, "error", e)
				write(w, 500, store.Object{"error": "操作未完成，请重试"})
			}
		}
	})
}
func (a *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	if a.gateway(w, r) {
		return
	}
	origin := r.Header.Get("Origin")
	if origin != "" && a.Config.Origins[origin] {
		w.Header().Set("Access-Control-Allow-Origin", origin)
		w.Header().Set("Access-Control-Allow-Credentials", "true")
		w.Header().Add("Vary", "Origin")
	}
	if r.Method == "OPTIONS" {
		if !a.Config.Origins[origin] {
			write(w, 403, store.Object{"error": "不允许的来源"})
			return
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, Idempotency-Key, X-FastInsight-Key")
		w.WriteHeader(204)
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" && origin != "" && !a.Config.Origins[origin] {
		write(w, 403, store.Object{"error": "不允许跨站操作"})
		return
	}
	if r.Method != "GET" && r.Method != "HEAD" && r.Header.Get("Sec-Fetch-Site") == "cross-site" && origin == "" {
		write(w, 403, store.Object{"error": "不允许跨站操作"})
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 1<<20)
	a.mux.ServeHTTP(w, r)
}
func (a *Server) token(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if c, e := r.Cookie(a.Config.CookieName); e == nil {
		return c.Value
	}
	return ""
}
func (a *Server) cookie(w http.ResponseWriter, name, value string, maxAge int, scope string) {
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: scope, Domain: a.Config.CookieDomain, HttpOnly: true, Secure: strings.HasPrefix(a.Config.PublicURL, "https://"), SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}
func (a *Server) member(r *http.Request, admin bool) (*principal, error) {
	raw := a.token(r)
	s, e := a.Store.Session(raw)
	if e != nil {
		return nil, fail(401, "请使用 FastCAS 登录")
	}
	if e = a.CAS.Validate(r.Context(), raw, s, admin); e != nil {
		return nil, fail(401, "FastCAS 会话验证失败，请重新登录")
	}
	account, e := a.Store.Account(s.AccountID)
	if e != nil || store.String(account.Content["accountDisabledAt"]) != "" {
		return nil, fail(401, "账号不可用")
	}
	if s.Source == "key" && (!active(account) || version(account) != s.CredentialVersion) {
		return nil, fail(401, "个人 Key 已撤销或已过期")
	}
	if admin && s.Role != "admin" {
		return nil, fail(403, "需要 FastCAS 管理员权限")
	}
	return &principal{s, account, raw}, nil
}
func active(a *store.Account) bool {
	if store.String(a.Credential["keyHash"]) == "" || store.String(a.Credential["revokedAt"]) != "" {
		return false
	}
	if raw := store.String(a.Credential["expiresAt"]); raw != "" {
		t, e := time.Parse(time.RFC3339, raw)
		return e == nil && t.After(time.Now())
	}
	return true
}
func version(a *store.Account) float64 {
	v := store.Number(a.Credential["credentialVersion"])
	if v == 0 {
		return 1
	}
	return v
}
func array(v any) []any {
	if v, ok := v.([]any); ok {
		return v
	}
	return []any{}
}
func object(v any) store.Object {
	if v, ok := v.(map[string]any); ok {
		return v
	}
	return store.Object{}
}
func content(a *store.Account) store.Object {
	c := a.Content
	inbox := array(c["inbox"])
	unread := 0
	for _, v := range inbox {
		if object(v)["read"] != true {
			unread++
		}
	}
	return store.Object{"person": c["person"], "keyId": a.KeyID, "accountId": a.ID, "recentArticles": array(c["recentArticles"]), "insightItems": array(c["insightItems"]), "authors": array(c["followedAuthors"]), "customTags": array(c["customResearchTags"]), "impression": impression(c["researchImpression"]), "inboxUnread": unread, "workflow": workflowView(c["workflow"])}
}
func impression(v any) store.Object {
	o := object(v)
	return store.Object{"text": store.String(o["text"]), "updatedAt": store.String(o["updatedAt"])}
}
func (a *Server) routes() {
	a.endpoint("GET /api/health", func(w http.ResponseWriter, r *http.Request) error {
		if e := a.Store.DB.PingContext(r.Context()); e != nil {
			return e
		}
		write(w, 200, store.Object{"ok": true, "runtime": "go"})
		return nil
	})
	a.authRoutes()
	a.contentRoutes()
	a.adminRoutes()
	a.workflowRoutes()
	a.integrationRoutes()
	a.workspaceRoutes()
	a.endpoint("/api/", func(w http.ResponseWriter, r *http.Request) error { return fail(404, "接口不存在") })
	a.endpoint("/", a.static)
}
func (a *Server) static(w http.ResponseWriter, r *http.Request) error {
	if r.Method != "GET" && r.Method != "HEAD" {
		return fail(405, "不支持的操作")
	}
	cleaned := path.Clean("/" + r.URL.Path)
	for _, segment := range strings.Split(cleaned, "/") {
		if strings.HasPrefix(segment, ".") {
			return fail(404, "页面不存在")
		}
	}
	if cleaned == "/fastppt" || cleaned == "/fastppt/" {
		http.Redirect(w, r, "/intro/ppt", 302)
		return nil
	}
	file := filepath.Join(a.Config.StaticDir, filepath.FromSlash(cleaned))
	info, e := os.Stat(file)
	if e != nil || info.IsDir() {
		if cleaned != "/" && cleaned != "/workspace" && cleaned != "/intro" && !strings.HasPrefix(cleaned, "/intro/") {
			return fail(404, "页面不存在")
		}
		file = filepath.Join(a.Config.StaticDir, "index.html")
	}
	real, e := filepath.EvalSymlinks(file)
	if e != nil {
		return fail(404, "前端尚未构建")
	}
	root, e := filepath.EvalSymlinks(a.Config.StaticDir)
	if e != nil {
		return e
	}
	root, _ = filepath.Abs(root)
	real, _ = filepath.Abs(real)
	if !strings.HasPrefix(real, root+string(os.PathSeparator)) {
		return fail(404, "页面不存在")
	}
	if strings.Contains(cleaned, "/assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else {
		w.Header().Set("Cache-Control", "no-cache")
	}
	http.ServeFile(w, r, file)
	return nil
}
func Run(ctx context.Context, c config.Config, a http.Handler) error {
	srv := &http.Server{Addr: c.Address, Handler: a, ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second, IdleTimeout: 90 * time.Second}
	go func() {
		<-ctx.Done()
		stop, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = srv.Shutdown(stop)
	}()
	slog.Info("FastResearch listening", "address", c.Address)
	e := srv.ListenAndServe()
	if e == http.ErrServerClosed {
		return nil
	}
	return e
}

func remoteIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return ip
}
