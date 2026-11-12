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
