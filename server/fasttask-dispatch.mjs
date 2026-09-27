import { randomBytes } from 'node:crypto'
import {
  saveWorkflow,
  getReceiptByDispatch,
  getWorkflowById,
  saveStageCompletion,
  saveOutboundEvent,
  getActiveWorkflow,
  updateWorkflowStatus,
  updateStageStatus,
} from './workflow-store.mjs'

const WORKFLOW_MODULES = {
  'fast-ppt': 'fast-ppt',
  'fast-write': 'fast-write',
  'fast-read': 'fast-read',
  'fast-news': 'fast-news',
  'fast-lab': 'fast-lab',
}

const MODULE_LABELS = {
  'fast-ppt': 'FastPPT',
  'fast-write': 'FastWrite',
  'fast-read': 'FastRead',
  'fast-news': 'FastNews',
  'fast-lab': 'FastLab',
}

function resolveModule(value) {
  const key = String(value ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-')
  return WORKFLOW_MODULES[key] ?? WORKFLOW_MODULES[key.replaceAll('-', '')] ?? null
}

export function validateDispatchPayload(body) {
  const errors = []

  if (!body || typeof body !== 'object') {
    return { valid: false, errors: ['请求体必须是有效的 JSON 对象'] }
  }

  const schemaVersion = String(body.schema_version ?? '').trim()
  if (schemaVersion !== 'fasttask-dispatch-v1') {
    errors.push(`不支持的协议版本: ${schemaVersion || '(空)'}，需要 fasttask-dispatch-v1`)
  }

  if (!body.dispatch_id || typeof body.dispatch_id !== 'string') {
    errors.push('缺少 dispatch_id')
  }

  if (body.dispatch_revision === undefined || typeof body.dispatch_revision !== 'number') {
    errors.push('缺少 dispatch_revision')
  }

  if (!body.receiver_ref || typeof body.receiver_ref !== 'string') {
    errors.push('缺少 receiver_ref（接收账号）')
  }

  if (!body.title || typeof body.title !== 'string') {
    errors.push('缺少流水线标题')
  }

  const stages = body.stages ?? []
  if (!Array.isArray(stages) || stages.length === 0) {
    errors.push('工序列表不能为空')
  } else if (stages.length > 50) {
    errors.push(`工序数量超限: ${stages.length}，最多允许 50 个`)
  } else {
    const seenStageIds = new Set()
    stages.forEach((stage, index) => {
      if (!stage.stage_id || typeof stage.stage_id !== 'string') {
        errors.push(`工序 ${index + 1}: 缺少 stage_id`)
      } else if (seenStageIds.has(stage.stage_id)) {
        errors.push(`工序 ${index + 1}: stage_id 重复: ${stage.stage_id}`)
      } else {
        seenStageIds.add(stage.stage_id)
      }

      const module = resolveModule(stage.module)
      if (!module) {
        errors.push(`工序 ${index + 1}: 无效的模块标识 "${stage.module}"`)
      }

      if (!stage.title || typeof stage.title !== 'string') {
        errors.push(`工序 ${index + 1}: 缺少标题`)
      }
    })
  }

  return { valid: errors.length === 0, errors }
}

export function receiveDispatch(db, body, receiverAccountId) {
  const validation = validateDispatchPayload(body)
  if (!validation.valid) {
    throw Object.assign(new Error(validation.errors.join('; ')), { status: 400 })
  }

  const dispatchId = String(body.dispatch_id).slice(0, 120)
  const dispatchRevision = Number(body.dispatch_revision)
  const receiverRef = String(body.receiver_ref).slice(0, 80)

  if (receiverRef !== receiverAccountId) {
    throw Object.assign(
      new Error(`接收账号不匹配: 期望 ${receiverRef}，实际 ${receiverAccountId}`),
      { status: 403 }
    )
  }

  // 幂等检查
  const existing = getReceiptByDispatch(db, dispatchId, dispatchRevision)
  if (existing) {
    const workflow = getWorkflowById(db, existing.workflow_id, receiverAccountId)
    return {
      duplicate: true,
      receipt: {
        dispatch_id: dispatchId,
        dispatch_revision: dispatchRevision,
        workflow_id: workflow.id,
        received_at: existing.received_at,
        status: workflow.status,
      },
      workflow,
    }
  }

  // 检查是否已有更新的版本
  const latestReceipt = db.prepare(
    `SELECT dispatch_revision FROM dispatch_receipts WHERE dispatch_id = ? ORDER BY dispatch_revision DESC LIMIT 1`
  ).get(dispatchId)

  if (latestReceipt && dispatchRevision < latestReceipt.dispatch_revision) {
    throw Object.assign(
      new Error(`发布版本过旧: 当前版本 ${latestReceipt.dispatch_revision}，收到 ${dispatchRevision}`),
      { status: 409 }
    )
  }

  // 检查是否已有 active 流水线
  const activeWorkflow = getActiveWorkflow(db, receiverAccountId)
  const workflowStatus = activeWorkflow ? 'queued' : 'queued'

  const workflowId = randomBytes(12).toString('hex')
  const receivedAt = new Date().toISOString()

  const stages = (body.stages ?? []).map((stage, index) => ({
    id: randomBytes(12).toString('hex'),
    stageId: String(stage.stage_id).slice(0, 80),
    position: index,
    module: resolveModule(stage.module),
    title: String(stage.title).slice(0, 300),
    description: String(stage.description ?? '').slice(0, 1200),
    status: 'pending',
    successCriteria: stage.success_criteria ? String(stage.success_criteria).slice(0, 1000) : null,
    completionTarget: stage.completion_target ? String(stage.completion_target).slice(0, 100) : null,
    sourceTaskId: stage.source_task_id ? String(stage.source_task_id).slice(0, 120) : null,
    sourcePlanItemId: stage.source_plan_item_id ? String(stage.source_plan_item_id).slice(0, 120) : null,
    materials: stage.materials
      ? stage.materials.slice(0, 20).map(m => ({
          type: String(m.type ?? 'unknown').slice(0, 40),
          content: m.content,
        }))
      : [],
  }))

  const workflow = {
    id: workflowId,
    accountId: receiverAccountId,
    dispatchId,
    dispatchRevision,
    title: String(body.title).slice(0, 200),
    description: String(body.description ?? '').slice(0, 2000),
    source: 'fasttask',
    status: workflowStatus,
    receivedAt,
    taskId: body.task_id ? String(body.task_id).slice(0, 120) : null,
    taskRevision: body.task_revision ?? null,
    goalId: body.goal_id ? String(body.goal_id).slice(0, 120) : null,
    planId: body.plan_id ? String(body.plan_id).slice(0, 120) : null,
    planItemId: body.plan_item_id ? String(body.plan_item_id).slice(0, 120) : null,
    stages,
  }

  saveWorkflow(db, workflow)

  return {
    duplicate: false,
    receipt: {
      dispatch_id: dispatchId,
      dispatch_revision: dispatchRevision,
      workflow_id: workflowId,
      received_at: receivedAt,
      status: workflowStatus,
    },
    workflow,
  }
}

export function startWorkflow(db, workflowId, accountId) {
  const workflow = getWorkflowById(db, workflowId, accountId)
  if (!workflow) {
    throw Object.assign(new Error('流水线不存在'), { status: 404 })
  }

  if (workflow.status === 'active') {
    return { workflow, alreadyActive: true }
  }

  if (workflow.status === 'completed' || workflow.status === 'cancelled') {
    throw Object.assign(new Error(`流水线已${workflow.status === 'completed' ? '完成' : '取消'}，不能启动`), { status: 409 })
  }

  const activeWorkflow = getActiveWorkflow(db, accountId)
  if (activeWorkflow && activeWorkflow.id !== workflowId) {
    throw Object.assign(
      new Error(`已有正在执行的流水线: ${activeWorkflow.title}，请先完成或取消`),
      { status: 409 }
    )
  }

  updateWorkflowStatus(db, workflowId, accountId, 'active')

  const firstPendingStage = workflow.stages.find(s => s.status === 'pending')
  if (firstPendingStage) {
    updateStageStatus(db, firstPendingStage.id, 'active')
  }

  return { workflow: getWorkflowById(db, workflowId, accountId), alreadyActive: false }
}

export function completeStage(db, workflowId, stageId, accountId, completionData, operationId) {
  const workflow = getWorkflowById(db, workflowId, accountId)
  if (!workflow) {
    throw Object.assign(new Error('流水线不存在'), { status: 404 })
  }

  const stage = workflow.stages.find(s => s.stage_id === stageId)
  if (!stage) {
    throw Object.assign(new Error('工序不存在'), { status: 404 })
  }

  if (stage.status === 'completed') {
    const existing = db.prepare(
      `SELECT * FROM stage_completions WHERE workflow_id = ? AND stage_id = ? AND operation_id = ?`
    ).get(workflowId, stage.id, operationId)

    if (existing) {
      return { duplicate: true, completion: existing }
    }
  }

  const completionId = randomBytes(12).toString('hex')
  const completedAt = new Date().toISOString()

  const completion = {
    id: completionId,
    workflowId,
    stageId: stage.id,
    completionType: String(completionData.completion_type ?? 'manual').slice(0, 40),
    description: String(completionData.description ?? '').slice(0, 2000),
    artifacts: completionData.artifacts ?? null,
    completedAt,
    operationId,
  }

  saveStageCompletion(db, completion)

  // 创建待回传事件
  if (workflow.dispatch_id) {
    const eventId = randomBytes(12).toString('hex')
    const event = {
      id: eventId,
      workflowId,
      dispatchId: workflow.dispatch_id,
      eventType: 'stage.completed',
      payload: {
        dispatch_id: workflow.dispatch_id,
        dispatch_revision: workflow.dispatch_revision,
        workflow_id: workflowId,
        stage_id: stageId,
        completion_type: completion.completionType,
        description: completion.description,
        artifacts: completion.artifacts,
        completed_at: completedAt,
        event_id: eventId,
        task_id: workflow.task_id,
        task_revision: workflow.task_revision,
      },
      status: 'pending',
      attempts: 0,
      nextAttemptAt: Date.now(),
      createdAt: completedAt,
    }
    saveOutboundEvent(db, event)
  }

  // 激活下一个工序
  const currentPosition = stage.position
  const nextStage = workflow.stages.find(s => s.position === currentPosition + 1 && s.status === 'pending')
  if (nextStage) {
    updateStageStatus(db, nextStage.id, 'active')
  }

  return { duplicate: false, completion, workflow: getWorkflowById(db, workflowId, accountId) }
}

export function formatWorkflowView(workflow) {
  if (!workflow) return null

  const stages = workflow.stages ?? []
  const currentStage = stages.find(s => s.status === 'active') ?? stages.find(s => s.status === 'pending')

  return {
    id: workflow.id,
    title: workflow.title,
    description: workflow.description,
    source: workflow.source,
    status: workflow.status,
    receivedAt: workflow.received_at ?? workflow.receivedAt,
    startedAt: workflow.started_at ?? workflow.startedAt,
    completedAt: workflow.completed_at ?? workflow.completedAt,
    dispatchId: workflow.dispatch_id ?? workflow.dispatchId,
    taskId: workflow.task_id ?? workflow.taskId,
    currentStage: currentStage ? {
      id: currentStage.stage_id ?? currentStage.stageId,
      module: currentStage.module,
      title: currentStage.title,
      description: currentStage.description,
      position: currentStage.position,
    } : null,
    stages: stages.map(s => ({
      id: s.stage_id ?? s.stageId,
      module: s.module,
      title: s.title,
      description: s.description,
      status: s.status,
      position: s.position,
      completedAt: s.completed_at ?? s.completedAt,
    })),
    progress: {
      total: stages.length,
      completed: stages.filter(s => s.status === 'completed').length,
    },
  }
}
