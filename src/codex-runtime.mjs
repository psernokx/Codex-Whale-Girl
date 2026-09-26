import { readCodexProcesses } from './codex-process.mjs'
import { spawn } from 'node:child_process'
import { access, realpath, stat } from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function codexCandidates({ platform = process.platform, env = process.env, home = os.homedir() } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const candidates = [env.CODEX_BINARY]
  if (platform === 'darwin') candidates.push(
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    paths.join(home, 'Applications/Codex.app/Contents/Resources/codex'),
  )
  if (platform === 'darwin') {
    for (const app of ['/Applications/Codex.app', '/Applications/ChatGPT.app', paths.join(home, 'Applications/Codex.app'), paths.join(home, 'Applications/ChatGPT.app')]) {
      candidates.push(paths.join(app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'), paths.join(app, 'Contents/Resources/codex-cli/bin/codex'))
    }
  }
  if (platform === 'win32') {
    for (const base of [env.LOCALAPPDATA, env.ProgramFiles].filter(Boolean)) candidates.push(paths.join(base, 'Codex', 'resources', 'codex.exe'))
  }
  if (platform === 'linux') candidates.push('/opt/Codex/resources/codex', '/opt/codex/resources/codex')
  const names = platform === 'win32' ? ['codex.exe', 'codex.cmd'] : ['codex']
  const directories = String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':').filter(Boolean)
  if (platform === 'win32') {
    if (env.APPDATA) directories.push(paths.join(env.APPDATA, 'npm'))
    if (env.LOCALAPPDATA) directories.push(paths.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps'))
  } else {
    directories.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', paths.join(home, '.local/bin'), paths.join(home, '.npm-global/bin'))
  }
  for (const directory of directories) for (const name of names) candidates.push(paths.join(directory.replace(/^"|"$/g, ''), name))
  return [...new Set(candidates.filter(Boolean))]
}

export function candidatesFromProcesses(rows, platform = process.platform) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const candidates = []
  for (const { command } of rows) {
    if (!paths.isAbsolute(command)) continue
    if (platform === 'darwin') {
      const app = command.match(/^(.*?\.app)\/Contents\//)?.[1]
      if (app && /\/(?:Codex|ChatGPT)\.app$/i.test(app)) {
        candidates.push(paths.join(app, 'Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex'), paths.join(app, 'Contents/Resources/codex'), paths.join(app, 'Contents/Resources/codex-cli/bin/codex'))
      }
      if (/\/codex$/.test(command)) candidates.push(command)
    } else {
      const name = paths.basename(command)
      if (!/^(?:codex|codex-cli)(?:\.exe)?$/i.test(name)) continue
      const directory = paths.dirname(command)
      const cli = platform === 'win32' ? 'codex.exe' : 'codex'
      candidates.push(paths.join(directory, 'resources', cli), paths.join(directory, 'resources', 'codex-cli', 'bin', cli))
      // Capitalized Codex is the desktop app, not the CLI server.
      if (name === cli || name === 'codex-cli') candidates.push(command)
    }
  }
  return [...new Set(candidates)]
}

export async function resolveCodex(options = {}) {
  const platform = options.platform || process.platform
  const env = options.env || process.env
  const rows = options.processes ?? (env.CODEX_BINARY ? [] : await readCodexProcesses({ platform }).catch(() => []))
  const candidates = [env.CODEX_BINARY, ...candidatesFromProcesses(rows, platform), ...codexCandidates(options)].filter(Boolean)
  for (const candidate of new Set(candidates)) {
    try {
      await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      // Store execution aliases on Windows can have zero-sized placeholder files.
      if (!(await stat(candidate)).isFile()) continue
      let entry = await realpath(candidate)
      if (/\.(cmd|bat)$/i.test(entry)) {
        // Execute npm's JS entry directly. Never interpolate a shim path into cmd.exe.
        entry = path.join(path.dirname(entry), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
        await access(entry)
      }
      if (/\.[cm]?js$/i.test(entry)) {
        return { command: process.execPath, args: [entry, 'app-server'], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
      }
      return { command: entry, args: ['app-server'], env: process.env }
    } catch { /* Try the next installation location. */ }
  }
  throw new Error('找不到 Codex：请安装并登录 Codex CLI，或用 CODEX_BINARY 指定可执行文件路径')
}

export async function spawnCodexServer() {
  const runtime = await resolveCodex()
  // Read-only helpers must never execute the user's turn notification hook.
  const args = [...runtime.args.slice(0, -1), '-c', 'notify=[]', '-c', 'tui.notifications=false', 'app-server']
  return spawn(runtime.command, args, {
    env: runtime.env, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true,
  })
}
