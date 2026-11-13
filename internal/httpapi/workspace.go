package httpapi

import (
	"net/http"
	"net/url"
	"strings"

	"github.com/FastR-D/FastResearch/internal/integrations"
	"github.com/FastR-D/FastResearch/internal/store"
)

func (a *Server) workspaceRoutes() {
	a.endpoint("GET /api/workspace/apps/{id}/activity", a.appActivity)
	a.endpoint("GET /api/workspace/apps/{id}/register", func(w http.ResponseWriter, r *http.Request) error {
		for _, app := range integrations.Apps() {
			if app.ID == r.PathValue("id") {
				if app.RegistrationTarget == "" {
					return fail(503, "该应用尚未配置账号开通入口")
				}
				w.Header().Set("Cache-Control", "no-store")
				http.Redirect(w, r, app.RegistrationTarget, 302)
				return nil
			}
		}
		return fail(404, "应用不存在")
	})
	a.endpoint("GET /api/workspace/apps", func(w http.ResponseWriter, r *http.Request) error {
		write(w, 200, store.Object{"apps": integrations.Apps()})
		return nil
	})
	a.endpoint("GET /api/workspace/apps/{id}/launch", func(w http.ResponseWriter, r *http.Request) error {
		for _, app := range integrations.Apps() {
			if app.ID == r.PathValue("id") {
				if !app.Configured {
					return fail(503, "应用入口尚未配置")
				}
				w.Header().Set("Cache-Control", "no-store")
				http.Redirect(w, r, app.Target, 302)
				return nil
			}
		}
		return fail(404, "应用不存在")
	})
	for _, pattern := range []string{"GET /read", "GET /read/{path...}"} {
		a.endpoint(pattern, func(w http.ResponseWriter, r *http.Request) error {
			base := integrations.First("FASTREAD_PUBLIC_URL", "VITE_READ_URL", "FASTREAD_URL")
			if base == "" {
				return fail(503, "FastRead 入口未配置")
			}
			u, e := url.Parse(base)
			if e != nil || u.Host == "" || u.User != nil || (u.Scheme != "https" && u.Scheme != "http") {
				return fail(503, "FastRead 入口无效")
			}
			u.Path = strings.TrimRight(u.Path, "/") + "/" + strings.TrimPrefix(strings.TrimPrefix(r.URL.Path, "/read"), "/")
			u.RawQuery = r.URL.RawQuery
			w.Header().Set("Cache-Control", "no-store")
			http.Redirect(w, r, u.String(), 302)
			return nil
		})
	}

}
