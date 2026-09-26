// Only run our tests; offline handoff snapshots can contain upstream test suites.
import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
// fileURLToPath handles Windows drive letters and non-ASCII workspace paths.
import { fileURLToPath } from 'node:url'
const result = spawnSync(process.execPath, ['--test', ...readdirSync(new URL('../test/', import.meta.url))
  .filter(name => name.endsWith('.test.mjs')).map(name => fileURLToPath(new URL('../test/' + name, import.meta.url)))], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
