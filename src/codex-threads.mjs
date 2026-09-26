import readline from 'node:readline'
import { spawnCodexServer } from './codex-runtime.mjs'

function shortText(value, length = 120) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, length)
}

function latestUserMessage(turns) {
  for (const turn of turns || []) {
    for (const item of turn.items || []) {
      if (item.type !== 'userMessage') continue
      const text = (item.content || []).filter((part) => part.type === 'text').map((part) => part.text).join(' ')
      if (text.trim()) return shortText(text)
    }
  }
  return ''
}

export async function readCodexThreads() {
  const child = await spawnCodexServer()
  return new Promise((resolve, reject) => {
    const lines = readline.createInterface({ input: child.stdout })
    const previews = new Map()
    let threads = []
    let finished = false
    const timeout = setTimeout(() => finish(new Error('读取 Codex 对话超时')), 15000)

    function finish(error) {
      if (finished) return
      finished = true
      clearTimeout(timeout)
      lines.close()
      child.kill()
      if (error) return reject(error)
      resolve(threads.map((thread, index) => ({
        id: thread.id,
        title: shortText(thread.name || thread.preview || '未命名对话', 60),
        preview: previews.get(index) || shortText(thread.preview),
        updatedAt: Number(thread.updatedAt) || null,
        path: typeof thread.path === 'string' ? thread.path : null,
      })))
    }

    function send(message) { child.stdin.write(`${JSON.stringify(message)}\n`) }

    child.stdin.on('error', () => finish(new Error('Codex 对话连接已关闭')))
    child.on('error', () => finish(new Error('无法启动 Codex 程序')))
    child.on('exit', () => finish(new Error('Codex 对话服务提前退出')))
    lines.on('line', (line) => {
      let message
      try { message = JSON.parse(line) } catch { return }
      if (message.id === 1) {
        if (message.error) return finish(new Error('无法连接 Codex 对话服务'))
        send({ method: 'initialized', params: {} })
        send({ method: 'thread/list', id: 2, params: {
          limit: 6, sortKey: 'updated_at', sortDirection: 'desc',
          sourceKinds: ['appServer', 'cli', 'vscode'],
          useStateDbOnly: true,
        } })
      } else if (message.id === 2) {
        if (message.error) return finish(new Error('无法读取 Codex 对话'))
        threads = (message.result?.data || []).filter((thread) => typeof thread.id === 'string').slice(0, 6)
        if (!threads.length) return finish()
        threads.forEach((thread, index) => send({ method: 'thread/turns/list', id: index + 3, params: {
          threadId: thread.id, limit: 3, sortDirection: 'desc', itemsView: 'summary',
        } }))
      } else if (message.id >= 3 && message.id < 3 + threads.length) {
        previews.set(message.id - 3, latestUserMessage(message.result?.data))
        if (previews.size === threads.length) finish()
      }
    })
    send({ method: 'initialize', id: 1, params: {
      clientInfo: { name: 'whale_girl_dashboard', title: 'Whale Girl Dashboard', version: '1.8.0' },
      capabilities: { experimentalApi: true },
    } })
  })
}
