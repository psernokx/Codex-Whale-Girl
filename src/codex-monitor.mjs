import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { readCodexLocalIndex, defaultCodexHome } from './codex-local-index.mjs'

const fileStates = new Map()

function commandPhase(value) {
  const text = Array.isArray(value) ? value.join(' ') : String(value || '')
  if (/\b(?:npm|pnpm|yarn|node|python\d*|pytest|cargo|go)\s+(?:run\s+)?(?:--test|test)\b|\b(?:vitest|jest|swift\s+test|xcodebuild\s+test)\b/i.test(text)) return 'testing'
  if (/apply_patch|\b(?:writeFile|mkdir|cp|mv|sed\s+-i)\b/i.test(text)) return 'editing'
  if (/\b(?:rg|grep|find|ls|cat|head|tail)\b|readFile|web__run/i.test(text)) return 'searching'
  return 'running'
}

export function reduceCodexEvent(state, entry) {
  const payload = entry?.payload || {}
  const timestamp = Date.parse(entry?.timestamp || '') || Date.now()
  if (entry?.type === 'event_msg') {
    if (payload.type === 'task_started') return { ...state, active: true, lifecycleSeen: true, phase: 'thinking', updatedAt: timestamp }
    if (payload.type === 'task_complete') return { ...state, active: false, lifecycleSeen: true, phase: 'completed', updatedAt: timestamp }
    if (payload.type === 'task_failed') return { ...state, active: false, lifecycleSeen: true, phase: 'error', updatedAt: timestamp }
    if (payload.type === 'turn_aborted') return { ...state, active: false, lifecycleSeen: true, phase: 'idle', updatedAt: timestamp }
    if ((!state.active && state.lifecycleSeen) || payload.type !== 'item_completed') return state
    const item = payload.item || {}
    let phase
    if (item.status === 'failed' || item.status === 'error') phase = 'error'
    else if (item.type === 'Reasoning') phase = 'thinking'
    else if (item.type === 'FileChange') phase = 'editing'
    else if (item.type === 'CommandExecution') phase = commandPhase(item.command)
    else if (item.type === 'ImageView' || item.type === 'Extension') phase = 'searching'
    else if (item.type === 'McpToolCall') phase = 'running'
    return phase ? { ...state, active: true, phase, updatedAt: timestamp } : state
  }
  if (entry?.type === 'response_item' && (state.active || !state.lifecycleSeen) && (payload.type === 'custom_tool_call' || payload.type === 'function_call')) {
    const input = String(payload.input || payload.arguments || '').slice(0, 6000)
    const phase = /request_user_input(?!_async)|requestApproval/i.test(`${payload.name || ''} ${input}`) ? 'waiting' : commandPhase(input)
    return { ...state, active: true, phase, updatedAt: timestamp }
  }
  return state
}

async function readRollout(filePath, home) {
  if (typeof filePath !== 'string') return null
  const resolved = path.resolve(filePath)
  if (!resolved.endsWith('.jsonl')) return null
  let actual, sessionsRoot
  try { [actual, sessionsRoot] = await Promise.all([realpath(resolved), realpath(path.resolve(home, 'sessions'))]) } catch { return null }
  if (!actual.startsWith(`${sessionsRoot}${path.sep}`)) return null
  const info = await stat(actual)
  if (!info.isFile()) return null
  let cached = fileStates.get(actual)
  if (!cached || info.size < cached.offset || info.size - cached.offset > 32 * 1024 * 1024) {
    cached = { offset: Math.max(0, info.size - 32 * 1024 * 1024), pending: '', skipPartialLine: info.size > 32 * 1024 * 1024, state: { active: false, phase: 'idle', updatedAt: 0 } }
    fileStates.set(actual, cached)
  }
  const size = info.size - cached.offset
  if (!size) return cached.state
  const handle = await open(actual, 'r')
  let chunk
  try {
    const buffer = Buffer.alloc(size)
    const { bytesRead } = await handle.read(buffer, 0, size, cached.offset)
    chunk = buffer.subarray(0, bytesRead).toString('utf8')
    cached.offset += bytesRead
  } finally { await handle.close() }
  if (cached.skipPartialLine) {
    const newline = chunk.indexOf('\n')
    if (newline < 0) return cached.state
    chunk = chunk.slice(newline + 1)
    cached.skipPartialLine = false
  }
  const lines = `${cached.pending}${chunk}`.split('\n')
  cached.pending = lines.pop() || ''
  for (const line of lines) {
    if (!line) continue
    try { cached.state = reduceCodexEvent(cached.state, JSON.parse(line)) } catch {}
  }
  return cached.state
}

