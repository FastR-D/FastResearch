/**
 * FastTask 集成 API 快速验证脚本
 *
 * 运行方式：
 * 1. 启动服务器：npm run server
 * 2. 在另一个终端运行：node server/verify-fasttask-api.mjs
 */

const BASE_URL = 'http://127.0.0.1:8787'

async function fetchAPI(path, options = {}) {
  const url = `${BASE_URL}${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })
  const text = await response.text()
  let data
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = text
  }
  return { status: response.status, data }
}

async function main() {
  console.log('🚀 FastTask 集成 API 验证\n')

  // 1. 测试发布接收（无认证会失败，但能验证路由存在）
  console.log('1️⃣  测试发布接收路由...')
  const publishPayload = {
    schema_version: 'fasttask-dispatch-v1',
    dispatch_id: 'test-dispatch-001',
    dispatch_revision: 1,
    receiver_ref: 'account-test',
    title: '测试任务流水线',
    stages: [
      {
        stage_id: 'stage-1',
        module: 'fast-read',
        title: '阅读论文',
      },
    ],
  }

  const publishResult = await fetchAPI('/api/workflow/publish', {
    method: 'POST',
    body: JSON.stringify(publishPayload),
  })

  if (publishResult.status === 401) {
    console.log('   ✅ 发布接口存在（需要服务认证）')
  } else {
    console.log(`   ⚠️  意外状态码: ${publishResult.status}`)
    console.log('   响应:', publishResult.data)
  }

  // 2. 测试流水线列表查询（无认证会失败）
  console.log('\n2️⃣  测试流水线列表查询...')
  const listResult = await fetchAPI('/api/workflows')

  if (listResult.status === 401) {
    console.log('   ✅ 列表接口存在（需要成员认证）')
  } else {
    console.log(`   ⚠️  意外状态码: ${listResult.status}`)
    console.log('   响应:', listResult.data)
  }

  // 3. 测试流水线详情查询
  console.log('\n3️⃣  测试流水线详情查询...')
  const detailResult = await fetchAPI('/api/workflows/test-workflow-id')

  if (detailResult.status === 401) {
    console.log('   ✅ 详情接口存在（需要成员认证）')
  } else {
    console.log(`   ⚠️  意外状态码: ${detailResult.status}`)
    console.log('   响应:', detailResult.data)
  }

  // 4. 测试启动流水线
  console.log('\n4️⃣  测试启动流水线...')
  const startResult = await fetchAPI('/api/workflows/test-workflow-id/start', {
    method: 'POST',
  })

  if (startResult.status === 401) {
    console.log('   ✅ 启动接口存在（需要成员认证）')
  } else {
    console.log(`   ⚠️  意外状态码: ${startResult.status}`)
    console.log('   响应:', startResult.data)
  }

  // 5. 测试完成工序
  console.log('\n5️⃣  测试完成工序...')
  const completePayload = {
    operation_id: 'op-test-001',
    completion_type: 'manual',
    description: '测试完成',
  }
  const completeResult = await fetchAPI('/api/workflows/test-id/stages/stage-1/complete', {
    method: 'POST',
    body: JSON.stringify(completePayload),
  })

  if (completeResult.status === 401) {
    console.log('   ✅ 完成接口存在（需要成员认证）')
  } else {
    console.log(`   ⚠️  意外状态码: ${completeResult.status}`)
    console.log('   响应:', completeResult.data)
  }

  // 6. 测试旧版工作流接口（兼容性）
  console.log('\n6️⃣  测试旧版工作流接口兼容性...')
  const legacyResult = await fetchAPI('/api/workflow')

  if (legacyResult.status === 401) {
    console.log('   ✅ 旧版接口保持兼容（需要成员认证）')
  } else {
    console.log(`   ⚠️  意外状态码: ${legacyResult.status}`)
    console.log('   响应:', legacyResult.data)
  }

  console.log('\n✅ API 路由验证完成')
  console.log('\n💡 提示：')
  console.log('   - 所有接口返回 401 表示路由正常，需要相应认证')
  console.log('   - 发布接口需要 FastCAS 服务令牌')
  console.log('   - 其他接口需要成员会话认证')
  console.log('   - 完整功能测试见：npm run test:fasttask')
}

main().catch(error => {
  console.error('❌ 验证失败:', error.message)
  if (error.code === 'ECONNREFUSED') {
    console.error('\n💡 请先启动服务器：npm run server')
  }
  process.exit(1)
})
