package config

import (
	"testing"
	"time"
)

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

func TestOfflineAccessRequiresExplicitOptIn(t *testing.T) {
	t.Setenv("FASTRESEARCH_FASTCAS_OFFLINE_ACCESS", "")
	c, e := Load()
	if e != nil {
		t.Fatal(e)
	}
	if c.OfflineAccess {
		t.Fatal("unregistered offline access requested by default")
	}
	t.Setenv("FASTRESEARCH_FASTCAS_OFFLINE_ACCESS", "true")
	c, e = Load()
	if e != nil {
		t.Fatal(e)
	}
	if !c.OfflineAccess {
		t.Fatal("explicit offline access opt in ignored")
	}
}

func TestCASSessionLifetime(t *testing.T) {
	t.Setenv("FASTRESEARCH_CAS_SESSION_TTL", "")
	c, err := Load()
	if err != nil || c.SessionLifetime() != 14*24*time.Hour {
		t.Fatalf("default lifetime: %v %v", c.SessionLifetime(), err)
	}
	t.Setenv("FASTRESEARCH_CAS_SESSION_TTL", "168h")
	c, err = Load()
	if err != nil || c.SessionLifetime() != 7*24*time.Hour {
		t.Fatalf("configured lifetime: %v %v", c.SessionLifetime(), err)
	}
	for _, value := range []string{"0", "-1h", "invalid"} {
		t.Setenv("FASTRESEARCH_CAS_SESSION_TTL", value)
		if _, err := Load(); err == nil {
			t.Fatalf("invalid lifetime accepted: %s", value)
		}
	}
}

func TestResourceCredentialsMustBeComplete(t *testing.T) {
	t.Setenv("FASTRESEARCH_FASTCAS_ENABLED", "true")
	t.Setenv("FASTRESEARCH_PUBLIC_URL", "https://research.example.test")
	t.Setenv("FASTRESEARCH_FASTCAS_ISSUER", "https://cas.example.test")
	t.Setenv("FASTRESEARCH_FASTCAS_CLIENT_ID", "research")
	t.Setenv("FASTRESEARCH_FASTCAS_CLIENT_SECRET", "login-secret")
	t.Setenv("FASTRESEARCH_FASTCAS_REDIRECT_URI", "https://research.example.test/api/auth/fastcas/callback")
	for _, pair := range [][2]string{{"research-api", ""}, {"", "resource-secret"}} {
		t.Setenv("FASTRESEARCH_FASTCAS_RESOURCE_CLIENT_ID", pair[0])
		t.Setenv("FASTRESEARCH_FASTCAS_RESOURCE_CLIENT_SECRET", pair[1])
		if _, err := Load(); err == nil {
			t.Fatal("partial resource credentials accepted")
		}
	}
	t.Setenv("FASTRESEARCH_FASTCAS_RESOURCE_CLIENT_ID", "research-api")
	t.Setenv("FASTRESEARCH_FASTCAS_RESOURCE_CLIENT_SECRET", "resource-secret")
	c, err := Load()
	if err != nil || c.ResourceClientID != "research-api" || c.ClientID != "research" {
		t.Fatal("resource and login configuration not separated", err)
	}
}
