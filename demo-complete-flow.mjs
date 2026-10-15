/**
 * FastTask 集成完整演示脚本
 *
 * 此脚本展示完整的工作流程：
 * 1. 模拟 FastTask 发布任务（需要配置 FASTINSIGHT_INGEST_KEY）
 * 2. 直接调用存储层 API 演示功能
 */

import { openWorkflowStore, getWorkflowsByAccount, getWorkflowById } from './server/workflow-store.mjs'
import { receiveDispatch, startWorkflow, completeStage, formatWorkflowView } from './server/fasttask-dispatch.mjs'

const DEMO_ACCOUNT_ID = 'demo-account-001'

function printSection(title) {
  console.log('\n' + '='.repeat(70))
  console.log(`\n${title}\n`)
}

function printWorkflow(workflow) {
  console.log(`📋 流水线：${workflow.title}`)
  console.log(`   ID: ${workflow.id}`)
  console.log(`   状态: ${workflow.status}`)
  console.log(`   来源任务: ${workflow.taskId || '无'}`)
  console.log(`   工序数量: ${workflow.stages.length}`)

  workflow.stages.forEach((stage, i) => {
    const statusIcon = stage.status === 'pending' ? '⏸️' :
                       stage.status === 'active' ? '▶️' :
                       stage.status === 'completed' ? '✅' : '❓'
    console.log(`   ${i + 1}. ${statusIcon} [${stage.module}] ${stage.title} (${stage.status})`)
    if (stage.materials && stage.materials.length > 0) {
      stage.materials.forEach(m => {
        console.log(`      📎 ${m.type}: ${m.content.substring(0, 60)}${m.content.length > 60 ? '...' : ''}`)
      })
    }
  })
}

