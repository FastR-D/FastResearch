import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync,rmSync,writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrateAccounts } from './account-migration.mjs'
import { AccountStore,TokenStore } from './account-store.mjs'
import { FastCASStore } from './fastcas-store.mjs'

test('durable transactions and atomic scoped versioned revocation',async()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'research-cas-'))
 let store,other
 try{
  const source=path.join(dir,'access.json'),db=path.join(dir,'accounts.sqlite')
  writeFileSync(source,JSON.stringify({keys:[{id:'key',keyHash:'a'.repeat(64),person:'Reader'}]}))
  migrateAccounts(source,db,{apply:true});store=new AccountStore(db);other=new AccountStore(db)
  const sessions=new TokenStore(store,'session'),cas=new FastCASStore(store,'https://cas.example','research'),second=new FastCASStore(other,cas.issuer,cas.clientId)
  await cas.put({state:'single',expiresAt:Date.now()+300000,verifier:'private'})
  const consumed=await Promise.all([cas.take('single'),second.take('single')])
  assert.equal(consumed.filter(Boolean).length,1)
  const accountId=store.accountIdForKey('key')
  const link={id:'link',client_id:'research',local_account_ref:accountId,subject:'subject',state:'active',version:2}
  cas.save(link)
  const base={accountId,expiresAt:Date.now()+300000}
  sessions.set('local',{...base,authSource:'key'})
  sessions.set('cas',{...base,authSource:'fastcas',casIssuer:cas.issuer,casLinkId:link.id,casLinkVersion:2,casSid:'sid-a'})
  sessions.set('cas-other',{...base,authSource:'fastcas',casIssuer:cas.issuer,casLinkId:link.id,casLinkVersion:2,casSid:'sid-b'})
  store.db.exec("CREATE TRIGGER fail_logout BEFORE INSERT ON fastcas_events BEGIN SELECT RAISE(ABORT,'injected'); END")
  await assert.rejects(cas.applyVerifiedLogout({id:'logout-a',subject:'subject',sessionId:'sid-a'}),/injected/)
  assert.ok(sessions.get('cas'))
  store.db.exec('DROP TRIGGER fail_logout')
  await cas.applyVerifiedLogout({id:'logout-a',subject:'subject',sessionId:'sid-a'})
  await cas.applyVerifiedLogout({id:'logout-a',subject:'subject',sessionId:'sid-a'})
  assert.equal(sessions.get('cas'),undefined)
  assert.ok(sessions.get('cas-other'));assert.ok(sessions.get('local'))
  sessions.set('cas',{...base,authSource:'fastcas',casIssuer:cas.issuer,casLinkId:link.id,casLinkVersion:2,casSid:'sid-a'})
  await cas.applyVerifiedLogout({id:'logout-all',subject:'subject'})
  assert.equal(sessions.get('cas'),undefined)
  assert.equal(sessions.get('cas-other'),undefined)
  assert.ok(sessions.get('local'))
  sessions.set('cas',{...base,authSource:'fastcas',casIssuer:cas.issuer,casLinkId:link.id,casLinkVersion:2})
  const event={id:'event',type:'account_link.revoked',link:{...link,state:'revoked',version:3}}
  store.db.exec("CREATE TRIGGER fail_event BEFORE INSERT ON fastcas_events BEGIN SELECT RAISE(ABORT,'injected'); END")
  await assert.rejects(cas.applyVerifiedEvent(event),/injected/)
  assert.equal(cas.current(accountId).state,'active');assert.ok(sessions.get('cas'))
  store.db.exec('DROP TRIGGER fail_event')
  await cas.applyVerifiedEvent(event);await cas.applyVerifiedEvent(event)
  assert.equal(sessions.get('cas'),undefined);assert.ok(sessions.get('local'))
  assert.equal(cas.current(accountId),null)
  cas.save(link);assert.equal(cas.current(accountId),null)
  cas.save({...link,id:'new'})
  await cas.applyVerifiedEvent({...event,id:'late'})
  assert.equal(cas.current(accountId).id,'new')
  assert.equal(store.load().data.keys.length,1)
 }finally{other?.close();store?.close();rmSync(dir,{recursive:true,force:true})}
})
