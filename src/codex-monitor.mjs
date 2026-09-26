import { open, realpath, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const sessionsRoot = path.resolve(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions')
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
    if (payload.type === 'task_started') return { ...state, active: true, phase: 'thinking', updatedAt: timestamp }
    if (payload.type === 'task_complete') return { ...state, active: false, phase: 'completed', updatedAt: timestamp }
    if (payload.type === 'task_failed') return { ...state, active: false, phase: 'error', updatedAt: timestamp }
    if (payload.type === 'turn_aborted') return { ...state, active: false, phase: 'idle', updatedAt: timestamp }
    if (!state.active || payload.type !== 'item_completed') return state
    const item = payload.item || {}
    let phase
    if (item.status === 'failed' || item.status === 'error') phase = 'error'
    else if (item.type === 'Reasoning') phase = 'thinking'
    else if (item.type === 'FileChange') phase = 'editing'
    else if (item.type === 'CommandExecution') phase = commandPhase(item.command)
    else if (item.type === 'ImageView' || item.type === 'Extension') phase = 'searching'
    else if (item.type === 'McpToolCall') phase = 'running'
    return phase ? { ...state, phase, updatedAt: timestamp } : state
  }
  if (entry?.type === 'response_item' && state.active && (payload.type === 'custom_tool_call' || payload.type === 'function_call')) {
    const input = String(payload.input || payload.arguments || '').slice(0, 6000)
    const phase = /request_user_input(?!_async)|requestApproval/i.test(`${payload.name || ''} ${input}`) ? 'waiting' : commandPhase(input)
    return { ...state, phase, updatedAt: timestamp }
  }
  return state
}

async function readRollout(filePath) {
  if (typeof filePath !== 'string') return null
  const resolved = path.resolve(filePath)
  if (!resolved.startsWith(`${sessionsRoot}${path.sep}`) || !resolved.endsWith('.jsonl')) return null
  let actual
  try { actual = await realpath(resolved) } catch { return null }
  if (!actual.startsWith(`${sessionsRoot}${path.sep}`)) return null
  const info = await stat(actual)
  if (!info.isFile()) return null
  let cached = fileStates.get(actual)
  if (!cached || info.size < cached.offset || info.size - cached.offset > 8 * 1024 * 1024) {
    cached = { offset: Math.max(0, info.size - 8 * 1024 * 1024), pending: '', state: { active: false, phase: 'idle', updatedAt: 0 } }
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
  if (cached.offset - Buffer.byteLength(chunk) > 0 && !cached.pending && !chunk.startsWith('{')) chunk = chunk.slice(chunk.indexOf('\n') + 1)
  const lines = `${cached.pending}${chunk}`.split('\n')
  cached.pending = lines.pop() || ''
  for (const line of lines) {
    if (!line) continue
    try { cached.state = reduceCodexEvent(cached.state, JSON.parse(line)) } catch {}
  }
  return cached.state
}

export async function readCodexActivity(threads, now = Date.now()) {
  const entries = await Promise.all((threads || []).map(async (thread) => {
    try {
      const state = await readRollout(thread.path)
      return state ? { ...state, threadId: thread.id, title: thread.title } : null
    } catch { return null }
  }))
  const available = entries.filter(Boolean)
  const active = available.filter((entry) => entry.active && now - entry.updatedAt < 10 * 60 * 1000)
  const priority = { waiting: 7, error: 6, testing: 5, running: 4, editing: 3, searching: 2, thinking: 1 }
  active.sort((a, b) => (priority[b.phase] || 0) - (priority[a.phase] || 0) || b.updatedAt - a.updatedAt)
  if (active.length) return { phase: active[0].phase, threadId: active[0].threadId, title: active[0].title, activeCount: active.length }
  const recent = available.filter((entry) => ['completed', 'error'].includes(entry.phase) && now - entry.updatedAt < 8000).sort((a, b) => b.updatedAt - a.updatedAt)
  if (recent.length) return { phase: recent[0].phase, threadId: recent[0].threadId, title: recent[0].title, activeCount: 0 }
  return { phase: 'idle', threadId: null, title: null, activeCount: 0 }
}
