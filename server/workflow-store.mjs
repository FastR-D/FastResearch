import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openWorkflowStore(file) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec(`
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
  `)
  return db
}

export function saveWorkflow(db, workflow) {
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare(`INSERT INTO workflows(
      id, account_id, dispatch_id, dispatch_revision, title, description,
      source, status, received_at, task_id, task_revision, goal_id, plan_id, plan_item_id
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      workflow.id,
      workflow.accountId,
      workflow.dispatchId ?? null,
      workflow.dispatchRevision ?? null,
      workflow.title,
      workflow.description ?? '',
      workflow.source,
      workflow.status ?? 'queued',
      workflow.receivedAt,
      workflow.taskId ?? null,
      workflow.taskRevision ?? null,
      workflow.goalId ?? null,
      workflow.planId ?? null,
      workflow.planItemId ?? null,
    )

    if (workflow.dispatchId && workflow.dispatchRevision !== undefined) {
      db.prepare(`INSERT INTO dispatch_receipts(dispatch_id, dispatch_revision, workflow_id, account_id, received_at)
        VALUES(?, ?, ?, ?, ?)`).run(
        workflow.dispatchId,
        workflow.dispatchRevision,
        workflow.id,
        workflow.accountId,
        workflow.receivedAt,
      )
    }

    const insertStage = db.prepare(`INSERT INTO workflow_stages(
      id, workflow_id, stage_id, position, module, title, description, status,
      success_criteria, completion_target, source_task_id, source_plan_item_id
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

    for (const stage of workflow.stages ?? []) {
      insertStage.run(
        stage.id,
        workflow.id,
        stage.stageId,
        stage.position,
        stage.module,
        stage.title,
        stage.description ?? '',
        stage.status ?? 'pending',
        stage.successCriteria ?? null,
        stage.completionTarget ?? null,
        stage.sourceTaskId ?? null,
        stage.sourcePlanItemId ?? null,
      )

      if (stage.materials) {
        const insertMaterial = db.prepare(`INSERT INTO stage_materials(stage_id, material_type, content) VALUES(?, ?, ?)`)
        for (const material of stage.materials) {
          insertMaterial.run(stage.id, material.type, JSON.stringify(material.content))
        }
      }
    }

    db.exec('COMMIT')
    return workflow
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function getWorkflowById(db, workflowId, accountId) {
  const workflow = db.prepare(`SELECT * FROM workflows WHERE id = ? AND account_id = ?`).get(workflowId, accountId)
  if (!workflow) return null

  const stages = db.prepare(`SELECT * FROM workflow_stages WHERE workflow_id = ? ORDER BY position`).all(workflowId)

  for (const stage of stages) {
    stage.materials = db.prepare(`SELECT material_type as type, content FROM stage_materials WHERE stage_id = ?`)
      .all(stage.id)
      .map(m => ({ type: m.type, content: JSON.parse(m.content) }))
  }

  return { ...workflow, stages }
}

export function getWorkflowsByAccount(db, accountId, status = null) {
  const query = status
    ? db.prepare(`SELECT * FROM workflows WHERE account_id = ? AND status = ? ORDER BY received_at DESC`)
    : db.prepare(`SELECT * FROM workflows WHERE account_id = ? ORDER BY received_at DESC`)

  const workflows = status ? query.all(accountId, status) : query.all(accountId)

  for (const workflow of workflows) {
    workflow.stages = db.prepare(`SELECT * FROM workflow_stages WHERE workflow_id = ? ORDER BY position`).all(workflow.id)
  }

  return workflows
}

export function getReceiptByDispatch(db, dispatchId, dispatchRevision) {
  return db.prepare(`SELECT * FROM dispatch_receipts WHERE dispatch_id = ? AND dispatch_revision = ?`)
    .get(dispatchId, dispatchRevision)
}

export function updateWorkflowStatus(db, workflowId, accountId, status, timestamp = null) {
  const field = status === 'active' ? 'started_at' : status === 'completed' ? 'completed_at' : null
  if (field) {
    db.prepare(`UPDATE workflows SET status = ?, ${field} = ? WHERE id = ? AND account_id = ?`)
      .run(status, timestamp ?? new Date().toISOString(), workflowId, accountId)
  } else {
    db.prepare(`UPDATE workflows SET status = ? WHERE id = ? AND account_id = ?`)
      .run(status, workflowId, accountId)
  }
}

export function updateStageStatus(db, stageId, status, timestamp = null) {
  const field = status === 'active' ? 'started_at' : status === 'completed' ? 'completed_at' : null
  if (field) {
    db.prepare(`UPDATE workflow_stages SET status = ?, ${field} = ? WHERE id = ?`)
      .run(status, timestamp ?? new Date().toISOString(), stageId)
  } else {
    db.prepare(`UPDATE workflow_stages SET status = ? WHERE id = ?`)
      .run(status, stageId)
  }
}

export function saveStageCompletion(db, completion) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const existing = db.prepare(`SELECT id FROM stage_completions WHERE operation_id = ?`).get(completion.operationId)
    if (existing) {
      db.exec('COMMIT')
      return existing
    }

    db.prepare(`INSERT INTO stage_completions(
      id, workflow_id, stage_id, completion_type, description, artifacts, completed_at, operation_id
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?)`).run(
      completion.id,
      completion.workflowId,
      completion.stageId,
      completion.completionType,
      completion.description ?? '',
      completion.artifacts ? JSON.stringify(completion.artifacts) : null,
      completion.completedAt,
      completion.operationId,
    )

    updateStageStatus(db, completion.stageId, 'completed', completion.completedAt)

    const allStages = db.prepare(`SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM workflow_stages WHERE workflow_id = ?`).get(completion.workflowId)

    if (allStages.total === allStages.completed) {
      const workflow = db.prepare(`SELECT account_id FROM workflows WHERE id = ?`).get(completion.workflowId)
      updateWorkflowStatus(db, completion.workflowId, workflow.account_id, 'completed', completion.completedAt)
    }

    db.exec('COMMIT')
    return completion
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function saveOutboundEvent(db, event) {
  db.prepare(`INSERT INTO outbound_events(
    id, workflow_id, dispatch_id, event_type, payload, status, attempts, next_attempt_at, created_at
  ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    event.id,
    event.workflowId,
    event.dispatchId ?? null,
    event.eventType,
    JSON.stringify(event.payload),
    event.status ?? 'pending',
    event.attempts ?? 0,
    event.nextAttemptAt ?? Date.now(),
    event.createdAt,
  )
}

export function getPendingEvents(db, limit = 10) {
  return db.prepare(`SELECT * FROM outbound_events
    WHERE status = 'pending' AND next_attempt_at <= ?
    ORDER BY next_attempt_at LIMIT ?`)
    .all(Date.now(), limit)
    .map(row => ({
      ...row,
      payload: JSON.parse(row.payload),
    }))
}

export function markEventSynced(db, eventId, syncedAt = null) {
  db.prepare(`UPDATE outbound_events SET status = 'synced', synced_at = ? WHERE id = ?`)
    .run(syncedAt ?? new Date().toISOString(), eventId)
}

export function markEventFailed(db, eventId, error, nextAttemptAt = null) {
  db.prepare(`UPDATE outbound_events SET status = 'failed', attempts = attempts + 1, last_error = ?, next_attempt_at = ? WHERE id = ?`)
    .run(error, nextAttemptAt, eventId)
}

export function getActiveWorkflow(db, accountId) {
  const workflow = db.prepare(`SELECT * FROM workflows WHERE account_id = ? AND status = 'active' LIMIT 1`).get(accountId)
  if (!workflow) return null

  workflow.stages = db.prepare(`SELECT * FROM workflow_stages WHERE workflow_id = ? ORDER BY position`).all(workflow.id)
  return workflow
}
