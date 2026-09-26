import readline from 'node:readline'
import { spawnCodexServer } from './codex-runtime.mjs'

function quotaWindow(value) {
  if (!value || !Number.isFinite(value.usedPercent)) return null
  return {
    usedPercent: Math.min(100, Math.max(0, value.usedPercent)),
    windowDurationMins: Number(value.windowDurationMins) || null,
    resetsAt: Number(value.resetsAt) || null,
  }
}

function normalize(limits, usage) {
  const codex = limits?.rateLimitsByLimitId?.codex || limits?.rateLimits || {}
  const summary = usage?.summary || {}
  const daily = Array.isArray(usage?.dailyUsageBuckets) ? usage.dailyUsageBuckets : []
  return {
    primary: quotaWindow(codex.primary),
    secondary: quotaWindow(codex.secondary),
    lifetimeTokens: Number.isFinite(summary.lifetimeTokens) ? summary.lifetimeTokens : null,
    currentStreakDays: Number.isFinite(summary.currentStreakDays) ? summary.currentStreakDays : null,
    dailyUsage: daily.slice(-7).map(({ startDate, tokens }) => ({
      startDate: String(startDate || ''),
      tokens: Number.isFinite(tokens) ? tokens : 0,
    })),
    fetchedAt: Date.now(),
  }
}

export async function readCodexUsage() {
  const child = await spawnCodexServer()
  return new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout })
    const responses = new Map()
    let finished = false
    const timeout = setTimeout(() => finish(new Error('读取 Codex 用量超时')), 15000)

    function finish(error, result) {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      lines.close()
      child.kill()
      if (error) reject(error)
      else resolve(result)
    }

    function send(message) {
      child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    child.stdin.on('error', () => finish(new Error('Codex 用量连接已关闭')))
    child.on('error', () => finish(new Error('无法启动 Codex 程序')))
    child.on('exit', () => finish(new Error('Codex 用量服务提前退出')))
    lines.on('line', (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error('无法连接 Codex 用量服务'))
        send({ method: 'initialized', params: {} })
        send({ method: 'account/rateLimits/read', id: 2 })
        send({ method: 'account/usage/read', id: 3 })
        return
      }
      if (message.id !== 2 && message.id !== 3) return
      if (message.error && message.id === 2) return finish(new Error('无法读取 Codex 额度，请检查登录状态'))
      // Token history is optional and unavailable in some Codex CLI versions.
      responses.set(message.id, message.result)
      if (responses.has(2) && responses.has(3)) finish(null, normalize(responses.get(2), responses.get(3)))
    })
    send({
      method: 'initialize', id: 1,
      params: { clientInfo: { name: 'whale_girl_dashboard', title: 'Whale Girl Dashboard', version: '1.8.0' } },
    })
  })
}
