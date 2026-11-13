package integrations

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"

	"github.com/FastR-D/FastResearch/internal/store"
)

type noTransactions struct{}

func (noTransactions) Put(context.Context, fastcas.Transaction) error {
	return errors.New("service identity cannot login")
}
func (noTransactions) Take(context.Context, string) (*fastcas.Transaction, error) {
	return nil, errors.New("service identity cannot login")
}
func ServiceClient(prefix string) (*fastcas.Client, error) {
	if First(prefix+"_ENABLED") == "false" {
		return nil, nil
	}
	issuer := First(prefix + "_ISSUER")
	id := First(prefix + "_CLIENT_ID")
	secret := First(prefix + "_CLIENT_SECRET")
	if issuer == "" && id == "" && secret == "" {
		return nil, nil
	}
	if issuer == "" || id == "" || secret == "" {
		return nil, errors.New(prefix + " requires issuer, client ID and secret")
	}
	return fastcas.New(fastcas.Config{Issuer: issuer, ClientID: id, ClientSecret: secret, RedirectURI: strings.TrimRight(issuer, "/") + "/console/", AllowLoopbackHTTP: First(prefix+"_ALLOW_LOOPBACK_HTTP") == "true"}, noTransactions{})
}

type Client struct {
	WorkspacePath string
	Base          string
	Provider      *fastcas.Client
	Key           string
	Scope         string
	HTTP          *http.Client
	mu            sync.Mutex
	token         *fastcas.TokenResponse
}

func (c *Client) Configured() bool { return c.Base != "" && (c.Provider != nil || c.Key != "") }
func (c *Client) Authorization(ctx context.Context) (http.Header, error) {
	h := http.Header{}
	if c.Provider != nil {
		c.mu.Lock()
		defer c.mu.Unlock()
		if c.token == nil || time.Now().Add(5*time.Second).After(c.token.Expiry) {
			token, e := c.Provider.ClientCredentials(ctx, []string{c.Scope})
			if e != nil {
				return nil, e
			}
			c.token = token
		}
		h.Set("Authorization", "Bearer "+c.token.AccessToken)
	} else if c.Key != "" {
		h.Set("X-API-Key", c.Key)
	} else {
		return nil, errors.New("service credentials not configured")
	}
	return h, nil
}
func (c *Client) Request(ctx context.Context, method, path string, b any, extra http.Header) (store.Object, error) {
	if !c.Configured() {
		return nil, errors.New("integration is not configured")
	}
	h, e := c.Authorization(ctx)
	if e != nil {
		return nil, e
	}
	for k, v := range extra {
		h[k] = v
	}
	var payload io.Reader
	if b != nil {
		payload = bytes.NewBufferString(store.JSON(b))
	}
	r, e := http.NewRequestWithContext(ctx, method, strings.TrimRight(c.Base, "/")+path, payload)
	if e != nil {
		return nil, e
	}
	r.Header = h
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json")
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	}
	resp, e := client.Do(r)
	if e != nil {
		return nil, e
	}
	defer resp.Body.Close()
	out := store.Object{}
	e = json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(&out)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, errors.New("upstream request rejected")
	}
	if e != nil {
		return nil, e
	}
	return out, nil
}

// WorkspaceClients builds the same read-only protocol client for every app.
// An app may supply its own service identity; missing credentials inherit the
// shared identity, while an explicit disable is always respected.
func WorkspaceClients(shared *fastcas.Client) (map[string]*Client, error) {
	apps := Apps()
	providers := map[string]*fastcas.Client{}
	disabled := map[string]bool{}
	for _, app := range apps {
		if app.WorkspacePath == "" {
			continue
		}
		prefix := strings.ToUpper(strings.ReplaceAll(app.ID, "-", ""))
		disabled[app.ID] = First(prefix+"_SERVICE_ENABLED") == "false"
		if disabled[app.ID] {
			continue
		}
		provider, err := ServiceClient(prefix + "_SERVICE")
		if err != nil {
			return nil, err
		}
		if provider == nil {
			provider, err = ServiceClient(prefix + "_FASTCAS_SERVICE")
			if err != nil {
				return nil, err
			}
		}
		providers[app.ID] = provider
		if shared == nil && provider != nil {
			shared = provider
		}
	}
	clients := map[string]*Client{}
	for _, app := range apps {
		if app.WorkspacePath == "" {
			continue
		}
		prefix := strings.ToUpper(strings.ReplaceAll(app.ID, "-", ""))
		base := First(prefix+"_URL", prefix+"_PUBLIC_URL")
		if base == "" {
			base = app.PublicURL
		}
		provider := providers[app.ID]
		if provider == nil && !disabled[app.ID] {
			provider = shared
		}
		clients[app.ID] = &Client{Base: base, Provider: provider, Scope: "workspace:read", WorkspacePath: app.WorkspacePath}
	}
	return clients, nil
}
