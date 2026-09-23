import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const entry=fileURLToPath(new URL('./index.mjs',import.meta.url))
async function start(dir) {
 const child=spawn(process.execPath,[entry],{cwd:dir,env:{...process.env,PORT:'0',HOST:'127.0.0.1',FASTRESEARCH_DATA_DIR:dir,FASTRESEARCH_ACCOUNT_DATABASE:path.join(dir,'accounts.sqlite'),ADMIN_USERNAME:'test-admin',ADMIN_PASSWORD:'test-admin-password'},stdio:['ignore','pipe','pipe']})
 let output=''
 const ready=new Promise((resolve,reject)=>{
  child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/listening on (http:\/\/[^\s]+)/);if(match)resolve(match[1])})
  child.stderr.on('data',chunk=>{output+=chunk})
  child.once('exit',code=>reject(new Error(`Server exited ${code}: ${output}`)))
 })
 let timeout
 try { const origin=await Promise.race([ready,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Startup timeout')),10000)})]); return {child,origin} }
 catch(error){child.kill();throw error}
 finally {clearTimeout(timeout)}
}
async function stop(child){const ended=once(child,'exit');child.kill();await ended}

test('real server persists accounts, rotates Key without data loss and preserves old SSO shape',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'research-runtime-'))
 let running
 try{
  running=await start(dir)
  async function request(route,method='GET',body,token){
   const response=await fetch(running.origin+route,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined})
   return {status:response.status,data:await response.json()}
  }
  assert.deepEqual((await request('/api/auth/fastcas/available')).data,{enabled:false})
  assert.equal((await request('/api/auth/fastcas/login')).status,404)
  let admin=(await request('/api/admin/login','POST',{username:'test-admin',password:'test-admin-password'})).data.session
  assert.ok(admin)
  const made=await request('/api/admin/keys','POST',{person:'Reader'},admin)
  assert.equal(made.status,201)
  const original=(await request('/api/content/unlock','POST',{key:made.data.key})).data
  assert.ok(original.accountId)
  assert.equal((await request('/api/content/impression','PUT',{text:'Original research notes'},original.session)).status,200)
  const ticket=(await request('/api/sso/ticket','POST',{audience:'fast-read'},original.session)).data.ticket
  const rotated=await request(`/api/admin/keys/${original.keyId}/rotate`,'POST',{},admin)
  assert.equal(rotated.data.accountId,original.accountId)
  assert.equal((await request('/api/content/me','GET',undefined,original.session)).status,401)
  assert.equal((await request('/api/content/unlock','POST',{key:made.data.key})).status,401)
  assert.equal((await request('/api/sso/consume','POST',{ticket,audience:'fast-read'})).status,401)
  const renewed=(await request('/api/content/unlock','POST',{key:rotated.data.key})).data
  assert.equal(renewed.accountId,original.accountId)
  assert.equal(renewed.impression.text,'Original research notes')
  const fresh=(await request('/api/sso/ticket','POST',{audience:'fast-read'},renewed.session)).data.ticket
  const consumed=await request('/api/sso/consume','POST',{ticket:fresh,audience:'fast-read'})
  assert.equal(consumed.status,200)
  assert.equal(consumed.data.keyId,original.keyId)
  assert.equal(consumed.data.accountId,original.accountId)
  await stop(running.child);running=await start(dir)
  const after=(await request('/api/content/unlock','POST',{key:rotated.data.key})).data
  assert.equal(after.accountId,original.accountId)
  assert.equal(after.impression.text,'Original research notes')
  admin=(await request('/api/admin/login','POST',{username:'test-admin',password:'test-admin-password'})).data.session
  assert.equal((await request(`/api/admin/keys/${original.keyId}`,'DELETE',undefined,admin)).status,200)
  assert.equal((await request('/api/content/me','GET',undefined,after.session)).status,401)
  const restore=await request(`/api/admin/keys/${original.keyId}/rotate`,'POST',{},admin)
  const restored=(await request('/api/content/unlock','POST',{key:restore.data.key})).data
  assert.equal(restored.accountId,original.accountId)
  assert.equal(restored.impression.text,'Original research notes')
  assert.equal((await request('/api/content/logout','POST',{},restored.session)).status,200)
  assert.equal((await request('/api/content/me','GET',undefined,restored.session)).status,401)
  const last=(await request('/api/content/unlock','POST',{key:restore.data.key})).data
  const durableTicket=(await request('/api/sso/ticket','POST',{audience:'fast-read'},last.session)).data.ticket
  await stop(running.child);running=await start(dir)
  assert.equal((await request('/api/content/me','GET',undefined,last.session)).status,200)
  assert.equal((await request('/api/content/me','GET',undefined,restored.session)).status,401)
  const attempts=await Promise.all([1,2].map(()=>request('/api/sso/consume','POST',{ticket:durableTicket,audience:'fast-read'})))
  assert.deepEqual(attempts.map(value=>value.status).sort(),[200,401])
  assert.ok(existsSync(path.join(dir,'access.json.pre-accounts.json')))
 }finally{if(running)await stop(running.child);rmSync(dir,{recursive:true,force:true})}
})
