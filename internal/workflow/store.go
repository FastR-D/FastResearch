package workflow

import (
	"database/sql"
	_ "embed"
	"errors"
	"fmt"
	"path/filepath"
	"time"

	"github.com/FastR-D/FastResearch/internal/store"
)

//go:embed schema.sql
var schema string

type Store struct{ DB *sql.DB }
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string          { return e.Message }
func fail(status int, msg string) error { return &Error{status, msg} }
func Open(dir string) (*Store, error) {
	db, e := sql.Open("sqlite3", "file:"+filepath.Join(dir, "workflows.sqlite")+"?_foreign_keys=on&_busy_timeout=5000&_journal_mode=WAL")
	if e != nil {
		return nil, e
	}
	db.SetMaxOpenConns(1)
	if _, e = db.Exec(schema); e != nil {
		db.Close()
		return nil, e
	}
	return &Store{db}, nil
}
func objects(rows *sql.Rows) ([]store.Object, error) {
	defer rows.Close()
	cols, e := rows.Columns()
	if e != nil {
		return nil, e
	}
	out := []store.Object{}
	for rows.Next() {
		values := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range values {
			ptrs[i] = &values[i]
		}
		if e = rows.Scan(ptrs...); e != nil {
			return nil, e
		}
		o := store.Object{}
		for i, k := range cols {
			v := values[i]
			if b, ok := v.([]byte); ok {
				v = string(b)
			}
			o[k] = v
		}
		out = append(out, o)
	}
	return out, rows.Err()
}
func query(db interface {
	Query(string, ...any) (*sql.Rows, error)
}, sql string, args ...any) ([]store.Object, error) {
	rows, e := db.Query(sql, args...)
	if e != nil {
		return nil, e
	}
	return objects(rows)
}
func get(db interface {
	Query(string, ...any) (*sql.Rows, error)
}, id, account string) (store.Object, error) {
	list, e := query(db, `SELECT * FROM workflows WHERE id=? AND account_id=?`, id, account)
	if e != nil {
		return nil, e
	}
	if len(list) == 0 {
		return nil, fail(404, "流水线不存在")
	}
	w := list[0]
	stages, e := query(db, `SELECT * FROM workflow_stages WHERE workflow_id=? ORDER BY position`, id)
	if e != nil {
		return nil, e
	}
	for _, stage := range stages {
		materials, e := query(db, `SELECT material_type AS type,content FROM stage_materials WHERE stage_id=?`, stage["id"])
		if e != nil {
			return nil, e
		}
		for _, m := range materials {
			m["content"] = store.Decode(store.String(m["content"]))
		}
		stage["materials"] = materials
	}
	w["stages"] = stages
	return w, nil
}
func (s *Store) Get(id, account string) (store.Object, error) { return get(s.DB, id, account) }
func (s *Store) List(account, status string) ([]store.Object, error) {
	sql := `SELECT id FROM workflows WHERE account_id=?`
	args := []any{account}
	if status != "" {
		sql += ` AND status=?`
		args = append(args, status)
	}
	sql += ` ORDER BY received_at DESC`
	rows, e := query(s.DB, sql, args...)
	if e != nil {
		return nil, e
	}
	list := []store.Object{}
	for _, row := range rows {
		w, e := s.Get(store.String(row["id"]), account)
		if e != nil {
			return nil, e
		}
		list = append(list, View(w))
	}
	return list, nil
}
func module(v any) bool {
	switch store.String(v) {
	case "fast-write", "fast-read", "fast-news", "fast-ppt", "fast-lab":
		return true
	}
	return false
}
func (s *Store) Receive(b store.Object, account string) (store.Object, error) {
	stages, ok := b["stages"].([]any)
	if !ok || len(stages) == 0 || len(stages) > 50 || store.String(b["dispatch_id"]) == "" || store.String(b["title"]) == "" || store.String(b["receiver_ref"]) != account || store.Number(b["dispatch_revision"]) < 1 {
		return nil, fail(400, "派发协议或收件账号无效")
	}
	revision := store.Number(b["dispatch_revision"])
	if revision != float64(int64(revision)) {
		return nil, fail(400, "派发版本必须是整数")
	}
	seen := map[string]bool{}
	for _, v := range stages {
		st, ok := v.(map[string]any)
		if !ok || store.String(st["stage_id"]) == "" || seen[store.String(st["stage_id"])] || !module(st["module"]) || store.String(st["title"]) == "" {
			return nil, fail(400, "工序 ID、模块或标题无效")
		}
		seen[store.String(st["stage_id"])] = true
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	var existingID, owner string
	e = tx.QueryRow(`SELECT workflow_id,account_id FROM dispatch_receipts WHERE dispatch_id=? AND dispatch_revision=?`, b["dispatch_id"], revision).Scan(&existingID, &owner)
	if e == nil {
		if owner != account {
			return nil, fail(403, "派发属于其他账号")
		}
		w, e := get(tx, existingID, account)
		if e != nil {
			return nil, e
		}
		return store.Object{"ok": true, "duplicate": true, "receipt": receipt(w), "workflow": View(w)}, nil
	} else if e != sql.ErrNoRows {
		return nil, e
	}
	var latest float64
	_ = tx.QueryRow(`SELECT max(dispatch_revision) FROM dispatch_receipts WHERE dispatch_id=?`, b["dispatch_id"]).Scan(&latest)
	if revision < latest {
		return nil, fail(409, "派发版本过旧")
	}
	id := store.Random()[:24]
	now := store.Now()
	_, e = tx.Exec(`INSERT INTO workflows(id,account_id,dispatch_id,dispatch_revision,title,description,source,status,received_at,task_id,task_revision,goal_id,plan_id,plan_item_id) VALUES(?,?,?,?,?,?,'fasttask','queued',?,?,?,?,?,?)`, id, account, b["dispatch_id"], revision, b["title"], store.String(b["description"]), now, b["task_id"], b["task_revision"], b["goal_id"], b["plan_id"], b["plan_item_id"])
	if e != nil {
		return nil, e
	}
	for i, v := range stages {
		st := v.(map[string]any)
		sid := store.Random()[:24]
		_, e = tx.Exec(`INSERT INTO workflow_stages(id,workflow_id,stage_id,position,module,title,description,status,success_criteria,completion_target,source_task_id,source_plan_item_id) VALUES(?,?,?,?,?,?,?,'pending',?,?,?,?)`, sid, id, st["stage_id"], i, st["module"], st["title"], store.String(st["description"]), st["success_criteria"], st["completion_target"], st["source_task_id"], st["source_plan_item_id"])
		if e != nil {
			return nil, e
		}
		if materials, ok := st["materials"].([]any); ok {
			if len(materials) > 20 {
				return nil, fail(400, "工序材料过多")
			}
			for _, m := range materials {
				o, ok := m.(map[string]any)
				if !ok {
					return nil, fail(400, "材料格式无效")
				}
				if _, e = tx.Exec(`INSERT INTO stage_materials(stage_id,material_type,content) VALUES(?,?,?)`, sid, store.String(o["type"]), store.JSON(o["content"])); e != nil {
					return nil, e
				}
			}
		}
	}
	if _, e = tx.Exec(`INSERT INTO dispatch_receipts VALUES(?,?,?,?,?)`, b["dispatch_id"], revision, id, account, now); e != nil {
		return nil, e
	}
	w, e := get(tx, id, account)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return store.Object{"ok": true, "duplicate": false, "receipt": receipt(w), "workflow": View(w)}, nil
}
func receipt(w store.Object) store.Object {
	return store.Object{"dispatch_id": w["dispatch_id"], "dispatch_revision": w["dispatch_revision"], "workflow_id": w["id"], "received_at": w["received_at"], "status": w["status"]}
}
func (s *Store) Start(id, account string) (store.Object, error) {
	tx, e := s.DB.Begin()
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	w, e := get(tx, id, account)
	if e != nil {
		return nil, e
	}
	if w["status"] == "active" {
		return store.Object{"workflow": View(w), "alreadyActive": true}, nil
	}
	if w["status"] != "queued" {
		return nil, fail(409, "流水线不可启动")
	}
	var n int
	if e = tx.QueryRow(`SELECT count(*) FROM workflows WHERE account_id=? AND status='active'`, account).Scan(&n); e != nil {
		return nil, e
	}
	if n > 0 {
		return nil, fail(409, "请先完成当前流水线")
	}
	now := store.Now()
	if _, e = tx.Exec(`UPDATE workflows SET status='active',started_at=? WHERE id=?`, now, id); e != nil {
		return nil, e
	}
	if _, e = tx.Exec(`UPDATE workflow_stages SET status='active',started_at=? WHERE id=(SELECT id FROM workflow_stages WHERE workflow_id=? AND status='pending' ORDER BY position LIMIT 1)`, now, id); e != nil {
		return nil, e
	}
	w, e = get(tx, id, account)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return store.Object{"workflow": View(w), "alreadyActive": false}, nil
}
func (s *Store) Complete(id, stageID, account, operation string, b store.Object) (store.Object, error) {
	if operation == "" || len(operation) > 200 {
		return nil, fail(400, "需要 Idempotency-Key")
	}
	tx, e := s.DB.Begin()
	if e != nil {
		return nil, e
	}
	defer tx.Rollback()
	w, e := get(tx, id, account)
	if e != nil {
		return nil, e
	}
	stages := w["stages"].([]store.Object)
	var current store.Object
	for _, st := range stages {
		if st["stage_id"] == stageID {
			current = st
			break
		}
	}
	if current == nil {
		return nil, fail(404, "工序不存在")
	}
	prior, e := query(tx, `SELECT * FROM stage_completions WHERE operation_id=?`, operation)
	if e != nil {
		return nil, e
	}
	if len(prior) > 0 {
		if prior[0]["workflow_id"] != id || prior[0]["stage_id"] != current["id"] {
			return nil, fail(409, "幂等键已用于其他工序")
		}
		return store.Object{"duplicate": true, "completion": prior[0], "workflow": View(w)}, nil
	}
	if w["status"] != "active" || current["status"] != "active" {
		return nil, fail(409, "请按顺序完成正在执行的工序")
	}
	now := store.Now()
	cid := store.Random()[:24]
	kind := store.String(b["completion_type"])
	if kind == "" {
		kind = "manual"
	}
	_, e = tx.Exec(`INSERT INTO stage_completions VALUES(?,?,?,?,?,?,?,?)`, cid, id, current["id"], kind, store.String(b["description"]), store.JSON(b["artifacts"]), now, operation)
	if e != nil {
		return nil, e
	}
	if _, e = tx.Exec(`UPDATE workflow_stages SET status='completed',completed_at=? WHERE id=?`, now, current["id"]); e != nil {
		return nil, e
	}
	if _, e = tx.Exec(`UPDATE workflow_stages SET status='active',started_at=? WHERE id=(SELECT id FROM workflow_stages WHERE workflow_id=? AND status='pending' ORDER BY position LIMIT 1)`, now, id); e != nil {
		return nil, e
	}
	var remaining int
	if e = tx.QueryRow(`SELECT count(*) FROM workflow_stages WHERE workflow_id=? AND status!='completed'`, id).Scan(&remaining); e != nil {
		return nil, e
	}
	if remaining == 0 {
		if _, e = tx.Exec(`UPDATE workflows SET status='completed',completed_at=? WHERE id=?`, now, id); e != nil {
			return nil, e
		}
	}
	eid := store.Random()[:24]
	payload := store.Object{"dispatch_id": w["dispatch_id"], "dispatch_revision": w["dispatch_revision"], "workflow_id": id, "stage_id": stageID, "completion_type": kind, "description": b["description"], "artifacts": b["artifacts"], "completed_at": now, "event_id": eid, "task_id": w["task_id"], "task_revision": w["task_revision"]}
	if store.String(w["dispatch_id"]) != "" {
		_, e = tx.Exec(`INSERT INTO outbound_events(id,workflow_id,dispatch_id,event_type,payload,status,attempts,next_attempt_at,created_at) VALUES(?,?,?,'stage.completed',?,'pending',0,?,?)`, eid, id, w["dispatch_id"], store.JSON(payload), time.Now().UnixMilli(), now)
		if e != nil {
			return nil, e
		}
	}
	w, e = get(tx, id, account)
	if e != nil {
		return nil, e
	}
	if e = tx.Commit(); e != nil {
		return nil, e
	}
	return store.Object{"duplicate": false, "completion": store.Object{"id": cid, "completedAt": now}, "workflow": View(w)}, nil
}
func View(w store.Object) store.Object {
	if w == nil {
		return nil
	}
	stages, _ := w["stages"].([]store.Object)
	out := []any{}
	done := 0
	var current any
	for _, st := range stages {
		v := store.Object{"id": st["stage_id"], "module": st["module"], "title": st["title"], "description": st["description"], "status": st["status"], "position": st["position"], "completedAt": st["completed_at"], "materials": st["materials"]}
		out = append(out, v)
		if st["status"] == "completed" {
			done++
		} else if current == nil {
			current = v
		}
	}
	return store.Object{"id": w["id"], "title": w["title"], "description": w["description"], "source": w["source"], "status": w["status"], "receivedAt": w["received_at"], "startedAt": w["started_at"], "completedAt": w["completed_at"], "dispatchId": w["dispatch_id"], "taskId": w["task_id"], "currentStage": current, "stages": out, "progress": store.Object{"total": len(out), "completed": done}}
}
func (s *Store) Pending() ([]store.Object, error) {
	return query(s.DB, `SELECT e.*,w.account_id FROM outbound_events e JOIN workflows w ON w.id=e.workflow_id WHERE e.status='pending' AND e.next_attempt_at<=? ORDER BY e.next_attempt_at LIMIT 10`, time.Now().UnixMilli())
}
func (s *Store) Mark(id string, err error, attempt int) error {
	if err == nil {
		_, e := s.DB.Exec(`UPDATE outbound_events SET status='synced',synced_at=? WHERE id=?`, store.Now(), id)
		return e
	}
	delay := time.Second * time.Duration(1<<min(attempt+1, 9))
	_, e := s.DB.Exec(`UPDATE outbound_events SET attempts=attempts+1,last_error=?,next_attempt_at=? WHERE id=?`, fmt.Sprint(err), time.Now().Add(delay).UnixMilli(), id)
	return e
}
func Status(err error) (int, string) {
	var e *Error
	if errors.As(err, &e) {
		return e.Status, e.Message
	}
	return 500, "流水线操作失败"
}
