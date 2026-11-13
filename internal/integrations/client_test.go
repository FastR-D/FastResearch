package integrations

import (
	"testing"

	fastcas "github.com/FastR-D/FastCAS/sdk/go"
)

func TestWorkspaceClientsInheritServiceIdentityAndRespectDisable(t *testing.T) {
	for _, prefix := range []string{"FASTNEWS", "FASTREAD", "FASTWRITE", "FASTTASK"} {
		for _, suffix := range []string{"_SERVICE_ISSUER", "_SERVICE_CLIENT_ID", "_SERVICE_CLIENT_SECRET", "_SERVICE_ENABLED", "_FASTCAS_SERVICE_ISSUER", "_FASTCAS_SERVICE_CLIENT_ID", "_FASTCAS_SERVICE_CLIENT_SECRET", "_FASTCAS_SERVICE_ENABLED"} {
			t.Setenv(prefix+suffix, "")
		}
	}
	t.Setenv("FASTTASK_PUBLIC_URL", "https://task.example.test")
	t.Setenv("FASTTASK_URL", "")
	shared := &fastcas.Client{}
	clients, err := WorkspaceClients(shared)
	if err != nil {
		t.Fatal(err)
	}
	client := clients["fast-task"]
	if !client.Configured() || client.Provider != shared || client.Base != "https://task.example.test" || client.Scope != "workspace:read" || client.WorkspacePath != "/api/integrations/fastresearch/workspace" {
		t.Fatalf("generic client was not wired: %#v", client)
	}
	t.Setenv("FASTTASK_SERVICE_ENABLED", "false")
	clients, err = WorkspaceClients(shared)
	if err != nil || clients["fast-task"].Configured() {
		t.Fatal("explicit service disable ignored", err)
	}
	t.Setenv("FASTTASK_SERVICE_ENABLED", "")
	t.Setenv("FASTTASK_URL", "http://127.0.0.1:10000")
	clients, err = WorkspaceClients(shared)
	if err != nil || clients["fast-task"].Base != "http://127.0.0.1:10000" {
		t.Fatal("internal service URL not preferred", err)
	}
}
