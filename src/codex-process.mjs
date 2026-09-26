import { execFile } from 'node:child_process'
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

export async function isCodexRunning() {
  try {
    let rows
    if (process.platform === 'win32') {
      const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress'], { windowsHide: true, timeout: 4000, maxBuffer: 4 * 1024 * 1024 })
      const parsed = JSON.parse(stdout)
      rows = (Array.isArray(parsed) ? parsed : [parsed]).map(p => ({ pid: p.ProcessId, ppid: p.ParentProcessId, command: p.Name }))
    } else {
      const { stdout } = await execute('ps', ['-axo', 'pid=,ppid=,comm='], { timeout: 4000, maxBuffer: 4 * 1024 * 1024 })
      rows = stdout.split('\n').flatMap(line => {
        const match = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/)
        return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), command: match[3] }] : []
      })
    }
    return hasCodexProcess(rows)
  } catch { return false }
}
