package httpapi

import (
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

func (a *Server) gateway(w http.ResponseWriter, r *http.Request) bool {
	host := r.Host
	// Only a loopback reverse proxy may supply the public authority.
	peer, _, _ := net.SplitHostPort(r.RemoteAddr)
	if ip := net.ParseIP(peer); ip != nil && ip.IsLoopback() {
		if forwarded := r.Header.Get("X-Forwarded-Host"); forwarded != "" {
			host = strings.TrimSpace(strings.Split(forwarded, ",")[0])
		}
	}
	if h, _, e := net.SplitHostPort(host); e == nil {
		host = h
	}
	host = strings.ToLower(strings.TrimSuffix(host, "."))
	if host == "research.fastrd.io" {
		http.Redirect(w, r, "https://fastrd.io"+r.URL.RequestURI(), 308)
		return true
	}
	if host == "ui.fastrd.io" {
		http.Redirect(w, r, "https://fastr-d.github.io/FastUI"+r.URL.RequestURI(), 308)
		return true
	}
	if host == "insight.fastrd.io" {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>FastInsight</title><main><h1>FastInsight</h1><p>通过飞书机器人收集和整理研究资料。</p><a href="https://fastrd.io/workspace">打开 FastResearch</a></main></html>`))
		return true
	}
	ports := map[string]string{"cas.fastrd.io": "8900", "task.fastrd.io": "10000", "read.fastrd.io": "8584", "write.fastrd.io": "3003", "news.fastrd.io": "8788", "figure.fastrd.io": "5178", "fastlabs.fastrd.io": "8789"}
	port, ok := ports[host]
	if !ok {
		return false
	}
	protected := host == "figure.fastrd.io" || host == "fastlabs.fastrd.io"
	if protected {
		if r.Header.Get("Origin") != "" && r.Header.Get("Origin") != "https://"+host {
			write(w, 403, map[string]string{"error": "不允许跨站访问预览环境"})
			return true
		}
		if _, e := a.member(r, true); e != nil {
			write(w, 401, map[string]string{"error": "请先使用 FastCAS 管理员账号登录 FastResearch"})
			return true
		}
	}
	target, _ := url.Parse("http://127.0.0.1:" + port)
	proxy := httputil.NewSingleHostReverseProxy(target)
	original := proxy.Director
	proxy.Director = func(req *http.Request) {
		original(req)
		if protected {
			req.Host = target.Host
			req.Header.Del("Authorization")
			if req.Header.Get("Origin") != "" {
				req.Header.Set("Origin", target.String())
			}
		} else {
			req.Host = host
		}
		req.Header.Set("X-Forwarded-Host", host)
		req.Header.Set("X-Forwarded-Proto", "https")
		cookies := req.Cookies()
		req.Header.Del("Cookie")
		for _, c := range cookies {
			if c.Name != a.Config.CookieName && c.Name != "fr_fastcas_binding" {
				req.AddCookie(c)
			}
		}
		if host == "news.fastrd.io" && (req.URL.Path == "/news" || strings.HasPrefix(req.URL.Path, "/news/")) {
			req.URL.Path = strings.TrimPrefix(req.URL.Path, "/news")
			if req.URL.Path == "" {
				req.URL.Path = "/"
			}
		}
	}
	proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, e error) {
		write(w, 502, map[string]string{"error": "应用暂时不可用"})
	}
	proxy.ServeHTTP(w, r)
	return true
}
