package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/FastR-D/FastResearch/internal/config"
	"github.com/FastR-D/FastResearch/internal/httpapi"
	"github.com/FastR-D/FastResearch/internal/identity"
	"github.com/FastR-D/FastResearch/internal/integrations"
	"github.com/FastR-D/FastResearch/internal/store"
	"github.com/FastR-D/FastResearch/internal/workflow"
)

func main() {
	if e := run(); e != nil {
		slog.Error("FastResearch stopped", "error", e)
		os.Exit(1)
	}
}
func run() error {
	c, e := config.Load()
	if e != nil {
		return e
	}
	s, e := store.Open(c.Database)
	if e != nil {
		return e
	}
	defer s.Close()
	cas, e := identity.New(c, s)
	if e != nil {
		return e
	}
	wf, e := workflow.Open(c.DataDir)
	if e != nil {
		return e
	}
	defer wf.DB.Close()
	writeProvider, e := integrations.ServiceClient("FASTWRITE_FASTCAS_SERVICE")
	if e != nil {
		return e
	}
	workspaceProvider, e := integrations.ServiceClient("FASTRESEARCH_WORKSPACE_SERVICE")
	if e != nil {
		return e
	}
	write := &integrations.Client{Base: integrations.First("FASTWRITE_URL", "VITE_WRITE_URL"), Provider: writeProvider, Scope: config.Env("FASTWRITE_SERVICE_SCOPE", "integrations:fastresearch")}
	if writeProvider == nil && os.Getenv("FASTRESEARCH_ALLOW_LEGACY_FASTWRITE_KEY") == "true" {
		write.Key = os.Getenv("FASTWRITE_API_KEY")
	}
	app := httpapi.New(c, s, cas, wf, write)
	activityProvider := workspaceProvider
	if activityProvider == nil {
		activityProvider = writeProvider
	}
	app.ActivityClients, e = integrations.WorkspaceClients(activityProvider)
	if e != nil {
		return e
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); syncEvents(ctx, wf, app.ActivityClients) }()
	defer func() { stop(); <-workerDone }()
	return httpapi.Run(ctx, c, app)
}
func syncEvents(ctx context.Context, wf *workflow.Store, clients map[string]*integrations.Client) {
	target := clients[os.Getenv("FASTRESEARCH_WORKFLOW_EVENT_APP")]
	path := os.Getenv("FASTRESEARCH_WORKFLOW_EVENT_PATH")
	if target == nil || path == "" || !strings.HasPrefix(path, "/") || strings.HasPrefix(path, "//") {
		<-ctx.Done()
		return
	}
	client := &integrations.Client{Base: target.Base, Provider: target.Provider, Scope: config.Env("FASTRESEARCH_WORKFLOW_EVENT_SCOPE", "workspace:write")}
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !client.Configured() {
				continue
			}
			events, e := wf.Pending()
			if e != nil {
				slog.Error("outbox read failed", "error", e)
				continue
			}
			for _, event := range events {
				payload := store.Decode(store.String(event["payload"]))
				id := store.String(event["id"])
				h := http.Header{"Idempotency-Key": []string{id}}
				_, e = client.Request(ctx, "POST", path, store.Object{"schema_version": "1.0", "trace_id": "fastresearch-" + id, "source": store.Object{"external_id": id}, "kind": "progress_evidence", "title": "FastResearch 工序完成", "description": payload["description"], "artifacts": payload["artifacts"], "receiver_ref": event["account_id"], "metadata": payload}, h)
				attempt, _ := event["attempts"].(int64)
				if err := wf.Mark(id, e, int(attempt)); err != nil {
					slog.Error("outbox update failed", "error", err)
				}
			}
		}
	}
}
