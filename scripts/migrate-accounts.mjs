import path from 'node:path'
import { migrateAccounts } from '../server/account-migration.mjs'

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const paths = args.filter(arg => arg !== '--apply')
if (paths.length !== 2 || paths.some(arg => arg.startsWith('--'))) {
  console.error('Usage: node scripts/migrate-accounts.mjs <access.json> <accounts.sqlite> [--apply]')
  process.exitCode = 2
} else {
  try {
    console.log(JSON.stringify(migrateAccounts(path.resolve(paths[0]), path.resolve(paths[1]), { apply }), null, 2))
  } catch {
    // Parser and filesystem exceptions can contain user input or secret bytes.
    console.error('Migration stopped. Check JSON structure, unique Key IDs, file permissions and existing target/backup files. No source file was changed.')
    process.exitCode = 1
  }
}
