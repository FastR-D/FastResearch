import { describe, it, before, after } from 'node:test'
import assert from 'node:assert'
import { unlink } from 'node:fs/promises'
import { openWorkflowStore } from './workflow-store.mjs'
import { receiveDispatch, startWorkflow, completeStage, formatWorkflowView } from './fasttask-dispatch.mjs'

describe('FastTask Integration', () => {
  const TEST_DB = './test-workflows.sqlite'
  let db

  before(() => {
    db = openWorkflowStore(TEST_DB)
  })

  after(async () => {
    db?.close()
    try {
      await unlink(TEST_DB)
      await unlink(TEST_DB + '-shm')
      await unlink(TEST_DB + '-wal')
    } catch {}
  })

  it('should receive a dispatch with valid payload', () => {
    const payload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-001',
      dispatch_revision: 1,
      receiver_ref: 'account-123',
      title: '阅读与分析论文',
      description: '阅读 Transformer 论文并撰写分析报告',
      task_id: 'task-001',
      task_revision: 1,
      stages: [
        {
          stage_id: 'stage-1',
          module: 'fast-read',
          title: '阅读论文',
          description: '深度阅读 Attention Is All You Need',
          success_criteria: '完成论文精读，理解核心机制',
        },
        {
          stage_id: 'stage-2',
          module: 'fast-write',
          title: '撰写分析报告',
          description: '总结 Transformer 架构的创新点',
        },
      ],
    }

    const result = receiveDispatch(db, payload, 'account-123')

    assert.strictEqual(result.duplicate, false)
    assert.strictEqual(result.receipt.dispatch_id, 'test-dispatch-001')
    assert.strictEqual(result.receipt.dispatch_revision, 1)
    assert.ok(result.receipt.workflow_id)
    assert.strictEqual(result.workflow.status, 'queued')
    assert.strictEqual(result.workflow.stages.length, 2)
  })

  it('should return duplicate receipt for same dispatch', () => {
    const payload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-001',
      dispatch_revision: 1,
      receiver_ref: 'account-123',
      title: '阅读与分析论文',
      stages: [
        {
          stage_id: 'stage-1',
          module: 'fast-read',
          title: '阅读论文',
        },
      ],
    }

    const result = receiveDispatch(db, payload, 'account-123')

    assert.strictEqual(result.duplicate, true)
    assert.strictEqual(result.receipt.dispatch_id, 'test-dispatch-001')
  })

  it('should reject older dispatch revision', () => {
    const payload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-001',
      dispatch_revision: 0,
      receiver_ref: 'account-123',
      title: '旧版本',
      stages: [
        {
          stage_id: 'stage-1',
          module: 'fast-read',
          title: '测试',
        },
      ],
    }

    assert.throws(
      () => receiveDispatch(db, payload, 'account-123'),
      /发布版本过旧/
    )
  })

  it('should start a workflow', () => {
    const payload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-002',
      dispatch_revision: 1,
      receiver_ref: 'account-456',
      title: '实验流水线',
      stages: [
        {
          stage_id: 'stage-1',
          module: 'fast-news',
          title: '运行实验',
        },
        {
          stage_id: 'stage-2',
          module: 'fast-write',
          title: '记录结果',
        },
      ],
    }

    const received = receiveDispatch(db, payload, 'account-456')
    const result = startWorkflow(db, received.workflow.id, 'account-456')

    assert.strictEqual(result.alreadyActive, false)
    assert.strictEqual(result.workflow.status, 'active')
    assert.strictEqual(result.workflow.stages[0].status, 'active')
    assert.strictEqual(result.workflow.stages[1].status, 'pending')
  })

  it('should complete a stage and activate next', () => {
    const payload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-003',
      dispatch_revision: 1,
      receiver_ref: 'account-789',
      title: '完整流程测试',
      stages: [
        {
          stage_id: 'stage-a',
          module: 'fast-read',
          title: '第一步',
        },
        {
          stage_id: 'stage-b',
          module: 'fast-write',
          title: '第二步',
        },
      ],
    }

    const received = receiveDispatch(db, payload, 'account-789')
    startWorkflow(db, received.workflow.id, 'account-789')

    const completionData = {
      completion_type: 'manual',
      description: '已完成第一步阅读',
      artifacts: [{ type: 'note', url: 'https://example.com/note1' }],
    }

    const result = completeStage(
      db,
      received.workflow.id,
      'stage-a',
      'account-789',
      completionData,
      'op-001'
    )

    assert.strictEqual(result.duplicate, false)
    assert.ok(result.completion.id)
    assert.strictEqual(result.workflow.stages[0].status, 'completed')
    assert.strictEqual(result.workflow.stages[1].status, 'active')
  })

  it('should format workflow view correctly', () => {
    const payload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-004',
      dispatch_revision: 1,
      receiver_ref: 'account-view',
      title: '视图测试',
      description: '测试视图格式化',
      task_id: 'task-view-001',
      stages: [
        {
          stage_id: 'view-stage-1',
          module: 'fast-read',
          title: '阅读',
        },
      ],
    }

    const received = receiveDispatch(db, payload, 'account-view')
    const view = formatWorkflowView(received.workflow)

    assert.strictEqual(view.id, received.workflow.id)
    assert.strictEqual(view.title, '视图测试')
    assert.strictEqual(view.source, 'fasttask')
    assert.strictEqual(view.status, 'queued')
    assert.strictEqual(view.taskId, 'task-view-001')
    assert.strictEqual(view.stages.length, 1)
    assert.strictEqual(view.progress.total, 1)
    assert.strictEqual(view.progress.completed, 0)
  })

  it('should validate dispatch payload', () => {
    const invalidPayload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-invalid',
      dispatch_revision: 1,
      receiver_ref: 'account-invalid',
      title: '无效工序',
      stages: [
        {
          stage_id: 'bad-stage',
          module: 'invalid-module',
          title: '错误模块',
        },
      ],
    }

    assert.throws(
      () => receiveDispatch(db, invalidPayload, 'account-invalid'),
      /无效的模块标识/
    )
  })

  it('should prevent starting second active workflow', () => {
    const payload1 = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-005',
      dispatch_revision: 1,
      receiver_ref: 'account-multi',
      title: '第一个流水线',
      stages: [
        {
          stage_id: 'stage-m1',
          module: 'fast-read',
          title: '步骤1',
        },
      ],
    }

    const payload2 = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: 'test-dispatch-006',
      dispatch_revision: 1,
      receiver_ref: 'account-multi',
      title: '第二个流水线',
      stages: [
        {
          stage_id: 'stage-m2',
          module: 'fast-write',
          title: '步骤2',
        },
      ],
    }

    const received1 = receiveDispatch(db, payload1, 'account-multi')
    const received2 = receiveDispatch(db, payload2, 'account-multi')

    startWorkflow(db, received1.workflow.id, 'account-multi')

    assert.throws(
      () => startWorkflow(db, received2.workflow.id, 'account-multi'),
      /已有正在执行的流水线/
    )
  })
})
