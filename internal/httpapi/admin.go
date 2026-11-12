package httpapi

import (
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"gopkg.in/yaml.v3"

	"github.com/FastR-D/FastResearch/internal/config"
	"github.com/FastR-D/FastResearch/internal/store"
)

var rosterMu sync.Mutex

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
		rosterMu.Lock()
		defer rosterMu.Unlock()
		file := config.Env("FASTINSIGHT_ROSTER", "../FastInsight/assets/colleagues.yaml")
		raw, e := os.ReadFile(file)
		if e != nil {
			return fail(503, "FastInsight 名册不可用")
		}
		var roster store.Object
		if e = yaml.Unmarshal(raw, &roster); e != nil {
			return e
		}
		revision := store.Hash(string(raw))
		if r.Method == "PUT" {
			b, e := body(r)
			if e != nil {
				return e
			}
			if store.String(b["revision"]) != revision {
				return fail(409, "名册已更新，请刷新后重试")
			}
			roster = object(b["roster"])
			directions := array(roster["directions"])
			if len(directions) == 0 || len(directions) > 100 {
				return fail(400, "研究方向不能为空且不能超过 100 项")
			}
			for _, v := range directions {
				d := object(v)
				if store.String(d["name"]) == "" || len(array(d["keywords"])) == 0 {
					return fail(400, "每个方向需要名称和关键词")
				}
			}
			raw, e = yaml.Marshal(roster)
			if e != nil {
				return e
			}
			tmp, e := os.CreateTemp(filepath.Dir(file), ".roster-*")
			if e != nil {
				return e
			}
			defer os.Remove(tmp.Name())
			if _, e = tmp.Write(raw); e == nil {
				e = tmp.Sync()
			}
			closeErr := tmp.Close()
			if e != nil {
				return e
			}
			if closeErr != nil {
				return closeErr
			}
			if e = os.Rename(tmp.Name(), file); e != nil {
				return e
			}
			revision = store.Hash(string(raw))
		}
		write(w, 200, store.Object{"roster": roster, "revision": revision, "file": filepath.Base(file)})
		return nil
	})
}