export async function readCodexActivity(fallbackThreads = [], now = Date.now(), { home = defaultCodexHome() } = {}) {
  const local = await readCodexLocalIndex(home)
  const index = new Map(fallbackThreads.map((thread) => [thread.id, local.available ? { ...thread, goalStatus: null, goalUpdatedAt: 0 } : thread]))
  // Local database paths supersede stale paths returned by the app server.
  for (const thread of local.threads) index.set(thread.id, { ...index.get(thread.id), ...thread })
  const threads = [...index.values()]
  const entries = await Promise.all(threads.filter((thread) => thread.goalStatus || !thread.updatedAt || now - thread.updatedAt * 1000 < 10 * 60 * 1000).map(async (thread) => {
    let state
    try { state = await readRollout(thread.path, home) } catch { /* Keep goal metadata even if its log is unavailable. */ }
    return { ...state, threadId: thread.id, title: thread.title, project: thread.project,
      goalStatus: thread.goalStatus, goalUpdatedAt: thread.goalUpdatedAt }
  }))
  const active = entries.filter((entry) => entry.active && now - entry.updatedAt < 10 * 60 * 1000
    && !(['paused', 'blocked', 'usage_limited', 'budget_limited'].includes(entry.goalStatus) && entry.goalUpdatedAt >= entry.updatedAt))
  const priority = { waiting: 7, error: 6, testing: 5, running: 4, editing: 3, searching: 2, thinking: 1 }
  active.sort((a, b) => Number(b.goalStatus === 'active') - Number(a.goalStatus === 'active') || (priority[b.phase] || 0) - (priority[a.phase] || 0) || b.updatedAt - a.updatedAt)
  const goals = entries.filter((entry) => entry.goalStatus === 'active')
  const activeCount = new Set([...active, ...goals].map((entry) => entry.threadId)).size
  const result = (entry, overrides = {}) => ({ phase: entry.phase, threadId: entry.threadId, title: entry.title,
    project: entry.project || '', activeCount, goalCount: goals.length, goalStatus: entry.goalStatus || null, ...overrides })
  if (active.length) return result(active[0])
  if (goals.length) {
    goals.sort((a, b) => b.goalUpdatedAt - a.goalUpdatedAt)
    return result(goals[0], { phase: 'goal', description: '目标进行中', detail: '等待下一轮继续' })
  }
  const waiting = entries.filter((entry) => ['paused', 'blocked', 'usage_limited', 'budget_limited'].includes(entry.goalStatus))
    .sort((a, b) => b.goalUpdatedAt - a.goalUpdatedAt)
  if (waiting.length) return result(waiting[0], { phase: 'waiting', description: waiting[0].goalStatus === 'paused' ? '目标已暂停' : waiting[0].goalStatus === 'blocked' ? '目标需要处理' : '等待额度恢复' })
  const recent = entries.filter((entry) => ['completed', 'error'].includes(entry.phase) && now - entry.updatedAt < 8000).sort((a, b) => b.updatedAt - a.updatedAt)
  if (recent.length) return result(recent[0])
  return { phase: 'idle', threadId: null, title: null, activeCount: 0, goalCount: 0 }
}
