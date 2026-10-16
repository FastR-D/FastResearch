import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { fastReadTargetPath, handleFastReadProxy, isFastReadProxyPath, rewriteFastReadText } from './fastread-proxy.mjs'

test('FastRead proxy maps the /read subroute to the 3015 service', () => {
  assert.equal(isFastReadProxyPath('/read'), true)
  assert.equal(isFastReadProxyPath('/read/api/auth/me'), true)
  assert.equal(isFastReadProxyPath('/api/auth/me'), false)
  assert.equal(fastReadTargetPath('/read'), '/')
  assert.equal(fastReadTargetPath('/read/api/auth/me'), '/api/auth/me')
})

test('FastRead proxy rewrites only root-relative app paths', () => {
  const source = 'fetch("/api/auth/me"); import("/vendor/pdfjs/pdf.js"); const api = "https://api.example.com/v1"'
  assert.equal(
    rewriteFastReadText(source),
    'fetch("/read/api/auth/me"); import("/read/vendor/pdfjs/pdf.js"); const api = "https://api.example.com/v1"',
  )
})

test('FastRead proxy preserves JSON request bodies for SSO exchange', async () => {
  let received
  const upstream = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    received = {
      body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      contentLength: request.headers['content-length'],
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end('{"csrf":"issued"}')
  })
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve))
  const proxy = createServer((request, response) => {
    void handleFastReadProxy(request, response, new URL(request.url, 'http://proxy'), `http://127.0.0.1:${upstream.address().port}`)
  })
  await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))

  try {
    const body = JSON.stringify({ ticket: 'one-time-ticket' })
    const response = await fetch(`http://127.0.0.1:${proxy.address().port}/read/api/auth/research`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { csrf: 'issued' })
    assert.deepEqual(received, {
      body: { ticket: 'one-time-ticket' },
      contentLength: String(Buffer.byteLength(body)),
    })
  } finally {
    await new Promise(resolve => proxy.close(resolve))
    await new Promise(resolve => upstream.close(resolve))
  }
})
