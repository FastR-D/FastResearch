import path from 'node:path'
import { chmodSync, copyFileSync, mkdirSync } from 'node:fs'
import { mergeAccounts } from '../server/account-migration.mjs'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const paths = args.filter(arg => arg !== '--apply')
if (paths.length !== 2 || paths.some(arg => arg.startsWith('--'))) {
  console.error('Usage: node scripts/merge-access-snapshot.mjs <access.json> <accounts.sqlite> [--apply]')
  process.exitCode = 2
} else {
  const sourcePath = path.resolve(paths[0])
  const databasePath = path.resolve(paths[1])
  try {
    let backup = ''
    if (apply) {
      const backupDir = path.join(path.dirname(databasePath), `merge-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`)
      mkdirSync(backupDir, { recursive: true, mode: 0o700 })
      for (const suffix of ['', '-wal', '-shm']) {
        const from = databasePath + suffix
        const to = path.join(backupDir, path.basename(from))
        copyFileSync(from, to)
        chmodSync(to, 0o600)
      }
      backup = backupDir
    }
    const report = mergeAccounts(sourcePath, databasePath, { apply })
    console.log(JSON.stringify({
      applied: report.applied,
      total: report.total,
      added: report.added.length,
      updated: report.updated.length,
      unchanged: report.unchanged.length,
      backup,
    }, null, 2))
  } catch {
    console.error('Merge stopped. The source and database were not changed.')
    process.exitCode = 1
  }
}
