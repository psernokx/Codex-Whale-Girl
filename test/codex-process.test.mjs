import test from 'node:test'
import assert from 'node:assert/strict'
import { hasCodexProcess } from '../src/codex-process.mjs'

test('quota helper descendants cannot keep the pet working after Codex exits', () => {
  const helpers = [{ pid: 2, ppid: 1, command: 'node' }, { pid: 3, ppid: 2, command: '/app/codex' }]
  assert.equal(hasCodexProcess(helpers, 1), false)
  for (const command of ['/Applications/ChatGPT.app/Contents/MacOS/ChatGPT', 'Codex.exe', '/usr/bin/codex']) {
    assert.equal(hasCodexProcess([...helpers, { pid: 4, ppid: 0, command }], 1), true)
  }
  assert.equal(hasCodexProcess([{ pid: 4, ppid: 0, command: 'Codex Helper.exe' }], 1), false)
})
