import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceApps, workspaceAppCatalog } from './workspace-apps.mjs'

test('workspace launches each web application through its own CAS endpoint', () => {
  const apps = workspaceApps({ FASTNEWS_PUBLIC_URL: 'https://news.example', FASTREAD_PUBLIC_URL: 'https://read.example/research?ignored=1', FASTWRITE_PUBLIC_URL: 'https://write.example', FASTTASK_PUBLIC_URL: 'https://task.example' })
  for (const [id, expected] of [
    ['fast-news', 'https://news.example/api/auth/fastcas/login'],
    ['fast-read', 'https://read.example/research/api/auth/fastcas/login'],
    ['fast-write', 'https://write.example/api/auth/fastcas/login?returnTo=%2Fpanel'],
    ['fast-task', 'https://task.example/api/v1/auth/fastcas/login'],
  ]) {
    assert.equal(apps.find(app => app.id === id).target, expected)
    assert.equal(apps.find(app => app.id === id).auth, 'cas')
  }
})

test('local tools are explicit direct launches; missing or unsafe configuration never enables a button', () => {
  const apps = workspaceApps({ VITE_FASTPPT_URL: 'http://127.0.0.1:9090', VITE_FASTLAB_URL: 'javascript:alert(1)', FASTREAD_PUBLIC_URL: 'https://user:password@read.example' })
  assert.equal(apps.find(app => app.id === 'fast-ppt').auth, 'direct')
  assert.equal(apps.find(app => app.id === 'fast-ppt').configured, true)
  for (const id of ['fast-lab', 'fast-task', 'fast-read']) assert.equal(apps.find(app => app.id === id).configured, false)
  assert.equal(workspaceApps({ FASTLAB_CAS_LOGIN_URL: 'https://lab.example/cas/login' }).find(app => app.id === 'fast-lab').auth, 'cas')
  assert.equal(workspaceApps({ FASTLAB_CAS_LOGIN_URL: 'https://lab.example/#secret', VITE_FASTLAB_URL: 'https://lab.example' }).find(app => app.id === 'fast-lab').configured, false)
  assert.ok(workspaceAppCatalog({}).every(app => !Object.hasOwn(app, 'target')))
})
