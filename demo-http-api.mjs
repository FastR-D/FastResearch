#!/usr/bin/env node
/**
 * FastTask 与 FastResearch HTTP API 演示
 * 通过实际的 HTTP 请求展示完整的集成流程
 */

const API_BASE = 'http://127.0.0.1:8787'
const DEMO_ACCOUNT_ID = 'account-demo-http'

// 使用 FASTINSIGHT_INGEST_KEY 绕过 FastCAS 认证
const INGEST_KEY = 'fastinsight-test-key-2026'

function printSection(title) {
  console.log('\n' + '='.repeat(70))
  console.log(`\n${title}\n`)
}

async function apiCall(method, path, body = null) {
  const url = `${API_BASE}${path}`
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'x-fastinsight-key': INGEST_KEY
    }
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(url, options)
  const data = await response.json()

  if (!response.ok) {
    console.error(`❌ API 错误 (${response.status}):`, data)
    throw new Error(`API call failed: ${response.status}`)
  }

  return data
}

async function main() {
  console.log('🚀 FastTask 与 FastResearch HTTP API 演示')
  console.log(`📡 API 地址: ${API_BASE}`)
  console.log(`👤 演示账号: ${DEMO_ACCOUNT_ID}`)

  try {
    // ============================================================
    // 第一步：FastTask 发布任务流水线
    // ============================================================
    printSection('1️⃣  FastTask 发布任务流水线')

    const dispatchPayload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: `dispatch-http-${Date.now()}`,
      dispatch_revision: 1,
      receiver_ref: DEMO_ACCOUNT_ID,
      source_task_id: 'task-http-demo-transformer',
      title: '🔬 AI 论文研究：Transformer 架构深度解析',
      description: '系统性研究 Transformer 模型的核心机制、架构设计和应用场景',
      stages: [
        {
          stage_id: 'stage-read',
          module: 'fast-read',
          title: '📖 精读论文：Attention Is All You Need',
          description: '深入理解自注意力机制、位置编码和多头注意力的设计原理',
          success_criteria: '完成论文精读，标注关键公式和架构图，理解核心创新点',
          completion_target: 'record_progress',
          source_task_id: 'task-http-demo-transformer',
          materials: [
            { type: 'paper_url', content: 'https://arxiv.org/abs/1706.03762' },
            { type: 'paper_id', content: 'arxiv:1706.03762' },
            { type: 'paper_title', content: 'Attention Is All You Need' },
            { type: 'paper_authors', content: 'Vaswani et al.' }
          ]
        },
        {
          stage_id: 'stage-write',
          module: 'fast-write',
          title: '✍️ 撰写技术分析报告',
          description: '总结 Transformer 的创新点、架构设计和在 NLP 领域的影响',
          success_criteria: '完成 3000 字技术分析，包含架构图解、公式推导和代码示例',
          completion_target: 'complete_plan_item',
          source_plan_item_id: 'morning-research'
        },
        {
          stage_id: 'stage-lab',
          module: 'fast-lab',
          title: '💻 实现 Transformer Encoder',
          description: '用 PyTorch 实现简化版 Transformer Encoder，验证架构理解',
          success_criteria: '完成代码实现并通过单元测试，能够正确处理序列输入',
          completion_target: 'deliver_artifact',
          artifact_name: 'transformer_encoder.py'
        }
      ]
    }

    console.log('📤 发布任务流水线：')
    console.log(`   标题: ${dispatchPayload.title}`)
    console.log(`   发布 ID: ${dispatchPayload.dispatch_id}`)
    console.log(`   工序数量: ${dispatchPayload.stages.length}`)

    const publishResult = await apiCall('POST', '/api/workflow/publish', dispatchPayload)

    console.log('\n✅ 发布成功！')
    console.log(`   流水线 ID: ${publishResult.workflow_id}`)
    console.log(`   是否重复: ${publishResult.duplicate}`)
    console.log(`   状态: ${publishResult.status}`)

    const workflowId = publishResult.workflow_id

    // ============================================================
    // 第二步：查询流水线列表
    // ============================================================
    printSection('2️⃣  查询流水线列表')

    const listResult = await apiCall('GET', `/api/workflows?account_id=${DEMO_ACCOUNT_ID}`)

    console.log(`📊 流水线统计：`)
    console.log(`   活跃: ${listResult.active.length}`)
    console.log(`   待开始: ${listResult.queued.length}`)
    console.log(`   已完成: ${listResult.completed.length}`)

    if (listResult.queued.length > 0) {
      console.log('\n⏸️  待开始的流水线：')
      listResult.queued.forEach(wf => {
        console.log(`   - ${wf.title}`)
        console.log(`     ID: ${wf.id}`)
      })
    }

    // ============================================================
    // 第三步：查询流水线详情
    // ============================================================
    printSection('3️⃣  查询流水线详情')

    const detailResult = await apiCall('GET', `/api/workflows/${workflowId}`)

    console.log(`📋 流水线：${detailResult.title}`)
    console.log(`   ID: ${detailResult.id}`)
    console.log(`   状态: ${detailResult.status}`)
    console.log(`   创建时间: ${detailResult.created_at}`)
    console.log(`\n   工序列表：`)
    detailResult.stages.forEach((stage, i) => {
      const icon = stage.status === 'completed' ? '✅' :
                   stage.status === 'active' ? '▶️' : '⏸️'
      console.log(`   ${i + 1}. ${icon} [${stage.module}] ${stage.title}`)
      console.log(`      状态: ${stage.status}`)
      if (stage.materials && stage.materials.length > 0) {
        stage.materials.forEach(m => {
          console.log(`      📎 ${m.type}: ${m.content}`)
        })
      }
    })

    // ============================================================
    // 第四步：启动流水线
    // ============================================================
    printSection('4️⃣  启动流水线')

    console.log(`🚀 启动流水线: ${workflowId}`)
    const startResult = await apiCall('POST', `/api/workflows/${workflowId}/start`)

    console.log('\n✅ 启动成功！')
    console.log(`   流水线 ID: ${startResult.workflow.id}`)
    console.log(`   状态: ${startResult.workflow.status}`)
    console.log(`   当前工序: ${startResult.workflow.stages.find(s => s.status === 'active')?.title}`)

    // ============================================================
    // 第五步：完成第一个工序
    // ============================================================
    printSection('5️⃣  完成工序：精读论文')

    const stage1 = startResult.workflow.stages[0]
    const completion1 = {
      completion_type: 'manual',
      completion_notes: '已完成论文精读，深入理解了 Transformer 的核心机制',
      artifacts: [
        {
          artifact_type: 'reading_notes',
          artifact_ref: 'notes/transformer-attention.md',
          artifact_title: 'Transformer 自注意力机制笔记'
        },
        {
          artifact_type: 'annotations',
          artifact_ref: 'annotations/arxiv-1706.03762',
          artifact_title: '论文标注和公式推导'
        }
      ]
    }

    console.log(`📝 完成工序: ${stage1.title}`)
    const complete1Result = await apiCall(
      'POST',
      `/api/workflows/${workflowId}/stages/${stage1.id}/complete`,
      completion1
    )

    console.log('\n✅ 工序完成！')
    console.log(`   完成 ID: ${complete1Result.completion_id}`)
    console.log(`   流水线状态: ${complete1Result.workflow.status}`)
    console.log(`   下一个工序: ${complete1Result.workflow.stages.find(s => s.status === 'active')?.title}`)

    // ============================================================
    // 第六步：完成第二个工序
    // ============================================================
    printSection('6️⃣  完成工序：撰写分析报告')

    const stage2 = complete1Result.workflow.stages[1]
    const completion2 = {
      completion_type: 'manual',
      completion_notes: '完成 3500 字技术分析报告，深入剖析 Transformer 架构',
      artifacts: [
        {
          artifact_type: 'document',
          artifact_ref: 'reports/transformer-analysis.md',
          artifact_title: 'Transformer 架构技术分析'
        },
        {
          artifact_type: 'diagram',
          artifact_ref: 'diagrams/transformer-architecture.svg',
          artifact_title: 'Transformer 架构图解'
        }
      ]
    }

    console.log(`📝 完成工序: ${stage2.title}`)
    const complete2Result = await apiCall(
      'POST',
      `/api/workflows/${workflowId}/stages/${stage2.id}/complete`,
      completion2
    )

    console.log('\n✅ 工序完成！')
    console.log(`   流水线状态: ${complete2Result.workflow.status}`)
    console.log(`   下一个工序: ${complete2Result.workflow.stages.find(s => s.status === 'active')?.title}`)

    // ============================================================
    // 第七步：完成第三个工序
    // ============================================================
    printSection('7️⃣  完成工序：实现代码示例')

    const stage3 = complete2Result.workflow.stages[2]
    const completion3 = {
      completion_type: 'manual',
      completion_notes: '实现了简化版 Transformer Encoder，所有测试通过',
      artifacts: [
        {
          artifact_type: 'code',
          artifact_ref: 'code/transformer_encoder.py',
          artifact_title: 'Transformer Encoder 实现'
        },
        {
          artifact_type: 'test_report',
          artifact_ref: 'tests/transformer_encoder_test_report.txt',
          artifact_title: '单元测试报告'
        }
      ]
    }

    console.log(`📝 完成工序: ${stage3.title}`)
    const complete3Result = await apiCall(
      'POST',
      `/api/workflows/${workflowId}/stages/${stage3.id}/complete`,
      completion3
    )

    console.log('\n🎉 所有工序完成！')
    console.log(`   流水线状态: ${complete3Result.workflow.status}`)
    console.log(`   完成时间: ${complete3Result.workflow.completed_at}`)

    // ============================================================
    // 第八步：测试幂等性
    // ============================================================
    printSection('8️⃣  测试幂等性')

    console.log('🔄 尝试重复发布相同内容...')
    const duplicateResult = await apiCall('POST', '/api/workflow/publish', dispatchPayload)

    console.log('\n✅ 幂等验证：')
    console.log(`   是否识别为重复: ${duplicateResult.duplicate}`)
    console.log(`   返回相同流水线 ID: ${duplicateResult.workflow_id === workflowId}`)
    console.log(`   流水线 ID: ${duplicateResult.workflow_id}`)

    // ============================================================
    // 第九步：查询最终状态
    // ============================================================
    printSection('9️⃣  查询最终状态')

    const finalList = await apiCall('GET', `/api/workflows?account_id=${DEMO_ACCOUNT_ID}`)

    console.log('📊 最终统计：')
    console.log(`   活跃: ${finalList.active.length}`)
    console.log(`   待开始: ${finalList.queued.length}`)
    console.log(`   已完成: ${finalList.completed.length}`)

    if (finalList.completed.length > 0) {
      console.log('\n✅ 已完成的流水线：')
      finalList.completed.forEach(wf => {
        console.log(`   - ${wf.title}`)
        console.log(`     完成时间: ${wf.completed_at}`)
      })
    }

    // ============================================================
    // 总结
    // ============================================================
    printSection('✨ 演示完成')

    console.log('本次演示展示了：')
    console.log('  ✅ FastTask 通过 HTTP API 发布任务流水线')
    console.log('  ✅ FastResearch 幂等接收和去重')
    console.log('  ✅ 查询流水线列表（按状态分类）')
    console.log('  ✅ 查询流水线详情（包含工序和材料）')
    console.log('  ✅ 启动流水线（单活跃约束）')
    console.log('  ✅ 完成工序并自动激活下一个')
    console.log('  ✅ 流水线完成（所有工序完成）')
    console.log('  ✅ 幂等性验证')
    console.log('  ✅ 产物记录和追溯')
    console.log('')
    console.log('💾 数据已保存到 SQLite 数据库')
    console.log('')
    console.log('📖 详细文档：')
    console.log('   - API 参考: docs/api.md')
    console.log('   - 使用示例: docs/fasttask-integration-example.md')
    console.log('   - 完成报告: docs/COMPLETION_REPORT.md')

  } catch (error) {
    console.error('\n❌ 演示失败:', error.message)
    process.exit(1)
  }
}

main()
