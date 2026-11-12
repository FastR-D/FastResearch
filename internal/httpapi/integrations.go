package httpapi

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/FastR-D/FastResearch/internal/integrations"
	"github.com/FastR-D/FastResearch/internal/store"
)

func (a *Server) serviceTarget(r *http.Request, b store.Object, scope string) (*store.Account, error) {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	ref := store.String(b["receiver_ref"])
	if r.Header.Get("Authorization") != "" {
		if a.CAS.Client == nil || raw == r.Header.Get("Authorization") {
			return nil, fail(401, "需要服务令牌")
		}
		claims, e := a.CAS.Client.VerifyAccessToken(r.Context(), raw, "research-api", scope)
		if e != nil || !claims.Service || claims.Subject != claims.ClientID {
			return nil, fail(401, "服务令牌无效")
		}
		live, e := a.CAS.Client.IntrospectToken(r.Context(), raw)
		if e != nil || !live.Active || live.Subject != claims.Subject || live.ClientID != claims.ClientID || !slices.Contains(live.Audience, "research-api") || !slices.Contains(strings.Fields(live.Scope), scope) {
			return nil, fail(401, "服务令牌已失效")
		}
		allowed := false
		if scope == "insight:publish" && claims.ClientID == os.Getenv("FASTRESEARCH_FASTCAS_INGEST_CLIENT_ID") {
			allowed = slices.Contains(strings.Split(os.Getenv("FASTRESEARCH_FASTCAS_INGEST_ALLOWED_ACCOUNT_IDS"), ","), ref)
		} else {
			policy := map[string][]string{}
			_ = json.Unmarshal([]byte(os.Getenv("FASTRESEARCH_FASTCAS_ALLOWED_TARGETS")), &policy)
			allowed = slices.Contains(policy[claims.ClientID], ref)
		}
		if !allowed || ref == "" {
			return nil, fail(403, "收件人不在服务授权范围")
		}
	} else {
		enabled, key, header := "FASTRESEARCH_ALLOW_LEGACY_FASTINSIGHT_KEY", "FASTINSIGHT_INGEST_KEY", "X-FastInsight-Key"
		if scope == "workflow:publish" {
			enabled, key, header = "FASTRESEARCH_ALLOW_LEGACY_FASTTASK_KEYS", "FASTTASK_INGEST_KEY", "X-FastTask-Key"
		}
		expected := os.Getenv(key)
		if os.Getenv(enabled) != "true" || expected == "" || subtle.ConstantTimeCompare([]byte(expected), []byte(r.Header.Get(header))) != 1 {
			return nil, fail(401, "服务投递认证失败")
		}
		if ref == "" {
			return nil, fail(400, "必须指定 receiver_ref")
		}
	}
	account, e := a.Store.Account(ref)
	if e != nil || store.String(account.Content["accountDisabledAt"]) != "" {
		return nil, fail(404, "收件账号不存在或不可用")
	}
	return account, nil
}
func todayView(raw store.Object, configured bool) store.Object {
	out := store.Object{"configured": configured, "received": false, "items": []any{}, "progress": store.Object{"total": 0, "completed": 0, "inProgress": 0, "planned": 0, "skipped": 0}}
	if raw == nil {
		return out
	}
	items := []any{}
	for _, v := range array(raw["items"]) {
		o := object(v)
		items = append(items, store.Object{"id": o["id"], "taskId": o["task_id"], "kind": o["kind"], "title": o["title"], "commitment": o["commitment"], "minimumAction": o["minimum_action"], "status": o["status"], "completionType": o["completion_type"], "completionSummary": o["completion_summary"], "targetMinutes": o["target_minutes"], "position": o["position"], "workspace": o["workspace"]})
	}
	p := object(raw["progress"])
	out["received"] = len(items) > 0
	out["items"] = items
	out["progress"] = store.Object{"total": p["total"], "completed": p["completed"], "inProgress": p["in_progress"], "planned": p["planned"], "skipped": p["skipped"]}
	for k, v := range map[string]string{"date": "local_date", "timezone": "timezone", "planStatus": "plan_status", "planRevision": "plan_revision", "updatedAt": "updated_at", "error": "error"} {
		out[k] = raw[v]
	}
	return out
}
func (a *Server) today(r *http.Request, refs []any) (map[string]store.Object, bool, string) {
	by := map[string]store.Object{}
	if a.TaskClient == nil || !a.TaskClient.Configured() {
		return by, false, ""
	}
	data, e := a.TaskClient.Request(r.Context(), "POST", "/api/v1/integrations/fastresearch/today", store.Object{"receiver_refs": refs}, nil)
	if e != nil {
		return by, true, "FastTask 暂时不可用"
	}
	for _, v := range array(data["members"]) {
		o := object(v)
		by[store.String(o["receiver_ref"])] = o
	}
	return by, true, ""
}
func (a *Server) integrationRoutes() {
	a.endpoint("GET /api/fasttask/today", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		by, configured, errText := a.today(r, []any{p.Account.ID})
		view := todayView(by[p.Account.ID], configured)
		if errText != "" {
			view["error"] = errText
		}
		write(w, 200, store.Object{"today": view})
		return nil
	})
	a.endpoint("POST /api/fasttask/tasks", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		b, e := body(r)
		if e != nil {
			return e
		}
		if b["receiver_ref"] != nil || b["user_id"] != nil {
			return fail(403, "不能指定其他账户")
		}
		if a.TaskClient == nil || !a.TaskClient.Configured() {
			return fail(503, "FastTask 未配置")
		}
		b["receiver_ref"] = p.Account.ID
		h := http.Header{}
		h.Set("Idempotency-Key", r.Header.Get("Idempotency-Key"))
		if h.Get("Idempotency-Key") == "" {
			h.Set("Idempotency-Key", store.Random())
		}
		v, e := a.TaskClient.Request(r.Context(), "POST", "/api/v1/integrations/fastresearch/tasks", b, h)
		if e != nil {
			return fail(502, "FastTask 操作未完成")
		}
		write(w, 201, v)
		return nil
	})
	for _, path := range []string{"/api/insight/publish", "/api/content/reading/publish", "/api/fastinsight/case"} {
		a.endpoint("POST "+path, func(w http.ResponseWriter, r *http.Request) error {
			b, e := body(r)
			if e != nil {
				return e
			}
			account, e := a.serviceTarget(r, b, "insight:publish")
			if e != nil {
				return e
			}
			item := object(b["item"])
			if len(item) == 0 {
				item = b
			}
			if strings.HasSuffix(r.URL.Path, "/case") {
				item = paperCase(b)
			}
			if store.String(item["title"]) == "" {
				return fail(400, "内容标题不能为空")
			}
			item = store.Decode(store.JSON(item))
			delete(item, "receiver_ref")
			delete(item, "person")
			if store.String(item["id"]) == "" {
				item["id"] = store.Random()[:16]
			}
			item["receivedAt"] = store.Now()
			channel := "insightItems"
			if strings.Contains(r.URL.Path, "/reading/") {
				channel = "recentArticles"
			}
			e = a.Store.UpdateContent(account.ID, func(c store.Object) error {
				items := append([]any{item}, array(c[channel])...)
				if len(items) > 100 {
					items = items[:100]
				}
				c[channel] = items
				return nil
			})
			if e != nil {
				return e
			}
			write(w, 201, store.Object{"ok": true, "deliveredTo": []any{account.Content["person"]}})
			return nil
		})
	}
	a.endpoint("GET /api/fastwrite/status", func(w http.ResponseWriter, r *http.Request) error {
		if _, e := a.member(r, false); e != nil {
			return e
		}
		configured := a.WriteClient != nil && a.WriteClient.Configured()

		healthy := false
		if configured {
			req, e := http.NewRequestWithContext(r.Context(), "GET", strings.TrimRight(a.WriteClient.Base, "/")+"/api/health", nil)
			if e == nil {
				resp, e := a.HTTP.Do(req)
				if e == nil {
					healthy = resp.StatusCode == 200
					resp.Body.Close()
				}
			}
		}
		write(w, 200, store.Object{"configured": configured, "healthy": healthy, "url": integrations.First("FASTWRITE_PUBLIC_URL", "VITE_WRITE_URL", "FASTWRITE_URL")})
		return nil
	})
	for _, pattern := range []string{"GET /api/fastwrite/projects", "POST /api/fastwrite/projects", "GET /api/fastwrite/projects/{id}", "POST /api/fastwrite/projects/{id}/compile"} {
		a.endpoint(pattern, func(w http.ResponseWriter, r *http.Request) error {
			p, e := a.member(r, false)
			if e != nil {
				return e
			}
			if a.WriteClient == nil || !a.WriteClient.Configured() {
				return fail(503, "FastWrite 服务未配置")
			}
			var b store.Object
			if r.Method == "POST" && !strings.HasSuffix(r.URL.Path, "/compile") {
				b, e = body(r)
				if e != nil {
					return e
				}
			}
			h := http.Header{"X-FastResearch-Receiver-Ref": []string{p.Account.ID}}
			target := "/api/integration/projects"
			if id := r.PathValue("id"); id != "" {
				target += "/" + url.PathEscape(id)
			}
			if strings.HasSuffix(r.URL.Path, "/compile") {
				target += "/compile"
			}
			var payload any
			if b != nil {
				payload = b
			}
			v, e := a.WriteClient.Request(r.Context(), r.Method, target, payload, h)
			if e != nil {
				return fail(502, "FastWrite 操作未完成")
			}
			status := 200
			if r.Method == "POST" && !strings.HasSuffix(target, "/compile") {
				status = 201
			}
			write(w, status, v)
			return nil
		})
	}
	a.endpoint("POST /api/fastwrite/login-url", func(w http.ResponseWriter, r *http.Request) error {
		if _, e := a.member(r, false); e != nil {
			return e
		}
		for _, app := range integrations.Apps() {
			if app.ID == "fast-write" && app.Configured {
				write(w, 200, store.Object{"url": app.Target})
				return nil
			}
		}
		return fail(503, "FastWrite 入口未配置")
	})
	a.endpoint("GET /api/connectors/news/profile", a.newsProfile)
}
func paperCase(b store.Object) store.Object {
	p := object(b["paper"])
	if len(p) == 0 {
		p = object(b["case"])
	}
	if len(p) == 0 {
		p = b
	}
	return store.Object{"id": p["id"], "title": p["title"], "summary": p["summary"], "url": p["url"], "authors": p["authors"], "venue": p["venue"], "source": "FastInsight", "direction": p["direction"]}
}
func (a *Server) newsProfile(w http.ResponseWriter, r *http.Request) error {
	raw := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if a.CAS.Client == nil || raw == "" {
		return fail(401, "需要受限委托令牌")
	}
	claims, e := a.CAS.Client.VerifyAccessToken(r.Context(), raw, "research-api", "research:read")
	if e != nil || claims.Service || claims.ClientID != "news" {
		return fail(401, "委托令牌无效")
	}
	p, e := a.CAS.Provider(r.Context())
	if e != nil {
		return fail(502, "FastCAS 不可用")
	}
	verified, e := p.Verifier(&oidc.Config{ClientID: "research-api", SupportedSigningAlgs: []string{"RS256"}}).Verify(r.Context(), raw)
	if e != nil {
		return fail(401, "委托令牌无效")
	}
	var extra struct {
		Delegated bool `json:"delegated"`
		Actor     struct {
			Subject string `json:"sub"`
		} `json:"act"`
	}
	if e = verified.Claims(&extra); e != nil || !extra.Delegated || extra.Actor.Subject != "news" {
		return fail(403, "委托权限不足")
	}
	live, e := a.CAS.Client.IntrospectToken(r.Context(), raw)
	if e != nil || !live.Active || live.Subject != claims.Subject || live.ClientID != "news" || !slices.Contains(live.Audience, "research-api") || !slices.Contains(strings.Fields(live.Scope), "research:read") {
		return fail(401, "委托已失效")
	}
	var id string
	e = a.Store.DB.QueryRow(`SELECT account_id FROM fr_identities WHERE issuer=? AND client_id=? AND subject=?`, a.Config.Issuer, a.Config.ClientID, claims.Subject).Scan(&id)
	if e != nil {
		return fail(403, "Research 账号尚未登录")
	}
	account, e := a.Store.Account(id)
	if e != nil || store.String(account.Content["accountDisabledAt"]) != "" {
		return fail(403, "Research 账号不可用")
	}
	c := account.Content
	write(w, 200, store.Object{"researchAccountId": id, "authors": array(c["followedAuthors"]), "customTags": array(c["customResearchTags"]), "impression": impression(c["researchImpression"]), "inbox": array(c["inbox"])})
	return nil
}
