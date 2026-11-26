package httpapi

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestAuthRateLimitAndStorageFailure(t *testing.T) {
	for _, route := range []struct {
		name, method, path, prefix string
		limit                      int
	}{
		{"cas", http.MethodGet, "/api/auth/fastcas/login", "login:", 60},
		{"legacy-key", http.MethodPost, "/api/content/unlock", "key:", 12},
	} {
		t.Run(route.name, func(t *testing.T) {
			a, _, _ := setup(t)
			a.Config.LegacyKeys = true
			for i := 0; i < route.limit; i++ {
				if allowed, err := a.Store.AllowAttempt(route.prefix+"192.0.2.1", route.limit); err != nil || !allowed {
					t.Fatalf("prepare allowance: %v", err)
				}
			}
			request := func() *httptest.ResponseRecorder {
				r := httptest.NewRequest(route.method, route.path, strings.NewReader(`{"key":"invalid"}`))
				r.RemoteAddr = "192.0.2.1:12345"
				w := httptest.NewRecorder()
				a.ServeHTTP(w, r)
				return w
			}
			limited := request()
			if limited.Code != http.StatusTooManyRequests || limited.Header().Get("Retry-After") != "900" {
				t.Fatalf("expected actual rate limit: %d %s", limited.Code, limited.Body.String())
			}
			a.Store.Close()
			unavailable := request()
			if unavailable.Code != http.StatusServiceUnavailable || strings.Contains(unavailable.Body.String(), "尝试过多") || strings.Contains(unavailable.Body.String(), "database") || unavailable.Header().Get("Retry-After") != "" {
				t.Fatalf("storage failure misreported or leaked: %d %s", unavailable.Code, unavailable.Body.String())
			}
		})
	}
}
