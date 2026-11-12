package config

import "testing"

func TestKeyLoginDefaultAndExplicitDisable(t *testing.T) {
	t.Setenv("FASTRESEARCH_ALLOW_LEGACY_KEY_LOGIN", "")
	c, e := Load()
	if e != nil {
		t.Fatal(e)
	}
	if !c.LegacyKeys {
		t.Fatal("Key login must remain available by default")
	}
	t.Setenv("FASTRESEARCH_ALLOW_LEGACY_KEY_LOGIN", "false")
	c, e = Load()
	if e != nil {
		t.Fatal(e)
	}
	if c.LegacyKeys {
		t.Fatal("explicit disable ignored")
	}
}
