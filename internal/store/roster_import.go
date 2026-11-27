package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
)

// PrepareRosterImport preserves the legacy graph and resolves only explicit
// stable account/key references. Display names never authorize an account link.
func (s *Store) PrepareRosterImport(source Roster) (Roster, error) {
	var roster Roster
	if err := json.Unmarshal([]byte(JSON(source)), &roster); err != nil {
		return roster, err
	}
	if err := NormalizeRoster(&roster); err != nil {
		return roster, err
	}
	members := map[string]RosterOwner{}
	for i, member := range roster.Members {
		if member.ReceiverRef == "" {
			return roster, fmt.Errorf("成员 %q 缺少 receiver_ref，不能按姓名猜测收件账号", member.Name)
		}
		account, err := s.Account(member.ReceiverRef)
		if errors.Is(err, sql.ErrNoRows) {
			account, err = scanAccount(s.DB.QueryRow(`SELECT id,key_id,content,credential FROM fr_accounts WHERE key_id=?`, member.ReceiverRef))
		}
		if err != nil {
			return roster, fmt.Errorf("成员 %q 的收件账号不可用: %w", member.Name, err)
		}
		if String(account.Content["accountDisabledAt"]) != "" {
			return roster, fmt.Errorf("成员 %q 的收件账号已禁用", member.Name)
		}
		member.ReceiverRef = account.ID
		roster.Members[i] = member
		members[member.ID] = member
	}
	for i := range roster.Directions {
		for j, member := range roster.Directions[i].Owners {
			roster.Directions[i].Owners[j] = members[member.ID]
		}
	}
	if roster.DefaultOwner != nil {
		member := members[roster.DefaultOwner.ID]
		roster.DefaultOwner = &member
	}
	return roster, nil
}

func RosterEmpty(roster Roster) bool {
	return len(roster.Directions) == 0 && len(roster.Members) == 0 && len(roster.Keywords) == 0 && roster.DefaultOwner == nil
}

// ImportRoster is repeatable for the same data and never overwrites a nonempty
// configuration. A concurrent edit after preview is rejected by SQL revision CAS.
func (s *Store) ImportRoster(roster Roster, expectedRevision string) (RosterSnapshot, bool, error) {
	current, err := s.Roster()
	if err != nil {
		return current, false, err
	}
	if JSON(current.Roster) == JSON(roster) {
		return current, false, nil
	}
	if !RosterEmpty(current.Roster) {
		return current, false, errors.New("数据库已有不同的分发配置，迁移已停止，原配置未修改")
	}
	if current.Revision != expectedRevision {
		return current, false, ErrRosterConflict
	}
	saved, err := s.SaveRoster(roster, expectedRevision)
	return saved, err == nil, err
}
