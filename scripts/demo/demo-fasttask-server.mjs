import http from 'node:http'

// 模拟 FastTask 服务器发布任务到 FastResearch
const FASTRESEARCH_API = 'http://127.0.0.1:8787'
const INGEST_KEY = 'fastinsight-test-key-2026'

function publishToFastResearch(dispatch) {
  return new Promise((resolve, reject) => {
    const url = new URL('/api/workflow/publish', FASTRESEARCH_API)
    const payload = JSON.stringify(dispatch)

    const options = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-fastinsight-key': INGEST_KEY,
        'Content-Length': Buffer.byteLength(payload)
      }
    }

    const req = http.request(url, options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        } else {
          resolve({ status: res.statusCode, data: JSON.parse(data) })
        }
      })
    })

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

async function main() {
  console.log('🚀 FastTask 模拟服务器')
  console.log('=' .repeat(60))
  console.log()

  // 任务 1：AI 研究项目
  console.log('📋 任务 1: AI 论文研究项目')
  const task1 = {
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: `task-ai-research-${Date.now()}`,
    dispatch_revision: 1,
    receiver_ref: 'researcher-alice',
    title: '🧠 深度学习前沿：Transformer 架构全面解析',
    description: '系统性研究 Transformer 架构的理论基础、实现细节和应用场景',
    goal_id: 'goal-2026-q1-ai',
    task_id: 'task-transformer-study',
    task_revision: 3,
    stages: [
      {
        stage_id: 'read-original-paper',
        module: 'fast-read',
        position: 1,
        title: '📖 精读原始论文',
        description: '深入阅读《Attention Is All You Need》，理解自注意力机制的数学原理',
        success_criteria: '完成论文标注，提取关键公式和架构图',
        minimum_action: 'annotate'
      },
      {
        stage_id: 'explore-implementations',
        module: 'fast-news',
        position: 2,
        title: '⚗️ 探索实现代码',
        description: '研究 PyTorch 和 TensorFlow 中的 Transformer 实现',
        success_criteria: '运行并理解至少一个完整实现',
        minimum_action: 'experiment'
      },
      {
        stage_id: 'write-technical-summary',
        module: 'fast-write',
        position: 3,
        title: '✍️ 撰写技术总结',
        description: '撰写包含数学推导和代码示例的技术文档',
        success_criteria: '完成 3000 字以上的深度技术文章',
        minimum_action: 'draft'
      },
      {
        stage_id: 'create-presentation',
        module: 'fast-write',
        position: 4,
        title: '🎯 制作演讲稿',
        description: '制作面向团队的技术分享 PPT',
        success_criteria: '完成 20 页以上的演示文稿',
        minimum_action: 'outline'
      }
    ],
    materials: [
      {
        material_id: 'paper-attention',
        title: 'Attention Is All You Need (Vaswani et al., 2017)',
        url: 'https://arxiv.org/abs/1706.03762',
        content_type: 'application/pdf',
        description: 'Transformer 架构的原始论文'
      },
      {
        material_id: 'pytorch-transformer',
        title: 'PyTorch Transformer 官方实现',
        url: 'https://pytorch.org/docs/stable/generated/torch.nn.Transformer.html',
        content_type: 'text/html',
        description: 'PyTorch 框架中的 Transformer 模块文档'
      },
      {
        material_id: 'annotated-transformer',
        title: 'The Annotated Transformer',
        url: 'http://nlp.seas.harvard.edu/2018/04/03/attention.html',
        content_type: 'text/html',
        description: '带详细注释的 Transformer 实现教程'
      }
    ]
  }

  try {
    const result = await publishToFastResearch(task1)
    console.log('✅ 发布成功！')
    console.log(`   状态码: ${result.status}`)
    console.log(`   工作流 ID: ${result.data.receipt?.workflow_id}`)
    console.log(`   接收时间: ${result.data.receipt?.received_at}`)
    console.log()
  } catch (error) {
    console.log(`❌ 发布失败: ${error.message}`)
    return
  }

  // 等待一秒
  await new Promise(resolve => setTimeout(resolve, 1000))

  // 任务 2：行业新闻追踪
  console.log('📋 任务 2: AI 行业动态追踪')
  const task2 = {
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: `task-news-tracking-${Date.now()}`,
    dispatch_revision: 1,
    receiver_ref: 'researcher-alice',
    title: '📰 本周 AI 行业重要动态汇总',
    description: '追踪并分析本周人工智能领域的重要新闻和技术发布',
    goal_id: 'goal-2026-q1-awareness',
    task_id: 'task-weekly-news',
    task_revision: 1,
    stages: [
      {
        stage_id: 'collect-news',
        module: 'fast-news',
        position: 1,
        title: '📡 收集行业新闻',
        description: '从主要技术媒体和学术会议收集本周重要新闻',
        success_criteria: '至少收集 10 条高质量新闻',
        minimum_action: 'collect'
      },
      {
        stage_id: 'analyze-trends',
        module: 'fast-write',
        position: 2,
        title: '📊 分析行业趋势',
        description: '分析新闻背后的技术趋势和商业影响',
        success_criteria: '完成趋势分析报告',
        minimum_action: 'draft'
      }
    ],
    materials: []
  }

  try {
    const result = await publishToFastResearch(task2)
    console.log('✅ 发布成功！')
    console.log(`   状态码: ${result.status}`)
    console.log(`   工作流 ID: ${result.data.receipt?.workflow_id}`)
    console.log(`   接收时间: ${result.data.receipt?.received_at}`)
    console.log()
  } catch (error) {
    console.log(`❌ 发布失败: ${error.message}`)
  }

  console.log('=' .repeat(60))
  console.log('✨ FastTask 已将 2 个任务发布到 FastResearch')
  console.log()
  console.log('📍 下一步: 在 FastResearch 中查看和执行这些任务')
  console.log('   - 访问 http://127.0.0.1:8787')
  console.log('   - 使用成员账号登录')
  console.log('   - 查看待开始的工作流列表')
  console.log('   - 启动工作流并逐步完成各个工序')
}

main().catch(console.error)
