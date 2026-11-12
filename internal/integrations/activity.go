package integrations

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"
)

const ActivitySchema = "fastresearch.workspace.v1"

type Metric struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Value int    `json:"value"`
}
type ActivityItem struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"`
	Title       string `json:"title"`
	Description string `json:"description,omitempty"`
	Path        string `json:"path"`
	OccurredAt  string `json:"occurredAt,omitempty"`
}
type Activity struct {
	SchemaVersion    string         `json:"schemaVersion"`
	AppID            string         `json:"appId"`
	AccountState     string         `json:"accountState"`
	UpdatedAt        string         `json:"updatedAt,omitempty"`
	Metrics          []Metric       `json:"metrics"`
	Items            []ActivityItem `json:"items"`
	Message          string         `json:"message,omitempty"`
	RegistrationPath *string        `json:"registrationPath,omitempty"`
}

func (c *Client) Activity(ctx context.Context, app, subject string) (*Activity, error) {
	raw, e := c.Request(ctx, "POST", "/api/integrations/fastresearch/workspace", map[string]string{"subject": subject}, nil)
	if e != nil {
		return nil, e
	}
	b, e := json.Marshal(raw)
	if e != nil {
		return nil, e
	}
	var v Activity
	if e = json.Unmarshal(b, &v); e != nil {
		return nil, e
	}
	if v.SchemaVersion != ActivitySchema || v.AppID != app || (v.AccountState != "active" && v.AccountState != "missing" && v.AccountState != "inactive") {
		return nil, errors.New("invalid workspace activity response")
	}
	if len(v.Metrics) > 8 || len(v.Items) > 8 {
		return nil, errors.New("workspace activity exceeds bounds")
	}
	for _, m := range v.Metrics {
		if m.Value < 0 || len(m.Label) > 120 {
			return nil, errors.New("invalid activity metric")
		}
	}
	for _, item := range v.Items {
		u, e := url.Parse(item.Path)
		if e != nil || u.IsAbs() || u.Host != "" || !strings.HasPrefix(item.Path, "/") || strings.ContainsAny(item.Path, "\\\r\n") || len(item.Title) > 1000 {
			return nil, errors.New("invalid activity item")
		}
	}
	if v.AccountState != "active" {
		v.Metrics = []Metric{}
		v.Items = []ActivityItem{}
	}
	if v.Metrics == nil {
		v.Metrics = []Metric{}
	}
	if v.Items == nil {
		v.Items = []ActivityItem{}
	}
	v.RegistrationPath = nil
	return &v, nil
}
