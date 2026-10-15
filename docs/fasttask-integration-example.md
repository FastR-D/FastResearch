# FastTask 集成使用示例

本文档展示 FastTask 如何向 FastResearch 发布任务流水线，以及如何接收和处理工序完成事件。

## 0. FastResearch Key 生成 FastTask 任务

登录 FastResearch 的成员 Key 会绑定一个 FastTask 用户。登录后的 FastResearch
前端或服务端调用代理接口即可创建目标和任务，FastResearch 会使用该账号对应的
Pair Key 转发请求，调用方不能在请求体中指定其他用户。

**接口**: `POST /api/fasttask/tasks`

**认证**: FastResearch 成员会话（Cookie 或 `Authorization: Bearer <session>`）。

**请求体**:

```json
{
  "goal": {
    "title": "Transformer 论文研究",
    "description": "建立阅读、实验和写作任务",
    "success_criteria": "形成可复用的研究结论"
  },
  "tasks": [
    {
      "title": "精读论文",
      "description": "记录核心机制和证据",
      "success_criteria": "完成论文精读摘要",
      "minimum_action": "打开论文并记录第一条结论",
      "estimate_minutes": 30,
      "priority": 80,
      "type": "task",
      "position": 0
    }
  ]
}
```

也可以使用已有 `goal_id`，此时不传 `goal`。如果不传目标，FastTask 会自动创建
“FastResearch 任务”目标；`success_criteria` 和 `minimum_action` 缺省时会按任务标题生成默认值。

FastTask 的底层入口为 `POST /api/v1/integrations/fastresearch/tasks`，使用
`X-API-Key` 头。每个绑定配置一项 `FASTTASK_FASTRESEARCH_BINDINGS`，其中
`api_key` 与 FastResearch 的成员 Key 对应，`user_id` 指向唯一 FastTask 用户。

## 1. 从 FastTask 发布任务

### 1.1 发布请求

**接口**: `POST https://fastresearch.example.com/api/workflow/publish`

**认证**: 使用 FastCAS 服务令牌，需要 `workflow:publish` 权限。

**请求体**:

```json
{
  "schema_version": "fasttask-dispatch-v1",
  "dispatch_id": "dispatch-20260925-001",
  "dispatch_revision": 1,
  "receiver_ref": "account-abc123",
  "title": "阅读与分析 Transformer 论文",
  "description": "深度阅读 Attention Is All You Need 并撰写技术分析报告",
  "task_id": "task-2026-09-25-001",
  "task_revision": 3,
  "goal_id": "goal-q3-research",
  "plan_id": "daily-plan-20260925",
  "plan_item_id": "plan-item-morning-reading",
  "stages": [
    {
      "stage_id": "stage-reading",
      "module": "fast-read",
      "title": "精读论文",
      "description": "阅读 Attention Is All You Need 全文，理解 Transformer 架构",
      "success_criteria": "完成论文精读，标注关键机制，理解自注意力原理",
      "completion_target": "record_progress",
      "source_task_id": "task-2026-09-25-001",
      "materials": [
        {
          "type": "paper_url",
          "content": "https://arxiv.org/abs/1706.03762"
        },
        {
          "type": "paper_id",
          "content": "arxiv:1706.03762"
        }
      ]
    },
    {
      "stage_id": "stage-analysis",
      "module": "fast-write",
      "title": "撰写分析报告",
      "description": "总结 Transformer 的创新点和应用场景",
      "success_criteria": "完成 1500 字技术分析，包含架构图和代码示例",
      "completion_target": "complete_plan_item",
      "source_plan_item_id": "plan-item-morning-reading"
    },
    {
      "stage_id": "stage-experiment",
      "module": "fast-news",
      "title": "复现关键实验",
      "description": "使用 PyTorch 实现简化版 Transformer encoder",
      "success_criteria": "代码可运行，输出与论文一致"
    }
  ]
}
```

**成功响应** (201 Created):

```json
{
  "ok": true,
  "duplicate": false,
  "receipt": {
    "dispatch_id": "dispatch-20260925-001",
    "dispatch_revision": 1,
    "workflow_id": "wf-a1b2c3d4e5f6",
    "received_at": "2026-09-25T10:30:00.000Z",
    "status": "queued"
  }
}
```

**幂等响应** (200 OK):

```json
{
  "ok": true,
  "duplicate": true,
  "receipt": {
    "dispatch_id": "dispatch-20260925-001",
    "dispatch_revision": 1,
    "workflow_id": "wf-a1b2c3d4e5f6",
    "received_at": "2026-09-25T10:30:00.000Z",
    "status": "active"
  }
}
```

