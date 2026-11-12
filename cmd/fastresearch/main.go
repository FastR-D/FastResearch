package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
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
	taskProvider, e := integrations.ServiceClient("FASTTASK_SERVICE")
	if e != nil {
		return e
	}
	if taskProvider == nil {
		taskProvider, e = integrations.ServiceClient("FASTTASK_FASTCAS_SERVICE")
		if e != nil {
			return e
		}
	}
	task := &integrations.Client{Base: integrations.First("FASTTASK_URL", "VITE_FASTTASK_URL"), Provider: taskProvider, Scope: "integrations:fastresearch"}
	if taskProvider == nil && os.Getenv("FASTRESEARCH_ALLOW_LEGACY_FASTTASK_KEYS") == "true" {
		task.Key = integrations.First("FASTTASK_API_KEY", "FASTTASK_PROVISION_KEY")
	}
	writeProvider, e := integrations.ServiceClient("FASTWRITE_FASTCAS_SERVICE")
	if e != nil {
		return e
	}
	write := &integrations.Client{Base: integrations.First("FASTWRITE_URL", "VITE_WRITE_URL"), Provider: writeProvider, Scope: config.Env("FASTWRITE_SERVICE_SCOPE", "integrations:fastresearch")}
	if writeProvider == nil && os.Getenv("FASTRESEARCH_ALLOW_LEGACY_FASTWRITE_KEY") == "true" {
		write.Key = os.Getenv("FASTWRITE_API_KEY")
	}
	app := httpapi.New(c, s, cas, wf, task, write)
	activityProvider, e := integrations.ServiceClient("FASTRESEARCH_WORKSPACE_SERVICE")
	if e != nil {
		return e
	}
	if activityProvider == nil {
		activityProvider = writeProvider
	}
	if activityProvider == nil {
		activityProvider = taskProvider
	}
	app.ActivityClients = map[string]*integrations.Client{}
	for id, base := range map[string]string{"fast-news": integrations.First("FASTNEWS_URL", "VITE_FASTNEWS_URL"), "fast-read": integrations.First("FASTREAD_URL", "VITE_READ_URL"), "fast-write": integrations.First("FASTWRITE_URL", "VITE_WRITE_URL")} {
		app.ActivityClients[id] = &integrations.Client{Base: base, Provider: activityProvider, Scope: "workspace:read"}
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	workerDone := make(chan struct{})
	go func() { defer close(workerDone); syncEvents(ctx, wf, task) }()
	defer func() { stop(); <-workerDone }()
	return httpapi.Run(ctx, c, app)
}
func syncEvents(ctx context.Context, wf *workflow.Store, task *integrations.Client) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !task.Configured() {
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
				_, e = task.Request(ctx, "POST", "/api/v1/integrations/fastresearch/progress", store.Object{"schema_version": "1.0", "trace_id": "fastresearch-" + id, "source": store.Object{"external_id": id}, "kind": "progress_evidence", "title": "FastResearch 工序完成", "description": payload["description"], "artifacts": payload["artifacts"], "receiver_ref": event["account_id"], "metadata": payload}, h)
				attempt, _ := event["attempts"].(int64)
				if err := wf.Mark(id, e, int(attempt)); err != nil {
					slog.Error("outbox update failed", "error", err)
				}
			}
		}
	}
}
