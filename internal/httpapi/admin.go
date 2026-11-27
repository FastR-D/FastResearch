package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/FastR-D/FastResearch/internal/store"
)

func keyView(a store.Account) store.Object {
	return store.Object{"id": a.KeyID, "accountId": a.ID, "person": a.Content["person"], "keyPreview": a.Credential["keyPreview"], "createdAt": a.Content["createdAt"], "expiresAt": a.Credential["expiresAt"], "active": active(&a)}
}
func (a *Server) adminRoutes() {
	a.endpoint("GET /api/admin/me", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, true)
		if e != nil {
			return e
		}
		write(w, 200, store.Object{"username": p.Account.Content["person"], "role": p.Session.Role, "expiresAt": p.Session.ExpiresAt})
		return nil
	})
	a.endpoint("GET /api/admin/keys", func(w http.ResponseWriter, r *http.Request) error {
		if _, e := a.member(r, true); e != nil {
			return e
		}
		list, e := a.Store.Accounts()
		if e != nil {
			return e
		}
		keys := []any{}
		for _, record := range list {
			keys = append(keys, keyView(record))
		}
		write(w, 200, store.Object{"keys": keys})
		return nil
	})
	a.endpoint("POST /api/admin/keys", func(w http.ResponseWriter, r *http.Request) error {
		if _, e := a.member(r, true); e != nil {
			return e
		}
		if !a.Config.LegacyKeys {
			return fail(403, "账号请在 FastCAS 中创建或邀请；本地 Key 创建已关闭")
		}
		b, e := body(r)
		if e != nil {
			return e
		}
		person := store.String(b["person"])
		if person == "" || len([]rune(person)) > 80 {
			return fail(400, "请输入有效的成员名称")
		}
		raw := "fk_" + store.Random()
		record := store.Account{ID: "account_" + store.Random()[:32], KeyID: store.Random()[:20], Content: store.Object{"person": person, "createdAt": store.Now()}, Credential: store.Object{"keyHash": store.Hash(raw), "keyPreview": raw[:9] + "..." + raw[len(raw)-4:], "credentialVersion": 1}}
		if v := store.String(b["expiresAt"]); v != "" {
			if _, e = time.Parse(time.RFC3339, v); e != nil {
				return fail(400, "有效期格式无效")
			}
			record.Credential["expiresAt"] = v
		}
		if e = a.Store.Save(&record); e != nil {
			return e
		}
		write(w, 201, store.Object{"key": raw, "record": keyView(record)})
		return nil
	})
	for _, pattern := range []string{"DELETE /api/admin/keys/{id}", "POST /api/admin/keys/{id}/rotate"} {
		a.endpoint(pattern, func(w http.ResponseWriter, r *http.Request) error {
			if _, e := a.member(r, true); e != nil {
				return e
			}
			list, e := a.Store.Accounts()
			if e != nil {
				return e
			}
			for _, record := range list {
				if record.KeyID != r.PathValue("id") {
					continue
				}
				if r.Method == "DELETE" {
					record.Credential["revokedAt"] = store.Now()
					if e = a.Store.Save(&record); e != nil {
						return e
					}
					write(w, 200, store.Object{"ok": true})
					return nil
				}
				if !a.Config.LegacyKeys {
					return fail(403, "个人 Key 轮换已关闭")
				}
				raw := "fk_" + store.Random()
				record.Credential["keyHash"] = store.Hash(raw)
				record.Credential["keyPreview"] = raw[:9] + "..." + raw[len(raw)-4:]
				record.Credential["credentialVersion"] = version(&record) + 1
				record.Credential["revokedAt"] = nil
				record.Credential["expiresAt"] = nil
				if e = a.Store.Save(&record); e != nil {
					return e
				}
				write(w, 200, store.Object{"key": raw, "keyId": record.KeyID, "accountId": record.ID, "record": keyView(record)})
				return nil
			}
			return fail(404, "成员不存在")
		})
	}
	a.endpoint("/api/admin/fastinsight/roster", func(w http.ResponseWriter, r *http.Request) error {
		if _, e := a.member(r, true); e != nil {
			return e
		}
		if r.Method != "GET" && r.Method != "PUT" {
			return fail(405, "不支持的操作")
		}
		if r.Method == "GET" {
			snapshot, e := a.Store.Roster()
			if e != nil {
				return e
			}
			write(w, 200, snapshot)
			return nil
		}
		b, e := body(r)
		if e != nil {
			return e
		}
		raw, e := json.Marshal(b["roster"])
		if e != nil {
			return fail(400, "分发配置格式无效")
		}
		var roster store.Roster
		if len(object(b["roster"])) == 0 || json.Unmarshal(raw, &roster) != nil {
			return fail(400, "分发配置格式无效")
		}
		if e = store.NormalizeRoster(&roster); e != nil {
			return fail(400, e.Error())
		}
		snapshot, e := a.Store.SaveRoster(roster, store.String(b["revision"]))
		if errors.Is(e, store.ErrRosterConflict) {
			return fail(409, "配置已被其他管理员更新，请重新加载后修改")
		}
		if e != nil {
			return e
		}
		write(w, 200, snapshot)
		return nil
	})
}
