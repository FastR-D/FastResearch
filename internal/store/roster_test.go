package store

import (
	"errors"
	"path/filepath"
	"sync"
	"testing"
)

func TestRosterPersistsAndRejectsConcurrentUpdates(t *testing.T) {
	file := filepath.Join(t.TempDir(), "accounts.sqlite")
	first, e := Open(file)
	if e != nil {
		t.Fatal(e)
	}
	defer first.Close()
	second, e := Open(file)
	if e != nil {
		t.Fatal(e)
	}
	defer second.Close()
	snapshot, e := first.Roster()
	if e != nil {
		t.Fatal(e)
	}
	if snapshot.Storage != "database" || snapshot.Roster.Directions == nil || snapshot.Revision == "" {
		t.Fatalf("invalid empty snapshot: %#v", snapshot)
	}
	roster := Roster{Directions: []RosterDirection{{Name: "安全", Keywords: []string{"Agent"}, Owners: []RosterOwner{{Name: "研究员", ReceiverRef: "account_stable"}}}}, DefaultOwner: &RosterOwner{Name: "研究员", ReceiverRef: "account_stable"}}
	if e = NormalizeRoster(&roster); e != nil {
		t.Fatal(e)
	}
	if roster.Members[0].ReceiverRef != "account_stable" || len(roster.Members) != 1 || roster.DefaultOwner.ID != roster.Directions[0].Owners[0].ID {
		t.Fatal("member references diverged")
	}
	var wg sync.WaitGroup
	results := make(chan error, 2)
	for _, s := range []*Store{first, second} {
		wg.Add(1)
		go func(s *Store) { defer wg.Done(); _, err := s.SaveRoster(roster, snapshot.Revision); results <- err }(s)
	}
	wg.Wait()
	close(results)
	successes, conflicts := 0, 0
	for err := range results {
		if err == nil {
			successes++
		} else if errors.Is(err, ErrRosterConflict) {
			conflicts++
		} else {
			t.Fatal(err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("lost update: %d successes %d conflicts", successes, conflicts)
	}
	reopened, e := Open(file)
	if e != nil {
		t.Fatal(e)
	}
	defer reopened.Close()
	saved, e := reopened.Roster()
	if e != nil {
		t.Fatal(e)
	}
	if saved.Revision == snapshot.Revision || JSON(saved.Roster) != JSON(roster) {
		t.Fatalf("roster did not persist: %#v", saved)
	}
}

func TestRosterCatalogsAndValidation(t *testing.T) {
	valid := Roster{Keywords: []string{"unconnected"}, Members: []RosterOwner{{ID: "m", Name: "成员"}}, Directions: []RosterDirection{{ID: "d", Name: "空方向", Keywords: []string{}, Owners: []RosterOwner{}}}}
	if e := NormalizeRoster(&valid); e != nil {
		t.Fatal(e)
	}
	cases := []Roster{
		{Keywords: []string{" "}},
		{Keywords: []string{"Agent", " Agent "}},
		{Members: []RosterOwner{{ID: "m", Name: " "}}},
		{Members: []RosterOwner{{ID: "m", Name: "A"}, {ID: "m", Name: "B"}}},
		{Directions: []RosterDirection{{Name: "重复"}, {Name: "重复"}}},
		{Directions: []RosterDirection{{Name: "负数", Priority: -1}}},
		{Keywords: []string{}, Directions: []RosterDirection{{Name: "方向", Keywords: []string{"missing"}}}},
		{Members: []RosterOwner{}, DefaultOwner: &RosterOwner{ID: "missing", Name: "失效成员"}},
		{Members: []RosterOwner{}, Directions: []RosterDirection{{Name: "方向", Owners: []RosterOwner{{Name: "失效成员"}}}}},
	}
	for i, r := range cases {
		if e := NormalizeRoster(&r); e == nil {
			t.Errorf("accepted invalid roster %d: %#v", i, r)
		}
	}
}

func TestLegacyRosterImportPreservesRelationsAndNeverOverwrites(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "accounts.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	for _, account := range []Account{{ID: "a", KeyID: "old-a", Content: Object{"person": "同名"}, Credential: Object{}}, {ID: "b", KeyID: "old-b", Content: Object{"person": "同名"}, Credential: Object{}}} {
		if err = s.Save(&account); err != nil {
			t.Fatal(err)
		}
	}
	source := Roster{Directions: []RosterDirection{{Name: "D1", Keywords: []string{"IoT", "firmware"}, Owners: []RosterOwner{{Name: "同名", ReceiverRef: "old-a"}}}, {Name: "D2", Keywords: []string{"IoT"}, Owners: []RosterOwner{{Name: "同名", ReceiverRef: "b"}}}}, DefaultOwner: &RosterOwner{Name: "同名", ReceiverRef: "old-a"}}
	roster, err := s.PrepareRosterImport(source)
	if err != nil {
		t.Fatal(err)
	}
	if len(roster.Keywords) != 2 || len(roster.Members) != 2 || roster.DefaultOwner.ReceiverRef != "a" || roster.DefaultOwner.ID != roster.Directions[0].Owners[0].ID || roster.Directions[1].Owners[0].ReceiverRef != "b" {
		t.Fatalf("lost graph/reference: %#v", roster)
	}
	before, err := s.Roster()
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err = s.ImportRoster(roster, "stale"); !errors.Is(err, ErrRosterConflict) {
		t.Fatal("stale import allowed", err)
	}
	saved, changed, err := s.ImportRoster(roster, before.Revision)
	if err != nil || !changed {
		t.Fatal("import failed", err)
	}
	again, changed, err := s.ImportRoster(roster, before.Revision)
	if err != nil || changed || again.Revision != saved.Revision {
		t.Fatal("repeat import was not idempotent", err)
	}
	savedJSON := JSON(saved.Roster)
	roster.Directions[0].Name = "modified"
	if _, _, err = s.ImportRoster(roster, saved.Revision); err == nil {
		t.Fatal("existing config overwritten")
	}
	current, _ := s.Roster()
	if JSON(current.Roster) != savedJSON {
		t.Fatal("failed import changed config")
	}
	for _, member := range []RosterOwner{{Name: "同名"}, {Name: "同名", ReceiverRef: "missing"}} {
		if _, err = s.PrepareRosterImport(Roster{DefaultOwner: &member}); err == nil {
			t.Fatal("missing reference inferred from display name")
		}
	}
}
