import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { AccountStore } from './account-store.mjs'
import { migrateAccounts } from './account-migration.mjs'

test('two writers detect conflicts, preserve stable identity and refuse account deletion', () => {
 const dir = mkdtempSync(path.join(tmpdir(),'research-store-'))
 let a,b
 try {
  const input={keys:[{id:'key',keyHash:'a'.repeat(64),person:'Reader',inbox:[{text:'keep'}]}]}
  const source=path.join(dir,'access.json'), target=path.join(dir,'accounts.sqlite')
  writeFileSync(source,JSON.stringify(input)); migrateAccounts(source,target,{apply:true})
  a=new AccountStore(target);b=new AccountStore(target)
  const left=a.load(),right=b.load(),id=a.accountIdForKey('key')
  left.data.keys[0].keyHash='b'.repeat(64)
  a.save(left.data,left.revision)
  assert.equal(a.accountIdForKey('key'),id)
  right.data.keys[0].person='stale update'
  assert.throws(()=>b.save(right.data,right.revision),/另一进程/)
  assert.equal(b.load().data.keys[0].person,'Reader')
  const next=b.load();next.data.keys=[]
  assert.throws(()=>b.save(next.data,next.revision),/不能删除/)
  assert.deepEqual(a.load().data.keys[0].inbox,[{text:'keep'}])
  const output=path.join(dir,'rollback.json')
  execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/export-accounts.mjs',import.meta.url)),target,output],{stdio:'pipe'})
  const exported=JSON.parse(readFileSync(output,'utf8'))
  assert.deepEqual(exported.keys,a.load().data.keys)
  assert.equal(exported.jwtSecret.length,64)
  assert.notEqual(exported.jwtSecret,a.load().data.jwtSecret)
  assert.throws(()=>execFileSync(process.execPath,[fileURLToPath(new URL('../scripts/export-accounts.mjs',import.meta.url)),target,output],{stdio:'pipe'}))
  assert.equal(JSON.parse(readFileSync(output,'utf8')).jwtSecret,exported.jwtSecret)
 } finally {a?.close();b?.close();rmSync(dir,{recursive:true,force:true})}
})
