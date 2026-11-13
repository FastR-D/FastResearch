package config

import (
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/joho/godotenv"
)

type Config struct {
	CASSessionTTL                                                                                                           time.Duration
	Address, DataDir, Database, StaticDir, PublicURL, CookieName, CookieDomain, Issuer, ClientID, ClientSecret, RedirectURI string
	AllowLoopbackHTTP, LegacyKeys, OfflineAccess                                                                            bool
	Origins                                                                                                                 map[string]bool
}

func Env(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
func Load() (Config, error) {
	for _, file := range []string{".env.production", ".env", ".env.local"} {
		_ = godotenv.Load(file)
	}
	c := Config{Address: Env("HOST", "127.0.0.1") + ":" + Env("PORT", "8787"), DataDir: Env("FASTRESEARCH_DATA_DIR", "data"), StaticDir: Env("FASTRESEARCH_STATIC_DIR", "dist"), PublicURL: strings.TrimRight(Env("FASTRESEARCH_PUBLIC_URL", "http://127.0.0.1:"+Env("PORT", "8787")), "/"), CookieName: Env("FASTRESEARCH_COOKIE_NAME", "fr_session"), CookieDomain: os.Getenv("FASTRESEARCH_COOKIE_DOMAIN"), Issuer: strings.TrimRight(os.Getenv("FASTRESEARCH_FASTCAS_ISSUER"), "/"), ClientID: os.Getenv("FASTRESEARCH_FASTCAS_CLIENT_ID"), ClientSecret: os.Getenv("FASTRESEARCH_FASTCAS_CLIENT_SECRET"), RedirectURI: os.Getenv("FASTRESEARCH_FASTCAS_REDIRECT_URI"), AllowLoopbackHTTP: os.Getenv("FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP") == "true", LegacyKeys: os.Getenv("FASTRESEARCH_ALLOW_LEGACY_KEY_LOGIN") != "false", OfflineAccess: os.Getenv("FASTRESEARCH_FASTCAS_OFFLINE_ACCESS") == "true", Origins: map[string]bool{}}
	var err error
	c.CASSessionTTL, err = time.ParseDuration(Env("FASTRESEARCH_CAS_SESSION_TTL", "336h"))
	if err != nil || c.CASSessionTTL <= 0 {
		return c, fmt.Errorf("FASTRESEARCH_CAS_SESSION_TTL must be a positive duration")
	}
	c.Database = Env("FASTRESEARCH_ACCOUNT_DATABASE", filepath.Join(c.DataDir, "accounts.sqlite"))
	if os.Getenv("FASTRESEARCH_FASTCAS_ENABLED") == "false" {
		c.Issuer = ""
		c.ClientID = ""
		c.ClientSecret = ""
		c.RedirectURI = ""
	}
	n := 0
	for _, v := range []string{c.Issuer, c.ClientID, c.ClientSecret, c.RedirectURI} {
		if v != "" {
			n++
		}
	}
	if n != 0 && n != 4 {
		return c, fmt.Errorf("FastCAS requires issuer, client ID, secret and redirect URI")
	}
	u, e := url.Parse(c.PublicURL)
	if e != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return c, fmt.Errorf("invalid FASTRESEARCH_PUBLIC_URL")
	}
	if n == 4 {
		r, e := url.Parse(c.RedirectURI)
		if e != nil || r.Scheme+"://"+r.Host != c.PublicURL || r.Path != "/api/auth/fastcas/callback" {
			return c, fmt.Errorf("FastCAS redirect URI must be PUBLIC_URL/api/auth/fastcas/callback")
		}
	}
	for _, v := range append(strings.Split(os.Getenv("FASTRESEARCH_CORS_ORIGINS"), ","), c.PublicURL, "http://127.0.0.1:5173", "http://localhost:5173") {
		c.Origins[strings.TrimSpace(v)] = true
	}
	return c, nil
}

// SessionLifetime is the local upper bound; non-refreshable provider credentials
// still cap the effective session lifetime.
func (c Config) SessionLifetime() time.Duration {
	if c.CASSessionTTL > 0 {
		return c.CASSessionTTL
	}
	return 14 * 24 * time.Hour
}
