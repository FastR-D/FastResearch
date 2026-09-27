import http from 'node:http'

// ============================================================
// 配置
// ============================================================
const FASTTASK_API = 'http://127.0.0.1:10000'
const FASTRESEARCH_API = 'http://127.0.0.1:8787'
const FASTRESEARCH_INGEST_KEY = 'fastinsight-test-key-2026'

// FastTask 管理员凭证（默认本地开发账号）
const FASTTASK_ADMIN = {
  username: 'admin',
  password: 'fasttask-admin'
}

// ============================================================
// HTTP 工具函数
// ============================================================
function request(baseUrl, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl)
    const payload = body ? JSON.stringify(body) : null

    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      }
    }

    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload)
    }

    const req = http.request(url, options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        const result = {
          status: res.statusCode,
          headers: res.headers,
          body: data ? JSON.parse(data) : null
        }
        if (res.statusCode >= 400) {
          reject(Object.assign(new Error(`HTTP ${res.statusCode}`), result))
        } else {
          resolve(result)
        }
      })
    })

    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

// ============================================================
// FastTask API 调用
// ============================================================
async function fastTaskLogin() {
  console.log('🔐 登录 FastTask...')
  const response = await request(FASTTASK_API, 'POST', '/api/v1/auth/login', {
    username: FASTTASK_ADMIN.username,
    password: FASTTASK_ADMIN.password
  })
  console.log(`✅ 登录成功，用户: ${response.body.username}`)
  return response.body.access_token
}

async function fastTaskCreateGoal(token, title, description) {
  console.log(`\n📌 创建目标: ${title}`)
  const response = await request(FASTTASK_API, 'POST', '/api/v1/goals', {
    title,
    description,
    status: 'active'
  }, {
    'Authorization': `Bearer ${token}`
  })
  console.log(`✅ 目标创建成功，ID: ${response.body.id}`)
  return response.body
}

async function fastTaskCreateTask(token, goalId, title, description) {
  console.log(`\n📋 创建任务: ${title}`)
  const response = await request(FASTTASK_API, 'POST', '/api/v1/tasks', {
    goal_id: goalId,
    title,
    description,
    status: 'active',
    task_type: 'manual'
  }, {
    'Authorization': `Bearer ${token}`
  })
  console.log(`✅ 任务创建成功，ID: ${response.body.id}`)
  return response.body
}

async function fastTaskListTasks(token) {
  console.log('\n📋 查询任务列表...')
  const response = await request(FASTTASK_API, 'GET', '/api/v1/tasks?status=active', null, {
    'Authorization': `Bearer ${token}`
  })
  console.log(`✅ 找到 ${response.body.items?.length || 0} 个活跃任务`)
  return response.body.items || []
}

// ============================================================
// FastResearch API 调用
// ============================================================
async function fastResearchPublish(dispatch) {
  const response = await request(FASTRESEARCH_API, 'POST', '/api/workflow/publish', dispatch, {
    'x-fastinsight-key': FASTRESEARCH_INGEST_KEY
  })
  return response.body
}

// ============================================================
// 集成逻辑：从 FastTask 任务转换为 FastResearch 工作流
// ============================================================
function taskToWorkflowDispatch(task, accountId) {
  return {
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: `fasttask-${task.id}-${Date.now()}`,
    dispatch_revision: task.revision || 1,
    receiver_ref: accountId,
    title: task.title,
    description: task.description || '',
    goal_id: task.goal_id,
    task_id: task.id,
    task_revision: task.revision || 1,
    stages: [
      {
        stage_id: 'stage-read',
        module: 'fast-read',
        position: 1,
        title: '📖 研究文献和资料',
        description: '收集和阅读相关论文、文档'
      },
      {
        stage_id: 'stage-lab',
        module: 'fast-lab',
        position: 2,
        title: '⚗️ 实验和验证',
        description: '进行实验、测试和数据分析'
      },
      {
        stage_id: 'stage-write',
        module: 'fast-write',
        position: 3,
        title: '✍️ 撰写报告',
        description: '整理成果，撰写技术文档'
      }
    ],
    materials: []
  }
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('🚀 FastTask ↔ FastResearch 端到端集成测试')
  console.log('=' .repeat(70))

  try {
    // 步骤 1: 登录 FastTask
    const token = await fastTaskLogin()

    // 步骤 2: 创建目标
    const goal = await fastTaskCreateGoal(
      token,
      '🎯 2026 Q1 AI 研究目标',
      '深入研究深度学习前沿技术，掌握 Transformer 架构和大语言模型'
    )

    // 步骤 3: 创建任务
    const task1 = await fastTaskCreateTask(
      token,
      goal.id,
      '🧠 研究 Transformer 架构',
      '系统性学习 Transformer 的理论基础、实现细节和应用场景'
    )

    const task2 = await fastTaskCreateTask(
      token,
      goal.id,
      '🤖 研究大语言模型微调技术',
      '学习 LoRA、PEFT 等参数高效微调方法'
    )

    // 步骤 4: 查询任务列表
    const tasks = await fastTaskListTasks(token)

    console.log('\n' + '='.repeat(70))
    console.log('📤 发布任务到 FastResearch')
    console.log('=' .repeat(70))

    // 步骤 5: 将任务发布到 FastResearch
    const accountId = 'researcher-alice'
    const publishedWorkflows = []

    for (const task of tasks.slice(0, 2)) {
      console.log(`\n📋 发布任务: ${task.title}`)
      const dispatch = taskToWorkflowDispatch(task, accountId)

      try {
        const result = await fastResearchPublish(dispatch)
        console.log(`✅ 发布成功！`)
        console.log(`   Workflow ID: ${result.receipt?.workflow_id}`)
        console.log(`   状态: ${result.receipt?.status}`)
        console.log(`   是否重复: ${result.duplicate}`)
        publishedWorkflows.push({
          task,
          workflowId: result.receipt?.workflow_id,
          dispatchId: dispatch.dispatch_id
        })
      } catch (error) {
        console.log(`❌ 发布失败: ${error.message}`)
      }
    }

    // 总结
    console.log('\n' + '='.repeat(70))
    console.log('✨ 集成测试完成')
    console.log('=' .repeat(70))
    console.log(`\n📊 统计:`)
    console.log(`   FastTask 目标: 1 个`)
    console.log(`   FastTask 任务: ${tasks.length} 个`)
    console.log(`   发布到 FastResearch: ${publishedWorkflows.length} 个`)

    console.log(`\n🔗 已建立的集成链接:`)
    for (const item of publishedWorkflows) {
      console.log(`   • ${item.task.title}`)
      console.log(`     FastTask Task ID: ${item.task.id}`)
      console.log(`     FastResearch Workflow ID: ${item.workflowId}`)
      console.log(`     Dispatch ID: ${item.dispatchId}`)
    }

    console.log(`\n📍 后续步骤:`)
    console.log(`   1. 在 FastTask 中查看任务: http://127.0.0.1:10000`)
    console.log(`   2. 在 FastResearch 中查看工作流: http://127.0.0.1:5173`)
    console.log(`   3. 使用成员账号登录 FastResearch 开始执行工作流`)
    console.log(`   4. 完成工序后，结果会同步回 FastTask（待实现）`)

  } catch (error) {
    console.error('\n❌ 集成测试失败:')
    console.error(error)
    if (error.body) {
      console.error('响应内容:', error.body)
    }
  }
}

main().catch(console.error)
