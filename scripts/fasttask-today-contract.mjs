import assert from 'node:assert/strict'
import { createHash, scryptSync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createFastTaskTodayClient } from '../server/fasttask-today-client.mjs'

export const fixture = JSON.parse(readFileSync(new URL('../contracts/fastresearch-today/v1/cases.json', import.meta.url), 'utf8')
  .replaceAll('$today', new Date().toISOString().slice(0, 10)))

export async function probeToday(env) {
  const service = createFastTaskTodayClient(env)
  assert.ok(service, 'service client must be configured')
  assert.deepEqual(await service.fetchToday(fixture.request.receiver_refs), fixture.response)
  assert.deepEqual(await service.fetchToday(fixture.request.receiver_refs), fixture.response)
  const legacy = createFastTaskTodayClient({ FASTTASK_URL: env.FASTTASK_URL, FASTTASK_API_KEY: env.FASTTASK_API_KEY })
  assert.ok(legacy, 'legacy client must be configured')
  assert.deepEqual(await legacy.fetchToday(fixture.request.receiver_refs), fixture.response)
  await assert.rejects(service.fetchToday(['outside']), { status: 403 })
  return { service: 'passed', legacy: 'passed', receiver_denied: 'passed' }
}

// Run only in the disposable cross-product process: exercise the composition
// used by the workspace, including Key login and account -> receiver mapping.
async function probeResearchServer() {
  const dir = mkdtempSync(path.join(tmpdir(), 'research-today-contract-'))
  const key = 'fk_today-contract-key'
  const passwordHash = `scrypt$fixture$${scryptSync('disposable-admin-password', 'fixture', 64).toString('hex')}`
  process.env.FASTRESEARCH_DATA_DIR = dir
  for (const name of ['FASTTASK_API_KEY', 'FASTTASK_PROVISION_KEY', 'FASTTASK_API_KEYS',
    'FASTRESEARCH_FASTCAS_ISSUER', 'FASTRESEARCH_FASTCAS_CLIENT_ID', 'FASTRESEARCH_FASTCAS_CLIENT_SECRET',
    'FASTWRITE_URL', 'FASTWRITE_API_KEY']) delete process.env[name]
  writeFileSync(path.join(dir, 'access.json'), JSON.stringify({
    admin: { username: 'admin', passwordHash }, jwtSecret: 'disposable-contract-secret',
    keys: [{ id: 'fixture-key', person: 'Fixture member', accountId: 'account-a',
      keyHash: createHash('sha256').update(key).digest('hex'), keyPreview: 'fixture', expiresAt: null, revokedAt: null }],
  }), { mode: 0o600 })
  let server
  try {
    const { startServer } = await import('../server/index.mjs')
    server = await startServer(0, '127.0.0.1')
    const origin = `http://127.0.0.1:${server.address().port}`
    const login = await fetch(`${origin}/api/content/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    })
    assert.equal(login.status, 200)
    const member = await login.json()
    assert.equal(member.accountId, 'account-a')
    const session = member.session
    assert.ok(session)
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${origin}/api/fasttask/today`, { headers: { Authorization: `Bearer ${session}` } })
      assert.equal(response.status, 200)
      assert.deepEqual(await response.json(), { today: fixture.research_today })
    }
    return 'passed'
  } finally {
    if (server) await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // This executable is an integration probe, never a production health check.
  for (const key of ['FASTTASK_URL', 'FASTTASK_SERVICE_ISSUER']) {
    const url = new URL(process.env[key])
    assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), `${key} must be loopback`)
  }
  const result = await probeToday(process.env)
  result.research_http_token_only = await probeResearchServer()
  console.log(JSON.stringify(result))
}
