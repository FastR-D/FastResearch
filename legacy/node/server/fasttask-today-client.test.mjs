import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createFastTaskTodayClient } from './fasttask-today-client.mjs'
import { fixture, probeToday } from '../scripts/fasttask-today-contract.mjs'

test('registry SDK client_credentials and real today client consume Task wire fixture; legacy stays live', async (t) => {
  let origin, grants = 0, mode = 'valid', todayCalls = 0
  const server = createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString()
    if (req.url === '/.well-known/openid-configuration') {
      res.end(JSON.stringify({ issuer: origin, authorization_endpoint: `${origin}/authorize`, token_endpoint: `${origin}/token`, jwks_uri: `${origin}/jwks`, userinfo_endpoint: `${origin}/userinfo`, response_types_supported: ['code'], subject_types_supported: ['public'], id_token_signing_alg_values_supported: ['RS256'], token_endpoint_auth_methods_supported: ['client_secret_basic'] }))
    } else if (req.url === '/token') {
      grants++
      const form = new URLSearchParams(raw)
      assert.equal(form.get('grant_type'), 'client_credentials')
      assert.equal(form.get('scope'), 'integrations:fastresearch')
      const credentials = Buffer.from(req.headers.authorization.slice(6), 'base64').toString().split(':').map(decodeURIComponent)
      assert.deepEqual(credentials, ['research-service', 'disposable-secret'])
      if (mode === 'invalid') {
        res.statusCode = 401; res.end(JSON.stringify({ error: 'invalid_client' }))
      } else {
        res.end(JSON.stringify({ access_token: 'disposable-service-token', token_type: 'Bearer', expires_in: mode === 'short' ? 1 : 60 }))
      }
    } else if (req.url === '/api/v1/integrations/fastresearch/today') {
      todayCalls++
      if (req.headers.authorization) {
        assert.equal(req.headers.authorization, 'Bearer disposable-service-token')
        assert.equal(req.headers['x-api-key'], undefined)
      } else {
        assert.equal(req.headers['x-api-key'], 'disposable-key')
      }
      const body = JSON.parse(raw)
      if (body.receiver_refs[0] === 'outside') {
        res.statusCode = 403; res.end(JSON.stringify({ detail: 'receiver denied' }))
      } else {
        assert.deepEqual(body, fixture.request)
        res.end(JSON.stringify(fixture.response))
      }
    } else { res.statusCode = 404; res.end('{}') }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  origin = `http://127.0.0.1:${server.address().port}`
  const env = { FASTTASK_URL: origin, FASTTASK_SERVICE_ISSUER: origin, FASTTASK_SERVICE_CLIENT_ID: 'research-service', FASTTASK_SERVICE_CLIENT_SECRET: 'disposable-secret', FASTTASK_SERVICE_ALLOW_LOOPBACK_HTTP: 'true', FASTTASK_API_KEY: 'disposable-key' }
  assert.deepEqual(await probeToday(env), { service: 'passed', legacy: 'passed', receiver_denied: 'passed' })
  assert.equal(grants, 1, 'service token must be reused')
  mode = 'short'
  const short = createFastTaskTodayClient(env)
  await Promise.all([short.fetchToday(fixture.request.receiver_refs), short.fetchToday(fixture.request.receiver_refs)])
  assert.equal(grants, 2, 'concurrent callers share an acquisition')
  await short.fetchToday(fixture.request.receiver_refs)
  assert.equal(grants, 3, 'short token is refreshed rather than used beyond expiry')
  mode = 'invalid'
  const failed = createFastTaskTodayClient(env), before = todayCalls
  await assert.rejects(failed.fetchToday(['account-a']))
  assert.equal(todayCalls, before, 'grant failure must not fall back to the legacy key')
  mode = 'valid'
  await failed.fetchToday(fixture.request.receiver_refs)
  assert.equal(grants, 5, 'failed acquisition is retryable on the next request')
  assert.equal(createFastTaskTodayClient({ FASTTASK_URL: origin }), null)
  assert.throws(() => createFastTaskTodayClient({ ...env, FASTTASK_SERVICE_CLIENT_SECRET: '' }), /all three/)
})
