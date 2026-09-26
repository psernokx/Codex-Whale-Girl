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

test('Linux resolves matching executable links without reading command arguments', async () => {
  const { readCodexProcesses } = await import('../src/codex-process.mjs')
  const rows = await readCodexProcesses({ platform: 'linux', run: async (_command, args) => {
    assert.deepEqual(args, ['-axo', 'pid=,ppid=,comm='])
    return { stdout: ' 11 1 codex\n 12 1 unrelated\n' }
  }, link: async p => { assert.equal(p, '/proc/11/exe'); return '/custom/codex' } })
  assert.equal(rows[0].command, '/custom/codex')
})

test('Windows requests executable paths, never process command lines', async () => {
  const { readCodexProcesses } = await import('../src/codex-process.mjs')
  const rows = await readCodexProcesses({ platform: 'win32', run: async (_command, args) => {
    assert.ok(args.at(-1).includes('ExecutablePath'))
    assert.ok(!args.at(-1).includes('CommandLine'))
    return { stdout: JSON.stringify({ ProcessId: 11, ParentProcessId: 1, Name: 'codex.exe', ExecutablePath: 'D:\\CLI\\codex.exe' }) }
  } })
  assert.equal(rows[0].command, 'D:\\CLI\\codex.exe')
})
