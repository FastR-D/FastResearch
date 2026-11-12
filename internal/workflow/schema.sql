    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      dispatch_id TEXT,
      dispatch_revision INTEGER,
      title TEXT NOT NULL,
      description TEXT,
      source TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued',
      received_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      task_id TEXT,
      task_revision INTEGER,
      goal_id TEXT,
      plan_id TEXT,
      plan_item_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_workflows_account ON workflows(account_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_dispatch ON workflows(dispatch_id);
    CREATE INDEX IF NOT EXISTS idx_workflows_status ON workflows(account_id, status);

    CREATE TABLE IF NOT EXISTS workflow_stages (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      module TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      success_criteria TEXT,
      completion_target TEXT,
      source_task_id TEXT,
      source_plan_item_id TEXT,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_stages_workflow ON workflow_stages(workflow_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_stages_workflow_stage ON workflow_stages(workflow_id, stage_id);

    CREATE TABLE IF NOT EXISTS stage_materials (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_id TEXT NOT NULL,
      material_type TEXT NOT NULL,
      content TEXT NOT NULL,
      FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_materials_stage ON stage_materials(stage_id);

    CREATE TABLE IF NOT EXISTS stage_completions (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      stage_id TEXT NOT NULL,
      completion_type TEXT NOT NULL,
      description TEXT,
      artifacts TEXT,
      completed_at TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE,
      FOREIGN KEY(stage_id) REFERENCES workflow_stages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_completions_workflow ON stage_completions(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_completions_operation ON stage_completions(operation_id);

    CREATE TABLE IF NOT EXISTS dispatch_receipts (
      dispatch_id TEXT NOT NULL,
      dispatch_revision INTEGER NOT NULL,
      workflow_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      received_at TEXT NOT NULL,
      PRIMARY KEY(dispatch_id, dispatch_revision),
      FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_receipts_workflow ON dispatch_receipts(workflow_id);

    CREATE TABLE IF NOT EXISTS outbound_events (
      id TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      dispatch_id TEXT,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      last_error TEXT,
      created_at TEXT NOT NULL,
      synced_at TEXT,
      FOREIGN KEY(workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_outbound_status ON outbound_events(status, next_attempt_at);
    CREATE INDEX IF NOT EXISTS idx_outbound_workflow ON outbound_events(workflow_id);
