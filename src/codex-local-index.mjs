import { readdir } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import os from 'node:os'
import path from 'node:path'

export const defaultCodexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex')
const compact = (value, length = 100) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length)

function databaseFile(files, prefix) {
  const expression = new RegExp(`^${prefix}_(\\d+)\\.sqlite$`)
  return files.map((name) => ({ name, version: Number(name.match(expression)?.[1] || -1) }))
    .filter((entry) => entry.version >= 0).sort((a, b) => b.version - a.version)[0]?.name
}

function readDatabase(file, read) {
  let db
  try {
    db = new DatabaseSync(file, { readOnly: true })
    db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 150;')
    return read(db)
  } catch { return null }
  finally { db?.close() }
}

// The conversation panel's six preview rows are not the monitoring index.
// Read local metadata only, and always include unfinished goals even when old.
export async function readCodexLocalIndex(home = defaultCodexHome()) {
  let files
  try { files = await readdir(home) } catch { return { threads: [], available: false } }
  const goalFile = databaseFile(files, 'goals')
  const stateFile = databaseFile(files, 'state')
  const goals = goalFile ? readDatabase(path.join(home, goalFile), (db) => db.prepare(
    "SELECT thread_id,status,updated_at_ms FROM thread_goals WHERE status IN ('active','paused','blocked','usage_limited','budget_limited')",
  ).all()) || [] : []
  const goalsById = new Map(goals.map((goal) => [goal.thread_id, goal]))
  const rows = stateFile ? readDatabase(path.join(home, stateFile), (db) => {
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map((column) => column.name))
    const title = columns.has('name') ? "coalesce(nullif(name,''),title)" : 'title'
    const updated = columns.has('updated_at_ms') ? 'coalesce(updated_at_ms,updated_at*1000)' : 'updated_at*1000'
    const select = `SELECT id,rollout_path,cwd,${title} AS title,${updated} AS updatedAtMs FROM threads`
    const recent = db.prepare(`${select} WHERE archived=0 ORDER BY updatedAtMs DESC LIMIT 200`).all()
    const ids = new Set(recent.map((thread) => thread.id))
    const lookup = db.prepare(`${select} WHERE id=?`)
    for (const goal of goals) {
      if (ids.has(goal.thread_id)) continue
      const row = lookup.get(goal.thread_id)
      if (row) recent.push(row)
    }
    return recent
  }) : null
  const threads = (rows || []).map((thread) => ({
    id: thread.id, title: compact(thread.title, 60), path: thread.rollout_path,
    project: path.basename(thread.cwd || ''), updatedAt: Number(thread.updatedAtMs) / 1000,
    goalStatus: goalsById.get(thread.id)?.status || null,
    goalUpdatedAt: Number(goalsById.get(thread.id)?.updated_at_ms) || 0,
  }))
  for (const goal of goals) if (!threads.some((thread) => thread.id === goal.thread_id)) {
    threads.push({ id: goal.thread_id, title: '持续目标', path: null, project: '',
      updatedAt: Number(goal.updated_at_ms) / 1000, goalStatus: goal.status, goalUpdatedAt: Number(goal.updated_at_ms) })
  }
  return { threads, available: rows !== null || goals.length > 0 }
}
