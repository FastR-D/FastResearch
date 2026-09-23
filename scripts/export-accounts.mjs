import { DatabaseSync } from 'node:sqlite'
import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { readLegacySnapshot } from '../server/account-migration.mjs'

const [database, output, ...extra] = process.argv.slice(2)
if (!database || !output || extra.length) {
  console.error('Usage: node scripts/export-accounts.mjs <accounts.sqlite> <new-access.json>')
  process.exitCode = 2
} else {
  let db
  try {
    db = new DatabaseSync(database, { readOnly: true })
    const snapshot = readLegacySnapshot(db)
    // The old server cannot enforce durable logout records; invalidate all old
    // JWTs on rollback so a revoked session never comes back to life.
    snapshot.jwtSecret = randomBytes(32).toString('hex')
    writeFileSync(output, JSON.stringify(snapshot,null,2)+'\n', { flag:'wx', mode:0o600 })
    console.log(JSON.stringify({ exported:true, accounts:snapshot.keys.length, sessionsInvalidated:true }))
  } catch {
    console.error('Export failed; check database and use a new output path.')
    process.exitCode = 1
  } finally { db?.close() }
}
