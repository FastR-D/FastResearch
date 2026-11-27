package store

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
)

type RosterOwner struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	FeishuOpenID string `json:"feishu_open_id,omitempty"`
	ReceiverRef  string `json:"receiver_ref,omitempty"`
}
type RosterDirection struct {
	ID       string        `json:"id"`
	Name     string        `json:"name"`
	Priority int           `json:"priority,omitempty"`
	Keywords []string      `json:"keywords"`
	Owners   []RosterOwner `json:"owners"`
}
type Roster struct {
	Keywords     []string          `json:"keywords"`
	Members      []RosterOwner     `json:"members"`
	Directions   []RosterDirection `json:"directions"`
	DefaultOwner *RosterOwner      `json:"default_owner,omitempty"`
}
type RosterSnapshot struct {
	Roster   Roster `json:"roster"`
	Revision string `json:"revision"`
	Storage  string `json:"storage"`
}

var ErrRosterConflict = errors.New("roster revision conflict")

// NormalizeRoster also accepts the earlier directions/owners API shape. Explicit
// catalogs retain unconnected nodes; references always use stable member IDs.
func NormalizeRoster(r *Roster) error {
	if r.Directions == nil {
		r.Directions = []RosterDirection{}
	}
	if len(r.Directions) > 100 || len(r.Members) > 500 || len(r.Keywords) > 1000 {
		return errors.New("最多支持 100 个方向、500 位成员和 1000 个关键词")
	}
	legacyMembers, legacyKeywords := r.Members == nil, r.Keywords == nil
	if legacyMembers {
		r.Members = []RosterOwner{}
	}
	if legacyKeywords {
		r.Keywords = []string{}
	}
	members := map[string]RosterOwner{}
	addMember := func(m RosterOwner) (RosterOwner, error) {
		m.Name = strings.TrimSpace(m.Name)
		m.FeishuOpenID = strings.TrimSpace(m.FeishuOpenID)
		m.ReceiverRef = strings.TrimSpace(m.ReceiverRef)
		if m.Name == "" || len([]rune(m.Name)) > 80 || len(m.FeishuOpenID) > 200 || len(m.ReceiverRef) > 200 {
			return m, errors.New("成员姓名不能为空且不能超过 80 字，收件账号和飞书 ID 不能超过 200 字符")
		}
		if m.ID == "" {
			m.ID = "member_" + Hash(m.Name + "\x00" + m.FeishuOpenID + "\x00" + m.ReceiverRef)[:24]
		}
		if m.ID == "__default__" || len(m.ID) > 100 {
			return m, errors.New("成员 ID 无效或过长")
		}
		return m, nil
	}
	for i, m := range r.Members {
		m, e := addMember(m)
		if e != nil {
			return e
		}
		if _, ok := members[m.ID]; ok {
			return errors.New("成员 ID 重复")
		}
		r.Members[i] = m
		members[m.ID] = m
	}
	resolve := func(m RosterOwner) (RosterOwner, error) {
		m, e := addMember(m)
		if e != nil {
			return m, e
		}
		if canonical, ok := members[m.ID]; ok {
			return canonical, nil
		}
		if !legacyMembers {
			return m, errors.New("关系引用了不存在的成员")
		}
		r.Members = append(r.Members, m)
		members[m.ID] = m
		return m, nil
	}
	keywords := map[string]bool{}
	for i, k := range r.Keywords {
		k = strings.TrimSpace(k)
		if k == "" || k == "__default__" || len([]rune(k)) > 120 || keywords[k] {
			return errors.New("关键词不能为空、重复或超过 120 字")
		}
		r.Keywords[i] = k
		keywords[k] = true
	}
	ids, names := map[string]bool{}, map[string]bool{}
	for i := range r.Directions {
		d := &r.Directions[i]
		d.Name = strings.TrimSpace(d.Name)
		if d.Name == "" || len([]rune(d.Name)) > 100 || names[d.Name] || d.Priority < 0 {
			return errors.New("方向名称不能为空、重复或超过 100 字，优先级不能为负数")
		}
		if d.ID == "" {
			d.ID = "direction_" + Hash(d.Name)[:24]
		}
		if d.ID == "__default__" || ids[d.ID] || len(d.ID) > 100 {
			return errors.New("方向 ID 无效或重复")
		}
		ids[d.ID] = true
		names[d.Name] = true
		if d.Keywords == nil {
			d.Keywords = []string{}
		}
		if d.Owners == nil {
			d.Owners = []RosterOwner{}
		}
		seenKeywords := map[string]bool{}
		for j, k := range d.Keywords {
			k = strings.TrimSpace(k)
			if k == "" || k == "__default__" || len([]rune(k)) > 120 || seenKeywords[k] {
				return errors.New("方向关键词无效或重复")
			}
			seenKeywords[k] = true
			if !keywords[k] {
				if !legacyKeywords {
					return errors.New("关系引用了不存在的关键词")
				}
				r.Keywords = append(r.Keywords, k)
				keywords[k] = true
			}
			d.Keywords[j] = k
		}
		seenOwners := map[string]bool{}
		for j, m := range d.Owners {
			m, e := resolve(m)
			if e != nil {
				return e
			}
			if seenOwners[m.ID] {
				return errors.New("方向成员重复")
			}
			seenOwners[m.ID] = true
			d.Owners[j] = m
		}
	}
	if r.DefaultOwner != nil {
		m, e := resolve(*r.DefaultOwner)
		if e != nil {
			return e
		}
		r.DefaultOwner = &m
	}
	if len(r.Members) > 500 || len(r.Keywords) > 1000 {
		return errors.New("成员或关键词数量超限")
	}
	return nil
}

func (s *Store) Roster() (RosterSnapshot, error) {
	empty := Roster{Keywords: []string{}, Members: []RosterOwner{}, Directions: []RosterDirection{}}
	if _, e := s.DB.Exec(`INSERT INTO fr_settings(id,payload,revision) VALUES('fastinsight_roster',?,?) ON CONFLICT(id) DO NOTHING`, JSON(empty), Random()); e != nil {
		return RosterSnapshot{}, e
	}
	var raw string
	result := RosterSnapshot{Storage: "database"}
	e := s.DB.QueryRow(`SELECT payload,revision FROM fr_settings WHERE id='fastinsight_roster'`).Scan(&raw, &result.Revision)
	if e != nil {
		return result, e
	}
	e = json.Unmarshal([]byte(raw), &result.Roster)
	return result, e
}

// Compare-and-swap in SQL protects writes across processes and both backends.
func (s *Store) SaveRoster(r Roster, revision string) (RosterSnapshot, error) {
	result := RosterSnapshot{Roster: r, Revision: Random(), Storage: "database"}
	var saved string
	e := s.DB.QueryRow(`UPDATE fr_settings SET payload=?,revision=? WHERE id='fastinsight_roster' AND revision=? RETURNING revision`, JSON(r), result.Revision, revision).Scan(&saved)
	if errors.Is(e, sql.ErrNoRows) {
		return result, ErrRosterConflict
	}
	if e != nil {
		return result, fmt.Errorf("save roster: %w", e)
	}
	return result, nil
}
