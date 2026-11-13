package httpapi

import (
	"context"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"

	"github.com/FastR-D/FastResearch/internal/store"
)

func (a *Server) authRoutes() {
	a.endpoint("GET /api/auth/fastcas/available", func(w http.ResponseWriter, r *http.Request) error {
		write(w, 200, store.Object{"enabled": a.CAS.Client != nil, "login_enabled": a.CAS.Client != nil, "link_enabled": false, "registration_enabled": false, "legacy_key_enabled": a.Config.LegacyKeys})
		return nil
	})
	for _, p := range []string{"/api/auth/register", "/api/register", "/api/auth/signup", "/api/auth/fastcas/register", "/api/auth/fastcas/registration", "/api/admin/login", "/api/auth/login"} {
		a.endpoint(p, func(w http.ResponseWriter, r *http.Request) error {
			return fail(403, "不开放自行注册或本地密码登录，请使用管理员分配的 FastCAS 账号")
		})
	}
	a.endpoint("GET /api/auth/fastcas/login", func(w http.ResponseWriter, r *http.Request) error {
		if a.CAS.Client == nil {
			return fail(503, "FastCAS 尚未配置")
		}
		if !a.Store.AllowAttempt("login:"+remoteIP(r), 60) {
			return fail(429, "登录尝试过多")
		}
		location, binding, e := a.CAS.Begin(r.Context(), r.URL.Query().Get("next"))
		if e != nil {
			return fail(502, "FastCAS 暂时不可用")
		}
		a.cookie(w, "fr_fastcas_binding", binding, 300, "/api/auth/fastcas")
		w.Header().Set("Cache-Control", "no-store")
		http.Redirect(w, r, location, 302)
		return nil
	})
	a.endpoint("GET /api/auth/fastcas/callback", func(w http.ResponseWriter, r *http.Request) error {
		a.cookie(w, "fr_fastcas_binding", "", -1, "/api/auth/fastcas")
		binding, e := r.Cookie("fr_fastcas_binding")
		if e != nil || a.CAS.Client == nil {
			http.Redirect(w, r, "/workspace?fastcas=failed", 302)
			return nil
		}
		// Never construct the callback authority from untrusted Host/forwarded headers.
		raw, returnTo, e := a.CAS.Finish(r.Context(), a.Config.RedirectURI+"?"+r.URL.RawQuery, binding.Value)
		if e != nil {
			http.Redirect(w, r, "/workspace?fastcas=failed", 302)
			return nil
		}
		session, e := a.Store.Session(raw)
		if e != nil {
			return e
		}
		maxAge := max(1, int(time.Until(time.UnixMilli(session.ExpiresAt)).Seconds()))
		a.cookie(w, a.Config.CookieName, raw, maxAge, "/")
		w.Header().Set("Cache-Control", "no-store")
		destination, _ := url.Parse(returnTo)
		query := destination.Query()
		query.Set("fastcas", "complete")
		destination.RawQuery = query.Encode()
		http.Redirect(w, r, destination.String(), 302)
		return nil
	})
	a.endpoint("GET /api/auth/fastcas/status", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		write(w, 200, store.Object{"enabled": a.CAS.Client != nil, "link_enabled": false, "registration_enabled": false, "role": p.Session.Role, "link": store.Object{"state": "active"}, "source": p.Session.Source})
		return nil
	})
	for _, path := range []string{"/api/auth/fastcas/link", "/api/auth/fastcas/revoke", "/api/auth/fastcas/reconcile"} {
		a.endpoint("POST "+path, func(w http.ResponseWriter, r *http.Request) error { return fail(403, "账号统一由 FastCAS 管理") })
	}
	a.endpoint("POST /api/auth/fastcas/events", func(w http.ResponseWriter, r *http.Request) error {
		if a.CAS.Client == nil {
			return fail(404, "FastCAS 未配置")
		}
		if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/jwt" {
			return fail(415, "需要签名事件")
		}
		raw, e := io.ReadAll(io.LimitReader(r.Body, 65537))
		if e != nil || len(raw) > 65536 {
			return fail(400, "通知过大")
		}
		applied := false
		e = a.CAS.Client.HandleNotification(r.Context(), string(raw), func(ctx context.Context, n fastcas.Notification) error {
			applied = true
			if n.Type == "identity.status_changed" && n.Status != "disabled" {
				return nil
			}
			subject := n.Subject
			if n.Link != nil {
				subject = n.Link.Subject
			}
			return a.CAS.Logout(ctx, n.ID, subject, "", n.Link)
		})
		if e != nil {
			if applied {
				return fail(503, "通知未保存，请重试")
			}
			return fail(401, "签名事件无效")
		}
		write(w, 200, store.Object{"ok": true})
		return nil
	})
	a.endpoint("POST /api/auth/fastcas/backchannel-logout", func(w http.ResponseWriter, r *http.Request) error {
		if a.CAS.Client == nil {
			return fail(404, "FastCAS 未配置")
		}
		if strings.Split(r.Header.Get("Content-Type"), ";")[0] != "application/x-www-form-urlencoded" {
			return fail(415, "需要标准退出通知")
		}
		raw, e := io.ReadAll(io.LimitReader(r.Body, 65537))
		if e != nil || len(raw) > 65536 {
			return fail(400, "通知过大")
		}
		form, e := url.ParseQuery(string(raw))
		if e != nil || len(form) != 1 || len(form["logout_token"]) != 1 {
			return fail(400, "退出通知无效")
		}
		n, e := a.CAS.Client.VerifyLogout(r.Context(), form.Get("logout_token"))
		if e != nil {
			return fail(401, "退出通知签名无效")
		}
		if e = a.CAS.Logout(r.Context(), n.ID, n.Subject, n.SessionID, nil); e != nil {
			return fail(503, "通知未保存，请重试")
		}
		write(w, 200, store.Object{"ok": true})
		return nil
	})
	for _, path := range []string{"/api/content/logout", "/api/admin/logout", "/api/auth/logout"} {
		a.endpoint("POST "+path, func(w http.ResponseWriter, r *http.Request) error {
			if e := a.Store.DeleteSession(a.token(r)); e != nil {
				return e
			}
			a.cookie(w, a.Config.CookieName, "", -1, "/")
			write(w, 200, store.Object{"ok": true})
			return nil
		})
	}
	a.endpoint("POST /api/content/unlock", func(w http.ResponseWriter, r *http.Request) error {
		if !a.Config.LegacyKeys {
			return fail(403, "个人 Key 登录已关闭，请使用 FastCAS")
		}
		if !a.Store.AllowAttempt("key:"+remoteIP(r), 12) {
			return fail(429, "认证尝试过多")
		}
		b, e := body(r)
		if e != nil {
			return e
		}
		records, e := a.Store.Accounts()
		if e != nil {
			return e
		}
		for _, record := range records {
			if active(&record) && store.Hash(store.String(b["key"])) == store.String(record.Credential["keyHash"]) {
				raw := store.Random()
				s := &store.Session{AccountID: record.ID, Source: "key", Role: "member", ExpiresAt: time.Now().Add(48 * time.Hour).UnixMilli(), CredentialVersion: version(&record)}
				if e = a.Store.PutSession(raw, s); e != nil {
					return e
				}
				a.cookie(w, a.Config.CookieName, raw, 48*3600, "/")
				v := content(&record)
				v["session"] = ""
				v["expiresAt"] = s.ExpiresAt
				v["source"] = "key"
				v["role"] = "member"
				write(w, 200, v)
				return nil
			}
		}
		return fail(401, "个人 Key 无效")
	})
}
