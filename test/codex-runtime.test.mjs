import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { codexCandidates, resolveCodex } from '../src/codex-runtime.mjs'

test('discovers CLI locations across macOS, Linux and Windows', () => {
  const mac = codexCandidates({ platform: 'darwin', env: { PATH: '/custom/bin' }, home: '/example' })
  assert.ok(mac.includes('/Applications/Codex.app/Contents/Resources/codex'))
  assert.ok(mac.includes('/custom/bin/codex'))
  assert.ok(mac.includes('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'))
  const linux = codexCandidates({ platform: 'linux', env: {}, home: '/example' })
  assert.ok(linux.includes('/example/.local/bin/codex'))
  assert.ok(!linux.some((entry) => entry.startsWith('/Applications/')))
  const win = codexCandidates({ platform: 'win32', env: { Path: 'C:\\CLI;D:\\Tools', APPDATA: 'C:\\Data' }, home: 'C:\\Home' })
  assert.ok(win.includes('C:\\CLI\\codex.exe'))
  assert.ok(win.includes('D:\\Tools\\codex.cmd'))
  assert.ok(win.includes('C:\\Data\\npm\\codex.cmd'))
})

test('explicit executable path is preserved even with spaces', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'whale runtime '))
  try {
    const executable = path.join(temp, 'codex.exe')
    await writeFile(executable, 'fixture')
    await chmod(executable, 0o755)
    const runtime = await resolveCodex({ env: { CODEX_BINARY: executable, PATH: '' }, home: temp })
    assert.equal(runtime.command, await import('node:fs/promises').then((fs) => fs.realpath(executable)))
    assert.deepEqual(runtime.args, ['app-server'])
  } finally { await rm(temp, { recursive: true, force: true }) }
})

test('npm Windows launcher runs directly without a command shell', async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), 'whale npm '))
  try {
    const shim = path.join(temp, 'codex.cmd')
    const entry = path.join(temp, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
    await mkdir(path.dirname(entry), { recursive: true })
    await writeFile(shim, '@echo off')
    await writeFile(entry, '// fixture')
    const runtime = await resolveCodex({ platform: 'win32', env: { CODEX_BINARY: shim, PATH: '' }, home: temp })
    assert.equal(runtime.command, process.execPath)
    assert.equal(path.basename(runtime.args[0]), 'codex.js')
    assert.equal(runtime.args[1], 'app-server')
    assert.equal(runtime.env.ELECTRON_RUN_AS_NODE, '1')
  } finally { await rm(temp, { recursive: true, force: true }) }
})
