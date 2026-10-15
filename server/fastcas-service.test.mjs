import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AccountStore,TokenStore } from './account-store.mjs'
import { migrateAccounts } from './account-migration.mjs'
import { FastCASService } from './fastcas-service.mjs'

const env={FASTRESEARCH_FASTCAS_ISSUER:'https://cas.example',FASTRESEARCH_FASTCAS_CLIENT_ID:'research',FASTRESEARCH_FASTCAS_CLIENT_SECRET:'test-secret',FASTRESEARCH_FASTCAS_REDIRECT_URI:'https://research.example/api/auth/fastcas/callback'}
test('Key proof, CAS login, stale activation, revoke recovery and source isolation',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'research-service-'));let store
 try{
  const source=path.join(dir,'access.json'),database=path.join(dir,'accounts.sqlite')
  writeFileSync(source,JSON.stringify({keys:[{id:'key',person:'Reader',keyHash:createHash('sha256').update('original-key').digest('hex')}]}))
  migrateAccounts(source,database,{apply:true});store=new AccountStore(database)
  const sessions=new TokenStore(store,'session'),accountId=store.accountIdForKey('key')
  sessions.set('local-session',{role:'member',keyId:'key',accountId,credentialVersion:1,authSource:'key',expiresAt:Date.now()+300000})
  let remote={id:'link',client_id:'research',local_account_ref:accountId,subject:'subject',state:'active',version:2}
  const sdk={getLink:async()=>({...remote}),resolveLink:async()=>({...remote}),revokeLink:async()=>remote={...remote,state:'revoked',version:3}}
  const service=new FastCASService(store,sessions,{env,sdk})
  assert.throws(()=>service.prove('local-session','wrong','peer'))
  assert.equal(service.prove('local-session','original-key','peer').accountId,accountId)
  service.store.save(remote)
  const delegated={sub:'subject',client_id:'news',act:{sub:'news'},delegated:true,service:false}
  const live={active:true,sub:'subject',client_id:'news',aud:['research-api'],scope:'research:read'}
  sdk.verifyAccessToken=async(raw,audience,scopes)=>{assert.equal(raw,'delegated-token');assert.equal(audience,'research-api');assert.deepEqual(scopes,['research:read']);return delegated}
  sdk.introspectToken=async()=>live
  assert.equal(await service.delegatedNewsAccount('Bearer delegated-token'),accountId)
  await assert.rejects(service.delegatedNewsAccount('Bearer original-key'))
  live.active=false
  await assert.rejects(service.delegatedNewsAccount('Bearer delegated-token'))
  live.active=true
  const token=service.issue(remote,{issuer:env.FASTRESEARCH_FASTCAS_ISSUER,subject:'subject',sessionId:'sid'})
  assert.equal(sessions.get(token).accountId,accountId)
  await service.validateSession(token)
  // Remote revoke committed, but caller never received its response.
  remote={...remote,state:'revoked',version:3}
  await service.revoke('local-session','original-key','peer')
  assert.equal(sessions.get(token),undefined);assert.ok(sessions.get('local-session'))
  await assert.rejects(service.accept({...remote,state:'active',version:2}),/状态已更改/)
  assert.equal(service.store.current(accountId),null)
  const disabled=new FastCASService(store,sessions,{env:{}})
  assert.equal(disabled.enabled,false)
  await assert.rejects(disabled.sdk(),/未启用/)
 }finally{store?.close();rmSync(dir,{recursive:true,force:true})}
})