async function demo() {
  console.log('🚀 FastTask 与 FastResearch 集成演示')
  console.log('使用本地 SQLite 存储直接演示功能')

  // 打开工作流数据库
  const db = openWorkflowStore('./data/workflows-demo.sqlite')

  try {
    // ============================================================
    // 第一步：接收 FastTask 发布
    // ============================================================
    printSection('1️⃣  FastTask 发布任务流水线')

    const dispatchPayload = {
      schema_version: 'fasttask-dispatch-v1',
      dispatch_id: `dispatch-demo-${Date.now()}`,
      dispatch_revision: 1,
      receiver_ref: DEMO_ACCOUNT_ID,
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
            { type: 'paper_url', content: 'https://arxiv.org/abs/1706.03762' },
            { type: 'paper_id', content: 'arxiv:1706.03762' },
            { type: 'paper_title', content: 'Attention Is All You Need' }
          ]
        },
        {
          stage_id: 'stage-write-analysis',
          module: 'fast-write',
          title: '撰写技术分析报告',
          description: '总结 Transformer 的创新点、架构设计和应用场景',
          success_criteria: '完成 2000 字技术分析，包含架构图解和关键代码示例',
          completion_target: 'complete_plan_item',
          source_plan_item_id: 'morning-research'
        },
        {
          stage_id: 'stage-code-demo',
          module: 'fast-news',
          title: '实现简化版 Transformer Encoder',
          description: '使用 PyTorch 实现一个简化的 Transformer encoder',
          success_criteria: '代码可运行，输出与论文描述一致'
        }
      ]
    }

    console.log('📤 发布内容：')
    console.log(`   标题: ${dispatchPayload.title}`)
    console.log(`   发布 ID: ${dispatchPayload.dispatch_id}`)
    console.log(`   工序数量: ${dispatchPayload.stages.length}`)

    const receiveResult = receiveDispatch(db, dispatchPayload, DEMO_ACCOUNT_ID)

    console.log('\n✅ 接收成功！')
    console.log(`   流水线 ID: ${receiveResult.receipt.workflow_id}`)
    console.log(`   是否重复: ${receiveResult.duplicate}`)
    console.log(`   状态: ${receiveResult.workflow.status}`)

    const workflowId = receiveResult.receipt.workflow_id

    // ============================================================
    // 第二步：查询流水线列表
    // ============================================================
    printSection('2️⃣  查询流水线列表')

    const activeWorkflows = getWorkflowsByAccount(db, DEMO_ACCOUNT_ID, 'active')
    const queuedWorkflows = getWorkflowsByAccount(db, DEMO_ACCOUNT_ID, 'queued')
    const completedWorkflows = getWorkflowsByAccount(db, DEMO_ACCOUNT_ID, 'completed')

    console.log(`找到 ${activeWorkflows.length} 个活跃流水线`)
    console.log(`找到 ${queuedWorkflows.length} 个待开始流水线`)
    console.log(`找到 ${completedWorkflows.length} 个已完成流水线`)

    queuedWorkflows.forEach(wf => {
      console.log(`\n⏸️  待开始：${wf.title}`)
      console.log(`   ID: ${wf.id}`)
    })

    // 立即启动第一个流水线
    const firstQueued = queuedWorkflows[0]
    if (!firstQueued) {
      console.error('\n❌ 没有待开始的流水线！')
      return
    }

    // ============================================================
    // 第三步：启动流水线
    // ============================================================
    printSection('3️⃣  启动流水线')

    console.log(`启动流水线: ${firstQueued.id}`)
    const startResult = startWorkflow(db, firstQueued.id, DEMO_ACCOUNT_ID)

    console.log(`\n✅ 启动成功！`)
    console.log(`   已有活跃流水线: ${startResult.alreadyActive}`)
    printWorkflow(startResult.workflow)

    // ============================================================
    // 第四步：完成第一个工序
    // ============================================================
    printSection('4️⃣  完成工序：精读论文')

    const stage1Id = startResult.workflow.stages[0].id
    const completion1 = {
      completion_type: 'manual',
      description: '已完成论文精读，深入理解了 Transformer 架构的核心机制',
      artifacts: [
        {
          type: 'reading_note',
          url: '/fast-read/notes/attention-is-all-you-need.md',
          title: 'Transformer 架构深度笔记'
        },
        {
          type: 'annotation',
          count: 42,
          highlights: 28,
          description: '标注了关键公式、架构图和创新点'
        },
        {
          type: 'mindmap',
          url: '/fast-read/mindmaps/transformer-architecture.svg',
          title: 'Transformer 架构思维导图'
        }
      ]
    }

    const completeResult1 = completeStage(
      db,
      workflowId,
      'stage-read-paper',
      DEMO_ACCOUNT_ID,
      completion1,
      `op-${Date.now()}-1`
    )

    console.log('✅ 工序完成！')
    console.log(`   完成 ID: ${completeResult1.completion.id}`)
    console.log(`   产物数量: ${completion1.artifacts.length}`)

    console.log('\n📊 流水线进度：')
    printWorkflow(completeResult1.workflow)

    // ============================================================
    // 第五步：完成第二个工序
    // ============================================================
    printSection('5️⃣  完成工序：撰写分析报告')

    const completion2 = {
      completion_type: 'manual',
      description: '完成 2500 字技术分析报告，包含架构详解和应用场景',
      artifacts: [
        {
          type: 'document',
          url: '/fast-write/docs/transformer-analysis.md',
          title: 'Transformer 架构技术分析',
          word_count: 2543
        },
        {
          type: 'diagram',
          url: '/fast-write/assets/transformer-architecture-explained.png',
          title: '架构图解'
        }
      ]
    }

    const completeResult2 = completeStage(
      db,
      workflowId,
      'stage-write-analysis',
      DEMO_ACCOUNT_ID,
      completion2,
      `op-${Date.now()}-2`
    )

    console.log('✅ 工序完成！')
    console.log('\n📊 流水线进度：')
    printWorkflow(completeResult2.workflow)

    // ============================================================
    // 第六步：完成第三个工序（流水线完成）
    // ============================================================
    printSection('6️⃣  完成工序：实现代码示例')

    const completion3 = {
      completion_type: 'manual',
      description: '实现了简化版 Transformer Encoder，代码可运行',
      artifacts: [
        {
          type: 'code',
          url: '/fast-news/projects/transformer-demo/encoder.py',
          title: 'Transformer Encoder 实现',
          language: 'python',
          lines: 156
        },
        {
          type: 'notebook',
          url: '/fast-news/projects/transformer-demo/demo.ipynb',
          title: '运行演示'
        }
      ]
    }

    const completeResult3 = completeStage(
      db,
      workflowId,
      'stage-code-demo',
      DEMO_ACCOUNT_ID,
      completion3,
      `op-${Date.now()}-3`
    )

    console.log('✅ 工序完成！')
    console.log('\n🎉 流水线全部完成：')
    printWorkflow(completeResult3.workflow)

    // ============================================================
    // 第七步：测试幂等性
    // ============================================================
    printSection('7️⃣  测试幂等性')

    console.log('尝试重复发布相同内容...')
    const duplicateResult = receiveDispatch(db, dispatchPayload, DEMO_ACCOUNT_ID)
    console.log(`✅ 幂等验证：duplicate=${duplicateResult.duplicate}`)
    console.log(`   返回相同流水线 ID: ${duplicateResult.receipt.workflow_id === workflowId}`)

    // ============================================================
    // 第八步：查询最终状态
    // ============================================================
    printSection('8️⃣  查询最终状态')

    const finalActive = getWorkflowsByAccount(db, DEMO_ACCOUNT_ID, 'active')
    const finalQueued = getWorkflowsByAccount(db, DEMO_ACCOUNT_ID, 'queued')
    const finalCompleted = getWorkflowsByAccount(db, DEMO_ACCOUNT_ID, 'completed')

    console.log(`活跃: ${finalActive.length}`)
    console.log(`待开始: ${finalQueued.length}`)
    console.log(`已完成: ${finalCompleted.length}`)

    if (finalCompleted.length > 0) {
      console.log('\n✅ 已完成的流水线：')
      finalCompleted.forEach(wf => {
        console.log(`   - ${wf.title}`)
        console.log(`     完成时间: ${wf.completed_at}`)
      })
    }

    // ============================================================
    // 总结
    // ============================================================
    printSection('✨ 演示完成')

    console.log('本次演示展示了：')
    console.log('  ✅ FastTask 发布任务流水线')
    console.log('  ✅ FastResearch 幂等接收')
    console.log('  ✅ 查询流水线列表')
    console.log('  ✅ 启动流水线（单活跃约束）')
    console.log('  ✅ 完成工序（自动激活下一个）')
    console.log('  ✅ 流水线完成（所有工序完成）')
    console.log('  ✅ 幂等性验证')
    console.log('  ✅ 状态追踪')

    console.log('\n💾 数据已保存到: data/workflows-demo.sqlite')
    console.log('\n📖 详细文档：')
    console.log('   - 使用示例: docs/fasttask-integration-example.md')
    console.log('   - 完成报告: docs/COMPLETION_REPORT.md')
    console.log('\n')

  } catch (error) {
    console.error('\n❌ 演示失败：', error.message)
    console.error(error.stack)
  } finally {
    db.close()
  }
}

demo().catch(console.error)
