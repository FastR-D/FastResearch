import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { migrateAccounts, planAccounts, readLegacySnapshot } from './account-migration.mjs'

function fixture() {
  return { admin: { username: 'admin', passwordHash: 'private-admin-hash' }, jwtSecret: 'private-signing-secret', unknownRoot: { keep: true }, keys: ['one','two'].map(id => ({ id, person: 'Same name', keyHash: id === 'one' ? 'a'.repeat(64) : 'b'.repeat(64), expiresAt: null, revokedAt: null, followedAuthors: ['Author'], inbox: [{ content: 'original content', read: false }], workflow: { tasks: [{ title: 'task' }] }, unknownContent: ['preserve', 2] })) }
}

test('dry-run is read-only, hides credentials and keeps same-name accounts separate', () => {
  const dir = mkdtempSync(path.join(tmpdir(),'research-accounts-'))
  try {
    const source = path.join(dir,'access.json'), target = path.join(dir,'accounts.sqlite')
    writeFileSync(source, JSON.stringify(fixture()))
    const report = migrateAccounts(source, target)
    assert.equal(report.applied, false)
    assert.deepEqual(readdirSync(dir), ['access.json'])
    assert.equal(new Set(report.mappings.map(row => row.accountId)).size,2)
    for (const secret of ['private-admin-hash','private-signing-secret','a'.repeat(64),'original content']) assert.ok(!JSON.stringify(report).includes(secret))
    assert.deepEqual(planAccounts(fixture()).report, reportWithoutApply(report))
  } finally { rmSync(dir,{recursive:true,force:true}) }
})
function reportWithoutApply({ applied, ...report }) { return report }

test('migration verifies exact content and retains source backup with private permissions', () => {
  const dir = mkdtempSync(path.join(tmpdir(),'research-accounts-'))
  try {
    const source = path.join(dir,'access.json'), target = path.join(dir,'accounts.sqlite')
    const original = JSON.stringify(fixture(),null,2)+'\n'
    writeFileSync(source, original)
    const report = migrateAccounts(source,target,{apply:true})
    assert.equal(readFileSync(source,'utf8'),original)
    assert.equal(readFileSync(report.backup,'utf8'),original)
    assert.equal(statSync(target).mode & 0o777,0o600)
    assert.equal(statSync(report.backup).mode & 0o777,0o600)
    const db = new DatabaseSync(target)
    try { assert.deepEqual(readLegacySnapshot(db), fixture()) } finally { db.close() }
    assert.throws(() => migrateAccounts(source,target,{apply:true}))
    assert.equal(readFileSync(source,'utf8'),original)
  } finally { rmSync(dir,{recursive:true,force:true}) }
})

test('invalid and duplicate records fail without writes', () => {
  const input = fixture()
  input.keys[1].id = input.keys[0].id
  assert.throws(() => planAccounts(input), /duplicate/)
  assert.throws(() => planAccounts({ keys: [{id:'bad',keyHash:'missing'}] }), /Invalid/)
  assert.throws(() => planAccounts({}), /keys array/)
})
