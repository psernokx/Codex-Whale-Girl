import { execFile } from 'node:child_process'
import { readlink } from 'node:fs/promises'
import { promisify } from 'node:util'
const execute = promisify(execFile)

// Ignore our own quota/preview helpers and every descendant they launch.
export function hasCodexProcess(rows, ownPid = process.pid) {
  const excluded = new Set([ownPid])
  for (let changed = true; changed;) {
    changed = false
    for (const row of rows) if (excluded.has(row.ppid) && !excluded.has(row.pid)) {
      excluded.add(row.pid); changed = true
    }
  }
  return rows.some(({ pid, command }) => !excluded.has(pid) && (
    /(?:^|[/\\])(?:codex|codex-cli)(?:\.exe)?$/i.test(command.trim()) ||
    /[/\\](?:Codex|ChatGPT)\.app[/\\]Contents[/\\]MacOS[/\\](?:Codex|ChatGPT)$/i.test(command.trim())
  ))
}

export async function readCodexProcesses({ platform = process.platform, run = execute, link = readlink } = {}) {
  try {
    let rows
    if (platform === 'win32') {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 })
      const parsed = JSON.parse(stdout)
      rows = (Array.isArray(parsed) ? parsed : [parsed]).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, command: p.ExecutablePath || p.Name }))
    } else {
      const { stdout } = await run('ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 })
      rows = stdout.split('\n').flatMap(line => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
        return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : []
      })
    }
    if (platform === 'linux') rows = await Promise.all(rows.map(async row => {
      if (!hasCodexProcess([row], -1)) return row
      try { return { ...row, command: await link(`/proc/${row.pid}/exe`) } } catch { return row }
    }))
    return rows
  } catch { return [] }
}

export async function isCodexRunning() {
  return hasCodexProcess(await readCodexProcesses())
}
