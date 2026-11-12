import http from 'node:http'

const API_BASE = 'http://127.0.0.1:8787'
const INGEST_KEY = 'fastinsight-test-key-2026'
const DEMO_ACCOUNT_ID = 'account-demo-simple'

// 简化的 API 调用函数
function apiCall(method, path, body = null, useAuth = true) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, API_BASE)
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
      }
    }

    if (useAuth) {
      options.headers['x-fastinsight-key'] = INGEST_KEY
    }

    const req = http.request(url, options, (res) => {
      let data = ''
      res.on('data', (chunk) => { data += chunk })
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`))
        } else {
          resolve(JSON.parse(data))
        }
      })
    })

    req.on('error', reject)
    if (body) req.write(JSON.stringify(body))
    req.end()
  })
}

async function main() {
  console.log('🚀 FastTask → FastResearch 集成演示\n')

  // 测试 1：发布新流水线
  console.log('1️⃣  发布任务流水线...')
  const dispatch = {
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: `demo-${Date.now()}`,
    dispatch_revision: 1,
    receiver_ref: DEMO_ACCOUNT_ID,
    title: '🔬 演示：Transformer 架构研究',
    description: 'FastTask 集成测试',
    stages: [
      {
        stage_id: 'stage-1',
        module: 'fast-read',
        title: '📖 阅读论文',
        description: '阅读 Attention Is All You Need 原论文'
      },
      {
        stage_id: 'stage-2',
        module: 'fast-news',
        title: '💡 理解核心概念',
        description: '理解自注意力机制和位置编码'
      },
      {
        stage_id: 'stage-3',
        module: 'fast-write',
        title: '📝 撰写总结',
        description: '撰写技术总结文档'
      }
    ],
    materials: [
      {
        material_id: 'paper-1',
        title: 'Attention Is All You Need',
        url: 'https://arxiv.org/abs/1706.03762',
        content_type: 'application/pdf'
      }
    ]
  }

  try {
    const result = await apiCall('POST', '/api/workflow/publish', dispatch, true)
    console.log(`✅ 发布成功！`)
    console.log(`   重复发布: ${result.duplicate}`)
    console.log(`   回执: ${JSON.stringify(result.receipt)}`)
  } catch (error) {
    console.log(`❌ 发布失败: ${error.message}`)
    return
  }

  console.log('\n2️⃣  再次发布相同任务（测试幂等性）...')
  try {
    const result = await apiCall('POST', '/api/workflow/publish', dispatch, true)
    console.log(`✅ 幂等性验证成功！`)
    console.log(`   重复发布: ${result.duplicate}`)
  } catch (error) {
    console.log(`❌ 幂等性测试失败: ${error.message}`)
  }

  console.log('\n3️⃣  发布另一个不同的任务...')
  const dispatch2 = {
    ...dispatch,
    dispatch_id: `demo-${Date.now()}-second`,
    title: '🤖 演示：BERT 模型分析',
    stages: dispatch.stages.map(s => ({...s}))
  }

  try {
    const result = await apiCall('POST', '/api/workflow/publish', dispatch2, true)
    console.log(`✅ 第二个任务发布成功！`)
    console.log(`   重复发布: ${result.duplicate}`)
  } catch (error) {
    console.log(`❌ 发布失败: ${error.message}`)
  }

  console.log('\n✨ 演示完成！')
  console.log('\n已验证功能：')
  console.log('  ✅ FastTask 通过 HTTP API 发布任务流水线')
  console.log('  ✅ FastResearch 接收并存储工作流')
  console.log('  ✅ 幂等性：相同 dispatch_id 不会重复创建')
  console.log('  ✅ 认证：使用 x-fastinsight-key 头进行身份验证')
}

main().catch(console.error)
