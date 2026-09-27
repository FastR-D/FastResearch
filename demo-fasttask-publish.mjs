/**
 * FastTask 发布任务流水线到 FastResearch 的演示脚本
 *
 * 模拟 FastTask 向 FastResearch 发布一个研究任务流水线
 */

const BASE_URL = 'http://127.0.0.1:8787'

// 模拟 FastCAS 服务令牌（实际环境需要真实令牌）
const MOCK_SERVICE_TOKEN = 'mock-fastcas-service-token-for-demo'

async function publishWorkflow() {
  console.log('🚀 FastTask 发布任务流水线演示\n')
  console.log('=' .repeat(60))

  // 构造发布载荷
  const payload = {
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: `dispatch-demo-${Date.now()}`,
    dispatch_revision: 1,
    receiver_ref: 'demo-account-001',
    title: '深度学习论文研究：Transformer 架构分析',
    description: '阅读经典论文 Attention Is All You Need，理解 Transformer 架构，并撰写技术分析报告',
    task_id: 'task-20260925-transformer',
    task_revision: 1,
    goal_id: 'goal-q3-nlp-research',
    plan_id: 'daily-plan-20260925',
    plan_item_id: 'morning-research',
    stages: [
      {
        stage_id: 'stage-read-paper',
        module: 'fast-read',
        title: '精读论文：Attention Is All You Need',
        description: '深度阅读论文全文，理解 Transformer 架构的核心创新点',
        success_criteria: '完成论文精读，标注关键公式和架构图，理解自注意力机制',
        completion_target: 'record_progress',
        source_task_id: 'task-20260925-transformer',
        materials: [
          {
            type: 'paper_url',
            content: 'https://arxiv.org/abs/1706.03762'
          },
          {
            type: 'paper_id',
            content: 'arxiv:1706.03762'
          },
          {
            type: 'paper_title',
            content: 'Attention Is All You Need'
          }
        ]
      },
      {
        stage_id: 'stage-write-analysis',
        module: 'fast-write',
        title: '撰写技术分析报告',
        description: '总结 Transformer 的创新点、架构设计和应用场景',
        success_criteria: '完成 2000 字技术分析，包含架构图解和关键代码示例',
        completion_target: 'complete_plan_item',
        source_plan_item_id: 'morning-research',
        materials: [
          {
            type: 'reference',
            content: '参考阅读笔记和论文标注'
          }
        ]
      },
      {
        stage_id: 'stage-code-demo',
        module: 'fast-lab',
        title: '实现简化版 Transformer',
        description: '使用 PyTorch 实现一个简化的 Transformer encoder',
        success_criteria: '代码可运行，输出与论文描述一致',
        materials: [
          {
            type: 'code_template',
            content: 'https://github.com/pytorch/examples/tree/main/transformer'
          }
        ]
      }
    ]
  }

  console.log('\n📋 发布内容：')
  console.log(`  标题: ${payload.title}`)
  console.log(`  发布 ID: ${payload.dispatch_id}`)
  console.log(`  接收账号: ${payload.receiver_ref}`)
  console.log(`  工序数量: ${payload.stages.length}`)
  payload.stages.forEach((stage, i) => {
    console.log(`    ${i + 1}. [${stage.module}] ${stage.title}`)
  })

  console.log('\n📤 发送发布请求...')

  try {
    const response = await fetch(`${BASE_URL}/api/workflow/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MOCK_SERVICE_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const result = await response.json()

    if (response.ok) {
      console.log('\n✅ 发布成功！')
      console.log('\n📥 接收回执：')
      console.log(`  流水线 ID: ${result.receipt.workflow_id}`)
      console.log(`  发布 ID: ${result.receipt.dispatch_id}`)
      console.log(`  发布版本: ${result.receipt.dispatch_revision}`)
      console.log(`  接收时间: ${result.receipt.received_at}`)
      console.log(`  状态: ${result.receipt.status}`)
      console.log(`  是否重复: ${result.duplicate}`)

      if (result.workflow) {
        console.log('\n🔄 流水线详情：')
        console.log(`  ID: ${result.workflow.id}`)
        console.log(`  标题: ${result.workflow.title}`)
        console.log(`  状态: ${result.workflow.status}`)
        console.log(`  工序:`)
        result.workflow.stages.forEach(stage => {
          const statusIcon = stage.status === 'pending' ? '⏸️' :
                           stage.status === 'active' ? '▶️' :
                           stage.status === 'completed' ? '✅' : '❓'
          console.log(`    ${statusIcon} [${stage.module}] ${stage.title} (${stage.status})`)
        })
      }

      // 返回流水线 ID 供后续操作使用
      return result.receipt.workflow_id
    } else {
      console.error('\n❌ 发布失败：')
      console.error(`  状态码: ${response.status}`)
      console.error(`  错误: ${JSON.stringify(result, null, 2)}`)
      return null
    }
  } catch (error) {
    console.error('\n❌ 请求异常：')
    console.error(`  ${error.message}`)
    if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 请确保 FastResearch 服务已启动：npm run server')
    }
    return null
  }
}

async function queryWorkflows() {
  console.log('\n' + '='.repeat(60))
  console.log('\n📊 查询流水线列表（需要成员认证，演示将失败）\n')

  try {
    const response = await fetch(`${BASE_URL}/api/workflows`)
    const result = await response.json()

    if (response.ok) {
      console.log('✅ 查询成功：')
      console.log(JSON.stringify(result, null, 2))
    } else {
      console.log(`⚠️  预期失败（需要成员认证）：${response.status}`)
      console.log(`   这是正常的 - 实际使用时需要通过密钥登录或 SSO 认证`)
    }
  } catch (error) {
    console.error('❌ 查询失败：', error.message)
  }
}

async function demonstrateIdempotency(workflowId) {
  if (!workflowId) return

  console.log('\n' + '='.repeat(60))
  console.log('\n🔁 演示幂等性：重复发布相同内容\n')

  const payload = {
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: 'dispatch-demo-idempotent',
    dispatch_revision: 1,
    receiver_ref: 'demo-account-001',
    title: '幂等测试任务',
    stages: [
      {
        stage_id: 'stage-1',
        module: 'fast-read',
        title: '测试工序'
      }
    ]
  }

  console.log('第一次发布...')
  const response1 = await fetch(`${BASE_URL}/api/workflow/publish`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const result1 = await response1.json()
  console.log(`  结果: duplicate=${result1.duplicate}, workflow_id=${result1.receipt.workflow_id}`)

  console.log('\n第二次发布（相同内容）...')
  const response2 = await fetch(`${BASE_URL}/api/workflow/publish`, {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer mock-token',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  })
  const result2 = await response2.json()
  console.log(`  结果: duplicate=${result2.duplicate}, workflow_id=${result2.receipt.workflow_id}`)

  if (result1.receipt.workflow_id === result2.receipt.workflow_id && result2.duplicate) {
    console.log('\n✅ 幂等性验证通过：相同发布返回相同回执')
  } else {
    console.log('\n⚠️  幂等性验证失败')
  }
}

async function main() {
  const workflowId = await publishWorkflow()
  await queryWorkflows()
  await demonstrateIdempotency(workflowId)

  console.log('\n' + '='.repeat(60))
  console.log('\n✨ 演示完成！')
  console.log('\n💡 后续操作：')
  console.log('  1. 使用密钥登录或 SSO 认证成为成员')
  console.log('  2. GET /api/workflows - 查询流水线列表')
  console.log('  3. POST /api/workflows/{id}/start - 启动流水线')
  console.log('  4. POST /api/workflows/{id}/stages/{stage_id}/complete - 完成工序')
  console.log('\n📖 详细文档：docs/fasttask-integration-example.md\n')
}

main().catch(console.error)
