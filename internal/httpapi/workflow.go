package httpapi

import (
	"net/http"
	"strings"

	"github.com/FastR-D/FastResearch/internal/store"
	"github.com/FastR-D/FastResearch/internal/workflow"
)

func workflowView(v any) any {
	w := object(v)
	tasks := array(w["tasks"])
	if len(tasks) == 0 {
		return nil
	}
	copy := store.Decode(store.JSON(w))
	done := 0
	index := -1
	out := []any{}
	for i, v := range tasks {
		t := store.Decode(store.JSON(v))
		if store.String(t["completedAt"]) != "" {
			t["status"] = "done"
			done++
		} else if index < 0 {
			index = i
			t["status"] = "active"
		} else {
			t["status"] = "pending"
		}
		out = append(out, t)
	}
	copy["tasks"] = out
	copy["currentIndex"] = index
	copy["doneCount"] = done
	copy["total"] = len(out)
	copy["completed"] = done == len(out)
	copy["currentTask"] = nil
	if index >= 0 {
		copy["currentTask"] = out[index]
	}
	return copy
}
func normalizeWorkflow(b store.Object, source string) (store.Object, error) {
	tasks := array(b["tasks"])
	if len(tasks) == 0 || len(tasks) > 50 {
		return nil, fail(400, "任务列表需包含 1 到 50 项")
	}
	out := []any{}
	for _, v := range tasks {
		t := object(v)
		m := store.String(t["module"])
		if m != "fast-write" && m != "fast-read" && m != "fast-news" && m != "fast-ppt" && m != "fast-lab" {
			return nil, fail(400, "任务模块无效")
		}
		title := store.String(t["title"])
		if title == "" || len([]rune(title)) > 300 {
			return nil, fail(400, "任务标题无效")
		}
		id := store.String(t["id"])
		if id == "" {
			id = store.Random()[:16]
		}
		out = append(out, store.Object{"id": id, "module": m, "title": title, "description": store.String(t["description"]), "completedAt": nil})
	}
	title := store.String(b["title"])
	if title == "" {
		title = "研究任务"
	}
	return store.Object{"id": store.Random()[:16], "title": title, "source": source, "receivedAt": store.Now(), "tasks": out}, nil
}
func workflowError(e error) error { status, msg := workflow.Status(e); return fail(status, msg) }
func (a *Server) workflowRoutes() {
	a.endpoint("GET /api/workflow", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		write(w, 200, store.Object{"workflow": workflowView(p.Account.Content["workflow"])})
		return nil
	})
	a.endpoint("POST /api/workflow", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		b, e := body(r)
		if e != nil {
			return e
		}
		v, e := normalizeWorkflow(b, "member")
		if e != nil {
			return e
		}
		if e = a.Store.UpdateContent(p.Account.ID, func(c store.Object) error { c["workflow"] = v; return nil }); e != nil {
			return e
		}
		write(w, 201, store.Object{"workflow": workflowView(v)})
		return nil
	})
	a.endpoint("POST /api/workflow/complete", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		b, e := body(r)
		if e != nil {
			return e
		}
		var view any
		e = a.Store.UpdateContent(p.Account.ID, func(c store.Object) error {
			wf := object(c["workflow"])
			tasks := array(wf["tasks"])
			for _, v := range tasks {
				t := object(v)
				if store.String(t["completedAt"]) != "" {
					continue
				}
				if id := store.String(b["taskId"]); id != "" && id != store.String(t["id"]) {
					return fail(409, "请按任务顺序完成")
				}
				t["completedAt"] = store.Now()
				view = workflowView(wf)
				return nil
			}
			return fail(409, "没有可完成的任务")
		})
		if e != nil {
			return e
		}
		write(w, 200, store.Object{"workflow": view, "nextTask": object(view)["currentTask"]})
		return nil
	})
	a.endpoint("GET /api/workflow/team", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		list, e := a.Store.Accounts()
		if e != nil {
			return e
		}
		summaries := a.teamTaskSummaries(r.Context(), list)
		members := []any{}
		for i, v := range list {
			if store.String(v.Content["accountDisabledAt"]) != "" {
				continue
			}
			members = append(members, store.Object{"keyId": v.KeyID, "person": v.Content["person"], "workflow": workflowView(v.Content["workflow"]), "apps": summaries[i]})
		}
		write(w, 200, store.Object{"members": members, "currentKeyId": p.Account.KeyID})
		return nil
	})
	a.endpoint("POST /api/workflow/publish", func(w http.ResponseWriter, r *http.Request) error {
		b, e := body(r)
		if e != nil {
			return e
		}
		account, e := a.serviceTarget(r, b, "workflow:publish")
		if e != nil {
			return e
		}
		if b["schema_version"] == "fasttask-dispatch-v1" {
			v, e := a.Workflows.Receive(b, account.ID)
			if e != nil {
				return workflowError(e)
			}
			project := object(v["workflow"])
			tasks := []any{}
			for _, item := range array(project["stages"]) {
				s := object(item)
				tasks = append(tasks, store.Object{"id": s["id"], "module": s["module"], "title": s["title"], "description": s["description"], "completedAt": s["completedAt"]})
			}
			if e = a.Store.UpdateContent(account.ID, func(c store.Object) error {
				c["workflow"] = store.Object{"id": project["id"], "title": project["title"], "source": "fasttask", "receivedAt": project["receivedAt"], "tasks": tasks}
				return nil
			}); e != nil {
				return e
			}
			status := 201
			if v["duplicate"] == true {
				status = 200
			}
			write(w, status, v)
			return nil
		}
		wf, e := normalizeWorkflow(b, "api")
		if e != nil {
			return e
		}
		if e = a.Store.UpdateContent(account.ID, func(c store.Object) error { c["workflow"] = wf; return nil }); e != nil {
			return e
		}
		write(w, 201, store.Object{"ok": true, "deliveredTo": []any{account.Content["person"]}, "workflow": workflowView(wf)})
		return nil
	})
	a.endpoint("GET /api/workflows", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		list, e := a.Workflows.List(p.Account.ID, r.URL.Query().Get("status"))
		if e != nil {
			return e
		}
		write(w, 200, store.Object{"workflows": list})
		return nil
	})
	a.endpoint("GET /api/workflows/{id}", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		v, e := a.Workflows.Get(r.PathValue("id"), p.Account.ID)
		if e != nil {
			return workflowError(e)
		}
		write(w, 200, store.Object{"workflow": workflow.View(v)})
		return nil
	})
	a.endpoint("POST /api/workflows/{id}/start", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		v, e := a.Workflows.Start(r.PathValue("id"), p.Account.ID)
		if e != nil {
			return workflowError(e)
		}
		write(w, 200, v)
		return nil
	})
	a.endpoint("POST /api/workflows/{id}/stages/{stage}/complete", func(w http.ResponseWriter, r *http.Request) error {
		p, e := a.member(r, false)
		if e != nil {
			return e
		}
		b, e := body(r)
		if e != nil {
			return e
		}
		operation := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if operation == "" {
			operation = store.String(b["operation_id"])
		}
		v, e := a.Workflows.Complete(r.PathValue("id"), r.PathValue("stage"), p.Account.ID, operation, b)
		if e != nil {
			return workflowError(e)
		}
		write(w, 200, v)
		return nil
	})
}
