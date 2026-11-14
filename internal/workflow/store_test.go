package workflow

import (
	"testing"

	"github.com/FastR-D/FastResearch/internal/store"
)

func TestDispatchOwnershipOrderingAndAtomicOutbox(t *testing.T) {
	s, e := Open(t.TempDir())
	if e != nil {
		t.Fatal(e)
	}
	defer s.DB.Close()
	payload := store.Object{"schema_version": "fasttask-dispatch-v1", "dispatch_id": "dispatch-1", "dispatch_revision": float64(1), "receiver_ref": "account-a", "title": "Research", "stages": []any{store.Object{"stage_id": "read", "module": "fast-read", "title": "Read"}, store.Object{"stage_id": "write", "module": "fast-write", "title": "Write"}}}
	result, e := s.Receive(payload, "account-a")
	if e != nil {
		t.Fatal(e)
	}
	view := result["workflow"].(store.Object)
	id := store.String(view["id"])
	duplicate, e := s.Receive(payload, "account-a")
	if e != nil || duplicate["duplicate"] != true {
		t.Fatal("dispatch not idempotent", e)
	}
	if _, e = s.Get(id, "account-b"); e == nil {
		t.Fatal("cross-account read allowed")
	}
	if _, e = s.Receive(payload, "account-b"); e == nil {
		t.Fatal("cross-account dispatch allowed")
	}
	if _, e = s.Complete(id, "read", "account-a", "op-before-start", store.Object{}); e == nil {
		t.Fatal("queued stage completed")
	}
	if _, e = s.Start(id, "account-a"); e != nil {
		t.Fatal(e)
	}
	if _, e = s.Complete(id, "write", "account-a", "op-out-of-order", store.Object{}); e == nil {
		t.Fatal("out-of-order completion allowed")
	}
	completed, e := s.Complete(id, "read", "account-a", "op-1", store.Object{"completion_type": "manual", "description": "Read complete"})
	if e != nil || completed["duplicate"] != false {
		t.Fatal(e)
	}
	duplicate, e = s.Complete(id, "read", "account-a", "op-1", store.Object{})
	if e != nil || duplicate["duplicate"] != true {
		t.Fatal("completion not idempotent", e)
	}
	if _, e = s.Complete(id, "write", "account-a", "op-1", store.Object{}); e == nil {
		t.Fatal("operation ID reused for another stage")
	}
	events, e := s.Pending()
	if e != nil || len(events) != 1 {
		t.Fatal("completion and outbox not atomic/idempotent", e, len(events))
	}
	if _, e = s.Complete(id, "write", "account-a", "op-2", store.Object{}); e != nil {
		t.Fatal(e)
	}
	final, e := s.Get(id, "account-a")
	if e != nil || final["status"] != "completed" {
		t.Fatal("workflow not completed", e)
	}
	if e = s.Mark(store.String(events[0]["id"]), nil, 0); e != nil {
		t.Fatal(e)
	}
	events, e = s.Pending()
	if e != nil || len(events) != 1 {
		t.Fatal("outbox mark failed", e)
	}
}

func TestCompletionOperationOwnershipAndOutboxRollback(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer s.DB.Close()
	create := func(account, dispatch string) string {
		result, err := s.Receive(store.Object{"schema_version": "fasttask-dispatch-v1", "dispatch_id": dispatch, "dispatch_revision": float64(1), "receiver_ref": account, "title": "Research", "stages": []any{store.Object{"stage_id": "read", "module": "fast-read", "title": "Read"}}}, account)
		if err != nil {
			t.Fatal(err)
		}
		id := store.String(result["workflow"].(store.Object)["id"])
		if _, err := s.Start(id, account); err != nil {
			t.Fatal(err)
		}
		return id
	}
	for _, item := range []struct{ dispatch, account string }{{"dispatch-a", "account-a"}, {"dispatch-b", "account-b"}, {"dispatch-c", "account-a"}} {
		id := create(item.account, item.dispatch)
		result, err := s.Complete(id, "read", item.account, "shared-operation", store.Object{})
		if err != nil || result["duplicate"] != false {
			t.Fatalf("independent completion: %v %v", result, err)
		}
		duplicate, err := s.Complete(id, "read", item.account, "shared-operation", store.Object{})
		if err != nil || duplicate["duplicate"] != true {
			t.Fatalf("duplicate: %v %v", duplicate, err)
		}
	}
	if events, err := s.Pending(); err != nil || len(events) != 3 {
		t.Fatalf("events: %v %v", events, err)
	}
	rollback := create("account-a", "dispatch-rollback")
	if _, err := s.DB.Exec(`CREATE TRIGGER reject_outbox BEFORE INSERT ON outbound_events BEGIN SELECT RAISE(ABORT, 'outbox unavailable'); END`); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Complete(rollback, "read", "account-a", "retry-operation", store.Object{}); err == nil {
		t.Fatal("outbox failure accepted")
	}
	view, err := s.Get(rollback, "account-a")
	if err != nil || view["status"] != "active" {
		t.Fatalf("workflow not rolled back: %v %v", view, err)
	}
	var completions int
	if err := s.DB.QueryRow(`SELECT count(*) FROM stage_completions WHERE workflow_id=?`, rollback).Scan(&completions); err != nil || completions != 0 {
		t.Fatalf("completion not rolled back: %d %v", completions, err)
	}
	if _, err := s.DB.Exec(`DROP TRIGGER reject_outbox`); err != nil {
		t.Fatal(err)
	}
	if result, err := s.Complete(rollback, "read", "account-a", "retry-operation", store.Object{}); err != nil || result["duplicate"] != false {
		t.Fatalf("recovery: %v %v", result, err)
	}
	if events, err := s.Pending(); err != nil || len(events) != 4 {
		t.Fatalf("recovered events: %v %v", events, err)
	}
}