### 1.2 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| `schema_version` | 是 | 协议版本，当前为 `fasttask-dispatch-v1` |
| `dispatch_id` | 是 | 发布唯一标识，最多 120 字符 |
| `dispatch_revision` | 是 | 发布版本号，修改内容时递增 |
| `receiver_ref` | 是 | FastResearch 账号 ID |
| `title` | 是 | 流水线标题，最多 200 字符 |
| `description` | 否 | 流水线说明，最多 2000 字符 |
| `task_id` | 否 | 来源任务 ID，用于追溯 |
| `task_revision` | 否 | 来源任务版本 |
| `goal_id` | 否 | 关联目标 ID |
| `plan_id` | 否 | 每日计划 ID |
| `plan_item_id` | 否 | 计划项 ID |
| `stages` | 是 | 工序列表，1-50 个工序 |

#### 工序字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `stage_id` | 是 | 工序唯一标识，在同一发布内保持稳定 |
| `module` | 是 | 执行模块：`fast-read` / `fast-write` / `fast-news` |
| `title` | 是 | 工序标题，最多 300 字符 |
| `description` | 否 | 工序说明，最多 1200 字符 |
| `success_criteria` | 否 | 验收标准，用于界面提示 |
| `completion_target` | 否 | 完成目标：`record_progress`（仅记录）/ `complete_plan_item`（完成计划项） |
| `source_task_id` | 否 | 来源任务，用于关联 |
| `source_plan_item_id` | 否 | 来源计划项，用于完成映射 |
| `materials` | 否 | 输入材料列表，每个材料包含 `type` 和 `content` |

## 2. FastResearch 用户执行流程

### 2.1 查询流水线列表

**接口**: `GET /api/workflows`

**认证**: 成员会话 Cookie 或 Bearer Token

**响应**:

```json
{
  "active": [
    {
      "id": "wf-active-001",
      "title": "正在进行的研究",
      "status": "active",
      "currentStage": {
        "id": "stage-2",
        "module": "fast-write",
        "title": "撰写报告",
        "position": 1
      },
      "progress": {
        "total": 3,
        "completed": 1
      }
    }
  ],
  "queued": [
    {
      "id": "wf-queued-001",
      "title": "待开始的任务",
      "status": "queued",
      "receivedAt": "2026-09-25T11:00:00.000Z"
    }
  ],
  "completed": [
    {
      "id": "wf-completed-001",
      "title": "已完成的研究",
      "status": "completed",
      "completedAt": "2026-09-24T18:30:00.000Z"
    }
  ]
}
```

### 2.2 启动流水线

**接口**: `POST /api/workflows/{workflow_id}/start`

**响应**:

```json
{
  "workflow": {
    "id": "wf-a1b2c3d4e5f6",
    "title": "阅读与分析 Transformer 论文",
    "status": "active",
    "currentStage": {
      "id": "stage-reading",
      "module": "fast-read",
      "title": "精读论文",
      "position": 0
    },
    "stages": [
      {
        "id": "stage-reading",
        "module": "fast-read",
        "title": "精读论文",
        "status": "active",
        "position": 0
      },
      {
        "id": "stage-analysis",
        "module": "fast-write",
        "title": "撰写分析报告",
        "status": "pending",
        "position": 1
      }
    ]
  },
  "alreadyActive": false
}
```

### 2.3 完成工序

**接口**: `POST /api/workflows/{workflow_id}/stages/{stage_id}/complete`

**请求体**:

```json
{
  "operation_id": "op-user-20260925-143022",
  "completion_type": "manual",
  "description": "已完成论文精读，标注了关键公式和架构图",
  "artifacts": [
    {
      "type": "reading_note",
      "url": "/fast-read/notes/transformer-analysis.md",
      "title": "Transformer 架构笔记"
    },
    {
      "type": "annotation",
      "count": 23,
      "highlights": 15
    }
  ]
}
```

**响应**:

```json
{
  "ok": true,
  "duplicate": false,
  "completion": {
    "id": "completion-xyz789",
    "workflowId": "wf-a1b2c3d4e5f6",
    "stageId": "internal-stage-id",
    "completionType": "manual",
    "completedAt": "2026-09-25T14:30:22.000Z"
  },
  "workflow": {
    "id": "wf-a1b2c3d4e5f6",
    "status": "active",
    "currentStage": {
      "id": "stage-analysis",
      "module": "fast-write",
      "title": "撰写分析报告",
      "position": 1
    },
    "progress": {
      "total": 3,
      "completed": 1
    }
  }
}
```

## 3. FastTask 接收完成事件

### 3.1 工序完成通知

