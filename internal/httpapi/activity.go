package httpapi

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/FastR-D/FastResearch/internal/integrations"
)

func (a *Server) activitySubject(ctx context.Context, p *principal) (string, error) {
	if p.Session.Source == "fastcas" {
		return p.Session.Subject, nil
	}
	if a.CAS.Client == nil {
		return "", nil
	}
	var subject string
	e := a.Store.DB.QueryRowContext(ctx, `SELECT subject FROM fr_identities WHERE issuer=? AND client_id=? AND account_id=?`, a.Config.Issuer, a.Config.ClientID, p.Account.ID).Scan(&subject)
	if e == sql.ErrNoRows {
		var exists int
		if e = a.Store.DB.QueryRowContext(ctx, `SELECT count(*) FROM sqlite_master WHERE name='fastcas_links'`).Scan(&exists); e != nil {
			return "", e
		}
		if exists == 0 {
			return "", nil
		}
		e = a.Store.DB.QueryRowContext(ctx, `SELECT subject FROM fastcas_links WHERE issuer=? AND client_id=? AND account_id=? AND state='active'`, a.Config.Issuer, a.Config.ClientID, p.Account.ID).Scan(&subject)
	}
	if e == sql.ErrNoRows {
		return "", nil
	}
	if e != nil {
		return "", e
	}
	link, e := a.CAS.Client.ResolveLink(ctx, subject)
	if e != nil {
		return "", e
	}
	if link.State != "active" || link.LocalRef != p.Account.ID || link.Subject != subject || link.ClientID != a.Config.ClientID {
		return "", errors.New("CAS binding changed")
	}
	return subject, nil
}
func (a *Server) appActivity(w http.ResponseWriter, r *http.Request) error {
	p, e := a.member(r, false)
	if e != nil {
		return e
	}
	var app *integrations.App
	for _, candidate := range integrations.Apps() {
		if candidate.ID == r.PathValue("id") {
			v := candidate
			app = &v
			break
		}
	}
	if app == nil {
		return fail(404, "应用不存在")
	}
	v := &integrations.Activity{SchemaVersion: integrations.ActivitySchema, AppID: app.ID, AccountState: "unavailable", Metrics: []integrations.Metric{}, Items: []integrations.ActivityItem{}}
	ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
	defer cancel()
	subject, e := a.activitySubject(ctx, p)
	if e != nil {
		v.Message = "暂时无法确认 CAS 绑定，请稍后重试"
	} else if subject == "" {
		v.AccountState = "requires_cas"
		v.Message = "使用已绑定此个人 Key 的 FastCAS 账号后，可查看子应用个人动态"
	} else if !app.Configured {
		v.Message = "当前部署尚未配置应用入口"
	} else if client := a.ActivityClients[app.ID]; client == nil || !client.Configured() {
		v.AccountState = "not_configured"
		v.Message = "个人动态服务尚未配置，仍可进入应用查看"
	} else {
		result, err := client.Activity(ctx, app.ID, subject)
		if err != nil {
			v.Message = "暂时无法读取个人动态，请稍后重试"
		} else {
			v = result
			// Only configured application origins may receive deep links. The child
			// response cannot inject a different origin or a Research bearer credential.
			base, e := url.Parse(app.PublicURL)
			if e != nil || base.Host == "" {
				return fail(503, "应用公开地址无效")
			}
			for i := range v.Items {
				ref, _ := url.Parse(v.Items[i].Path)
				destination := *base
				destination.Path = strings.TrimRight(base.Path, "/") + ref.Path
				destination.RawPath = ""
				destination.RawQuery = ref.RawQuery
				destination.Fragment = ref.Fragment
				v.Items[i].Path = destination.String()
			}
			if v.AccountState == "missing" {
				v.RegistrationPath = app.RegistrationPath
				v.Message = "此 FastCAS 身份尚未开通该应用，请先注册或使用邀请关联已有账号"
			}
			if v.AccountState == "inactive" {
				v.Message = "应用账号已停用或 CAS 绑定已失效，请在应用中恢复或联系管理员"
			}
		}
	}
	write(w, 200, v)
	return nil
}
