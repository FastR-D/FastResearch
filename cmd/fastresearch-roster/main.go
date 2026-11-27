// fastresearch-roster is a one-time operator migration command. It accepts JSON
// converted from the legacy YAML; the running application never reads YAML.
package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/FastR-D/FastResearch/internal/store"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	input := flag.String("input", "", "Legacy roster JSON file")
	apply := flag.Bool("apply", false, "Apply the validated import; default is preview")
	expected := flag.String("expect-revision", "", "Revision from the preview, required when applying")
	flag.Parse()
	if *input == "" {
		return errors.New("--input is required")
	}
	if *apply && *expected == "" {
		return errors.New("--expect-revision from a preview is required")
	}
	file, err := os.Open(*input)
	if err != nil {
		return err
	}
	defer file.Close()
	raw, err := io.ReadAll(io.LimitReader(file, 1048577))
	if err != nil {
		return err
	}
	if len(raw) > 1048576 {
		return errors.New("input exceeds 1 MiB")
	}
	var source store.Roster
	if err = json.Unmarshal(raw, &source); err != nil {
		return fmt.Errorf("invalid roster JSON: %w", err)
	}
	var db *store.Store
	backend := "postgresql"
	if dsn := os.Getenv("FASTRESEARCH_DATABASE_URL"); dsn != "" {
		db, err = store.OpenPostgres(dsn)
	} else if path := os.Getenv("FASTRESEARCH_ACCOUNT_DATABASE"); path != "" {
		backend = "sqlite"
		db, err = store.Open(path)
	} else {
		return errors.New("set FASTRESEARCH_DATABASE_URL or FASTRESEARCH_ACCOUNT_DATABASE explicitly")
	}
	if err != nil {
		return errors.New("cannot open the configured Research database")
	}
	defer db.Close()
	target, err := db.PrepareRosterImport(source)
	if err != nil {
		return err
	}
	before, err := db.Roster()
	if err != nil {
		return err
	}
	same := store.JSON(before.Roster) == store.JSON(target)
	if !same && !store.RosterEmpty(before.Roster) {
		return errors.New("database already contains a different roster; refusing to overwrite")
	}
	status := "ready"
	if same {
		status = "already_imported"
	}
	after := before
	if *apply {
		var changed bool
		after, changed, err = db.ImportRoster(target, *expected)
		if err != nil {
			return err
		}
		if changed {
			status = "imported"
		} else {
			status = "already_imported"
		}
	}
	keywordEdges, memberEdges := 0, 0
	for _, d := range target.Directions {
		keywordEdges += len(d.Keywords)
		memberEdges += len(d.Owners)
	}
	report := store.Object{"status": status, "backend": backend, "input_sha256": store.Hash(string(raw)), "counts": store.Object{"directions": len(target.Directions), "keywords": len(target.Keywords), "members": len(target.Members), "keyword_edges": keywordEdges, "member_edges": memberEdges}, "before": before, "after": after, "target": target}
	return json.NewEncoder(os.Stdout).Encode(report)
}
