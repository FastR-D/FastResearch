package integrations

import (
	"net/url"
	"os"
	"strings"
)

type App struct {
	Capabilities       []string `json:"capabilities"`
	WorkspacePath      string   `json:"-"`
	ID                 string   `json:"id"`
	Name               string   `json:"name"`
	Configured         bool     `json:"configured"`
	Auth               string   `json:"auth"`
	LaunchPath         *string  `json:"launchPath"`
	Target             string   `json:"-"`
	PublicURL          string   `json:"-"`
	RegistrationTarget string   `json:"-"`
	RegistrationPath   *string  `json:"registrationPath"`
}

func First(keys ...string) string {
	for _, k := range keys {
		if s := strings.TrimSpace(os.Getenv(k)); s != "" {
			return s
		}
	}
	return ""
}
func Apps() []App {
	definitions := []struct {
		id, name                  string
		keys                      []string
		fallback, login, override string
		capabilities              []string
	}{
		{"fast-news", "FastNews", []string{"FASTNEWS_PUBLIC_URL", "VITE_FASTNEWS_URL", "FASTNEWS_URL"}, "http://127.0.0.1:4173", "api/auth/fastcas/login", "FASTNEWS_CAS_LOGIN_URL", []string{"activity"}},
		{"fast-read", "FastRead", []string{"FASTREAD_PUBLIC_URL", "VITE_READ_URL", "FASTREAD_URL"}, "http://127.0.0.1:3015", "api/auth/fastcas/login", "FASTREAD_CAS_LOGIN_URL", []string{"activity"}},
		{"fast-write", "FastWrite", []string{"FASTWRITE_PUBLIC_URL", "VITE_WRITE_URL", "FASTWRITE_URL"}, "http://127.0.0.1:3003", "api/auth/fastcas/login?returnTo=%2Fpanel", "FASTWRITE_CAS_LOGIN_URL", []string{"activity"}},
		{"fast-ppt", "FastPPT", []string{"FASTPPT_PUBLIC_URL", "VITE_FASTPPT_URL"}, "", "", "FASTPPT_CAS_LOGIN_URL", []string{}},
		{"fast-lab", "FastLab", []string{"FASTLAB_PUBLIC_URL", "VITE_FASTLAB_URL"}, "", "", "FASTLAB_CAS_LOGIN_URL", []string{}},
		{"fast-task", "FastTask", []string{"FASTTASK_PUBLIC_URL", "VITE_FASTTASK_URL", "FASTTASK_URL"}, "", "api/v1/auth/fastcas/login", "FASTTASK_CAS_LOGIN_URL", []string{"activity", "tasks"}},
	}
	apps := []App{}
	for _, d := range definitions {
		raw := First(d.keys...)
		if raw == "" {
			raw = d.fallback
		}
		auth := "direct"
		target := raw
		if override := First(d.override); override != "" {
			target = override
			auth = "cas"
		} else if d.login != "" {
			u, e := url.Parse(raw)
			if e == nil && u.Host != "" {
				u.RawQuery = ""
				u.Path = strings.TrimRight(u.Path, "/") + "/"
				rel, _ := url.Parse(d.login)
				target = u.ResolveReference(rel).String()
				auth = "cas"
			}
		}
		u, e := url.Parse(target)
		valid := e == nil && u.Host != "" && u.User == nil && u.Fragment == "" && (u.Scheme == "https" || u.Scheme == "http")
		a := App{ID: d.id, Name: d.name, Auth: auth, Configured: valid, Capabilities: d.capabilities}
		if len(a.Capabilities) > 0 {
			a.WorkspacePath = "/api/integrations/fastresearch/workspace"
		}
		if path := First(strings.ToUpper(strings.ReplaceAll(d.id, "-", "")) + "_WORKSPACE_PATH"); path != "" {
			u, err := url.Parse(path)
			if err == nil && u.Host == "" && !u.IsAbs() && strings.HasPrefix(path, "/") && !strings.ContainsAny(path, "\\\r\n") {
				a.WorkspacePath = path
			} else {
				a.WorkspacePath = ""
				a.Capabilities = []string{}
			}
		}
		if valid {
			a.Target = target
			a.PublicURL = raw
			if base, e := url.Parse(raw); e == nil && base.Host != "" {
				registration := map[string]string{"fast-news": "login?mode=register", "fast-read": "?auth=register", "fast-write": "api/auth/fastcas/login?returnTo=%2Fpanel"}[d.id]
				override := First(strings.ToUpper(strings.ReplaceAll(d.id, "-", "")) + "_REGISTER_URL")
				if registration != "" || override != "" {
					base.RawQuery = ""
					base.Path = strings.TrimRight(base.Path, "/") + "/"
					ref, _ := url.Parse(registration)
					destination := base.ResolveReference(ref).String()
					if override != "" {
						destination = override
					}
					u, err := url.Parse(destination)
					if err == nil && u.Host != "" && u.User == nil && u.Fragment == "" && (u.Scheme == "http" || u.Scheme == "https") {
						a.RegistrationTarget = destination
						p := "/api/workspace/apps/" + d.id + "/register"
						a.RegistrationPath = &p
					}
				}
			}
			p := "/api/workspace/apps/" + d.id + "/launch"
			a.LaunchPath = &p
		}
		apps = append(apps, a)
	}
	return apps
}
