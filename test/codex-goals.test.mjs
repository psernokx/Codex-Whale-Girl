import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtemp, mkdir, writeFile, appendFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { readCodexActivity } from '../src/codex-monitor.mjs'

const event = (now, payload) => JSON.stringify({ type: 'event_msg', timestamp: new Date(now).toISOString(), payload }) + '\n'

async function fixture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'whale-goals-'))
  await mkdir(path.join(home, 'sessions'))
  const state = new DatabaseSync(path.join(home, 'state_5.sqlite'))
  state.exec('CREATE TABLE threads(id TEXT PRIMARY KEY, rollout_path TEXT, cwd TEXT, title TEXT, name TEXT, updated_at INTEGER, updated_at_ms INTEGER, archived INTEGER)')
  const goals = new DatabaseSync(path.join(home, 'goals_1.sqlite'))
  goals.exec('CREATE TABLE thread_goals(thread_id TEXT PRIMARY KEY, status TEXT, updated_at_ms INTEGER)')
  return { home, state, goals, async close() { state.close(); goals.close(); await rm(home, { recursive: true, force: true }) } }
}

test('an ongoing goal outside the recent 200 tasks uses its latest database log path', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    const current = path.join(f.home, 'sessions', 'current.jsonl')
    const stale = path.join(f.home, 'sessions', 'stale.jsonl')
    await writeFile(current, event(now - 2000, { type: 'task_started' }) + event(now - 1000, { type: 'item_completed', item: { type: 'CommandExecution', command: 'npm test' } }))
    await writeFile(stale, event(now - 1000, { type: 'task_complete' }))
    const insert = f.state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,0)')
    insert.run('long-goal', current, path.join(f.home, 'target-project'), 'Long goal', null, 1, 1000)
    for (let index = 0; index < 205; index++) insert.run(`recent-${index}`, '', '', 'Recent', null, now / 1000, now)
    f.goals.prepare('INSERT INTO thread_goals VALUES(?,?,?)').run('long-goal', 'active', now)
    const result = await readCodexActivity([{ id: 'long-goal', path: stale }], now, { home: f.home, isRunning: async () => true })
    assert.equal(result.threadId, 'long-goal')
    assert.equal(result.phase, 'testing')
    assert.equal(result.project, 'target-project')
    assert.equal(result.goalCount, 1)
  } finally { await f.close() }
})

test('goal gaps remain visible, pause is not work, and completed goals do not stay active in cache', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    const log = path.join(f.home, 'sessions', 'goal.jsonl')
    await writeFile(log, event(now - 30000, { type: 'task_complete' }))
    f.state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,0)').run('goal', log, '', 'Goal', null, 1, 1000)
    f.goals.prepare('INSERT INTO thread_goals VALUES(?,?,?)').run('goal', 'active', now)
    const cached = [{ id: 'goal', path: log, updatedAt: 1, goalStatus: 'active' }]
    assert.equal((await readCodexActivity(cached, now, { home: f.home, isRunning: async () => true })).phase, 'goal')
    f.goals.exec("UPDATE thread_goals SET status='paused'")
    const paused = await readCodexActivity(cached, now, { home: f.home, isRunning: async () => true })
    assert.equal(paused.phase, 'waiting')
    assert.equal(paused.description, '目标已暂停')
    f.goals.exec("UPDATE thread_goals SET status='complete'")
    assert.equal((await readCodexActivity(cached, now, { home: f.home, isRunning: async () => true })).phase, 'idle')
  } finally { await f.close() }
})

test('missing task-start in a tailed log still recognizes work and appended completion', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    const log = path.join(f.home, 'sessions', 'tail.jsonl')
    await writeFile(log, event(now - 1000, { type: 'item_completed', item: { type: 'Reasoning' } }))
    f.state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,0)').run('task', log, '', 'Task', null, now / 1000, now)
    assert.equal((await readCodexActivity([], now, { home: f.home, isRunning: async () => true })).phase, 'thinking')
    await appendFile(log, event(now, { type: 'task_complete' }))
    assert.equal((await readCodexActivity([], now, { home: f.home, isRunning: async () => true })).phase, 'completed')
  } finally { await f.close() }
})

test('pausing a goal overrides its unfinished old turn, but a later manual turn can run', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    const log = path.join(f.home, 'sessions', 'paused.jsonl')
    await writeFile(log, event(now - 2000, { type: 'task_started' }))
    f.state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,0)').run('goal', log, '', 'Goal', null, now / 1000, now)
    f.goals.prepare('INSERT INTO thread_goals VALUES(?,?,?)').run('goal', 'paused', now)
    assert.equal((await readCodexActivity([], now, { home: f.home, isRunning: async () => true })).description, '目标已暂停')
    await appendFile(log, event(now + 1000, { type: 'task_started' }))
    assert.equal((await readCodexActivity([], now + 2000, { home: f.home, isRunning: async () => true })).phase, 'thinking')
  } finally { await f.close() }
})

test('closing Codex hides unfinished goals and stale turns; reopening restores monitoring', async () => {
  const f = await fixture()
  try {
    const now = Date.now()
    const log = path.join(f.home, 'sessions', 'exit.jsonl')
    await writeFile(log, event(now, { type: 'task_started' }))
    f.state.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,0)').run('goal', log, '', 'Goal', null, now / 1000, now)
    f.goals.prepare('INSERT INTO thread_goals VALUES(?,?,?)').run('goal', 'active', now)
    let running = true
    const options = { home: f.home, isRunning: async () => running }
    assert.equal((await readCodexActivity([], now, options)).phase, 'thinking')
    running = false
    assert.equal((await readCodexActivity([], now, options)).phase, 'idle')
    await appendFile(log, event(now, { type: 'task_complete' }))
    assert.equal((await readCodexActivity([], now, options)).goalCount, 0)
    running = true
    assert.equal((await readCodexActivity([], now, options)).phase, 'goal')
  } finally { await f.close() }
})
