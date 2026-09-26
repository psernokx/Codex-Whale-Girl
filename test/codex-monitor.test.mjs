import test from 'node:test'
import assert from 'node:assert/strict'
import { reduceCodexEvent } from '../src/codex-monitor.mjs'

const at = (seconds, type, payload) => ({ timestamp: new Date(seconds * 1000).toISOString(), type, payload })

test('Codex task events drive distinct work phases and completion', () => {
  let state = { active: false, phase: 'idle', updatedAt: 0 }
  state = reduceCodexEvent(state, at(1, 'event_msg', { type: 'task_started' }))
  assert.equal(state.phase, 'thinking')
  state = reduceCodexEvent(state, at(2, 'event_msg', { type: 'item_completed', item: { type: 'CommandExecution', command: ['rg', 'needle', 'src'] } }))
  assert.equal(state.phase, 'searching')
  state = reduceCodexEvent(state, at(3, 'event_msg', { type: 'item_completed', item: { type: 'FileChange' } }))
  assert.equal(state.phase, 'editing')
  state = reduceCodexEvent(state, at(4, 'event_msg', { type: 'item_completed', item: { type: 'CommandExecution', command: ['npm', 'test'] } }))
  assert.equal(state.phase, 'testing')
  state = reduceCodexEvent(state, at(5, 'event_msg', { type: 'task_complete' }))
  assert.deepEqual({ active: state.active, phase: state.phase }, { active: false, phase: 'completed' })
})

test('only an explicit approval or input request enters waiting', () => {
  let state = reduceCodexEvent({ active: false, phase: 'idle', updatedAt: 0 }, at(1, 'event_msg', { type: 'task_started' }))
  state = reduceCodexEvent(state, at(2, 'response_item', { type: 'custom_tool_call', name: 'exec', input: 'tools.exec_command({cmd:"node app.js"})' }))
  assert.equal(state.phase, 'running')
  state = reduceCodexEvent(state, at(3, 'response_item', { type: 'custom_tool_call', name: 'request_user_input', input: 'request_user_input({})' }))
  assert.equal(state.phase, 'waiting')
})

test('an explicitly failed tool shows error until the task resumes', () => {
  let state = reduceCodexEvent({ active: false, phase: 'idle', updatedAt: 0 }, at(1, 'event_msg', { type: 'task_started' }))
  state = reduceCodexEvent(state, at(2, 'event_msg', { type: 'item_completed', item: { type: 'FileChange', status: 'failed' } }))
  assert.equal(state.phase, 'error')
  state = reduceCodexEvent(state, at(3, 'event_msg', { type: 'item_completed', item: { type: 'Reasoning' } }))
  assert.equal(state.phase, 'thinking')
})