**接口**: `POST https://fasttask.example.com/api/v1/research-dispatches/{dispatch_id}/events`

**认证**: FastResearch 服务令牌，需要 `dispatch:events:write` 权限

**请求体**:

```json
{
  "event_id": "event-20260925-143022-001",
  "event_type": "stage.completed",
  "dispatch_id": "dispatch-20260925-001",
  "dispatch_revision": 1,
  "workflow_id": "wf-a1b2c3d4e5f6",
  "stage_id": "stage-reading",
  "task_id": "task-2026-09-25-001",
  "task_revision": 3,
  "completion_type": "manual",
  "description": "已完成论文精读，标注了关键公式和架构图",
  "artifacts": [
    {
      "type": "reading_note",
      "url": "/fast-read/notes/transformer-analysis.md",
      "title": "Transformer 架构笔记"
    }
  ],
  "completed_at": "2026-09-25T14:30:22.000Z"
}
```

**成功响应** (200 OK):

```json
{
  "ok": true,
  "recorded": true,
  "plan_item_status": "in_progress",
  "task_status": "in_progress"
}
```

**幂等响应** (200 OK):

```json
{
  "ok": true,
  "recorded": false,
  "duplicate": true
}
```

## 4. 错误处理

### 4.1 常见错误

| 状态码 | 错误 | 说明 |
|--------|------|------|
| 400 | 协议版本不支持 | `schema_version` 不是 `fasttask-dispatch-v1` |
| 400 | 工序列表无效 | stages 为空或包含无效模块 |
| 403 | 接收账号不匹配 | `receiver_ref` 与实际账号不符 |
| 404 | 接收账号未找到 | 账号映射不存在或无权限 |
| 409 | 发布版本过旧 | `dispatch_revision` 小于已接收版本 |
| 409 | 已有活跃流水线 | 尝试启动第二个流水线 |
| 404 | 流水线不存在 | `workflow_id` 无效或已删除 |
| 404 | 工序不存在 | `stage_id` 无效 |

### 4.2 重试策略

- **网络超时**: 使用相同 `dispatch_id` 和 `dispatch_revision` 重试，FastResearch 会返回已有回执
- **版本冲突**: 检查最新状态，决定是否发布新版本（递增 `dispatch_revision`）
- **完成事件重试**: 使用相同 `event_id` 重试，FastTask 会识别重复事件

## 5. 完整示例流程

```javascript
// 1. FastTask 发布任务
const publishResponse = await fetch('https://fastresearch.example.com/api/workflow/publish', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer <fastcas-service-token>',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: 'dispatch-001',
    dispatch_revision: 1,
    receiver_ref: 'account-123',
    title: '研究任务',
    stages: [
      { stage_id: 'stage-1', module: 'fast-read', title: '阅读' },
      { stage_id: 'stage-2', module: 'fast-write', title: '撰写' }
    ]
  })
})

const { receipt } = await publishResponse.json()
console.log('已发布，工作流 ID:', receipt.workflow_id)

// 2. 用户在 FastResearch 查询
const listResponse = await fetch('https://fastresearch.example.com/api/workflows', {
  headers: { 'Cookie': 'fr_session=...' }
})
const { queued } = await listResponse.json()

// 3. 用户启动流水线
const startResponse = await fetch(`https://fastresearch.example.com/api/workflows/${receipt.workflow_id}/start`, {
  method: 'POST',
  headers: { 'Cookie': 'fr_session=...' }
})
const { workflow } = await startResponse.json()
console.log('当前工序:', workflow.currentStage.title)

// 4. 用户完成工序
const completeResponse = await fetch(
  `https://fastresearch.example.com/api/workflows/${receipt.workflow_id}/stages/stage-1/complete`,
  {
    method: 'POST',
    headers: {
      'Cookie': 'fr_session=...',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      operation_id: `op-${Date.now()}`,
      completion_type: 'manual',
      description: '已完成阅读',
      artifacts: [{ type: 'note', url: '/notes/1.md' }]
    })
  }
)

// 5. FastResearch 后台投递事件到 FastTask
// （由 FastResearch 服务器自动执行）
```

## 6. 下一步

当前实现覆盖第一阶段（接收闭环）和第二阶段（完成闭环）的基础功能。后续阶段：

- **第三阶段**: 工作上下文传递 - 从工序直接打开论文、写作项目、实验环境
- **第四阶段**: 自动执行支持 - 适配具备 API 的模块，支持后台自动执行
- **对账与补偿**: 定期对账，处理网络中断期间的事件
- **撤回与修订**: 支持发布方撤回或修改正在执行的流水线
