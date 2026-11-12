package httpapi

import (
	"net/http"
	"strings"

	"github.com/FastR-D/FastResearch/internal/store"
)

func (a *Server) contentRoutes() {
	a.endpoint("GET /api/content/me", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		v := content(p.Account)
		v["session"] = ""
		v["expiresAt"] = p.Session.ExpiresAt
		v["source"] = p.Session.Source
		v["role"] = p.Session.Role
		write(w, 200, v)
		return nil
	})
	a.endpoint("/api/content/authors", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		if r.Method == "PUT" {
			b, e := body(r)
			if e != nil {
				return e
			}
			authors := array(b["authors"])
			tags := array(b["customTags"])
			if len(authors) > 100 || len(tags) > 50 {
				return fail(400, "关注列表过长")
			}
			e = a.Store.UpdateContent(p.Account.ID, func(c store.Object) error { c["followedAuthors"] = authors; c["customResearchTags"] = tags; return nil })
			if e != nil {
				return e
			}
			p.Account.Content["followedAuthors"] = authors
			p.Account.Content["customResearchTags"] = tags
		} else if r.Method != "GET" {
			return fail(405, "不支持的操作")
		}
		write(w, 200, store.Object{"authors": array(p.Account.Content["followedAuthors"]), "customTags": array(p.Account.Content["customResearchTags"])})
		return nil
	})
	a.endpoint("/api/content/impression", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		v := impression(p.Account.Content["researchImpression"])
		if r.Method == "PUT" {
			b, e := body(r)
			if e != nil {
				return e
			}
			text := store.String(b["text"])
			if text == "" {
				text = store.String(object(b["impression"])["text"])
			}
			if len([]rune(text)) > 12000 {
				return fail(400, "研究印象过长")
			}
			v = store.Object{"text": strings.TrimSpace(text), "updatedAt": store.Now()}
			if e = a.Store.UpdateContent(p.Account.ID, func(c store.Object) error { c["researchImpression"] = v; return nil }); e != nil {
				return e
			}
		} else if r.Method != "GET" {
			return fail(405, "不支持的操作")
		}
		write(w, 200, store.Object{"impression": v})
		return nil
	})
	a.endpoint("/api/content/inbox", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		items := array(p.Account.Content["inbox"])
		if r.Method == "PUT" {
			b, e := body(r)
			if e != nil {
				return e
			}
			e = a.Store.UpdateContent(p.Account.ID, func(c store.Object) error {
				items = array(c["inbox"])
				ids := map[string]bool{}
				for _, v := range array(b["ids"]) {
					ids[store.String(v)] = true
				}
				if id := store.String(b["id"]); id != "" {
					ids[id] = true
				}
				for _, v := range items {
					o := object(v)
					if b["all"] == true || ids[store.String(o["id"])] {
						o["read"] = b["read"] != false
					}
				}
				c["inbox"] = items
				return nil
			})
			if e != nil {
				return e
			}
		} else if r.Method != "GET" {
			return fail(405, "不支持的操作")
		}
		unread := 0
		for _, v := range items {
			if object(v)["read"] != true {
				unread++
			}
		}
		write(w, 200, store.Object{"items": items, "unread": unread})
		return nil
	})
}
