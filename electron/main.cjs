const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, safeStorage, shell, screen } = require('electron')
const { randomUUID } = require('node:crypto')
const path = require('node:path')
const fs = require('node:fs/promises')
const { pathToFileURL } = require('node:url')

const smokeMode = process.argv.includes('--smoke-test')
const codexSmokeMode = process.argv.includes('--codex-smoke-test')
const animationSmokeMode = process.argv.includes('--animation-smoke-test')
const COMPACT_SIZE = { width: 370, height: 360 }
const PANEL_SIZE = { width: 630, height: 520 }
const BUBBLE_SIZE = { width: 370, height: 620 }
const projectRoot = path.join(__dirname, '..')

if (smokeMode || codexSmokeMode || animationSmokeMode) app.setPath('userData', path.join(process.cwd(), '.smoke-user-data'))

let mainWindow
let tray
let quitting = false
let modules
let store
let configPath
let dragTimer = null
let dragAnchor = null
let chatInFlight = false
let lastChatAt = 0
let panelOpen = false
let bubbleExpanded = false
let codexUsageCache = null
let codexUsageFetchedAt = 0
let codexUsageInFlight = null
let codexThreadsCache = null
let codexThreadsFetchedAt = 0
let codexThreadsInFlight = null
let codexActivityTimer = null
let codexActivityPolling = false
let lastCodexActivityKey = ''
let codexMonitorFailures = 0

const defaultConfig = {
  alwaysOnTop: true,
  clickThrough: false,
  apiKeyEncrypted: '',
  pricing: {
    flash: { hit: 0.02, miss: 1, output: 2 },
    pro: { hit: 0.025, miss: 3, output: 6 },
  },
}

async function loadModules() {
  const root = path.join(__dirname, '..')
  const [pricing, summaryModule, storeModule, securityModule, chatModule, codexUsageModule, codexThreadsModule, codexMonitorModule] = await Promise.all([
    import(pathToFileURL(path.join(root, 'src', 'pricing.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'summary.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'store.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'security.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'chat.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'codex-usage.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'codex-threads.mjs')).href),
    import(pathToFileURL(path.join(root, 'src', 'codex-monitor.mjs')).href),
  ])
  modules = { ...pricing, ...summaryModule, ...storeModule, ...securityModule, ...chatModule, ...codexUsageModule, ...codexThreadsModule, ...codexMonitorModule }
}

async function getCodexUsage(force = false) {
  if (animationSmokeMode) return {
    primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: null },
    secondary: { usedPercent: 40, windowDurationMins: 10080, resetsAt: null },
    lifetimeTokens: null, currentStreakDays: null, dailyUsage: [], fetchedAt: Date.now(),
  }
  if (!force && codexUsageCache && Date.now() - codexUsageFetchedAt < 60_000) return codexUsageCache
  if (!codexUsageInFlight) {
    codexUsageInFlight = modules.readCodexUsage().then((value) => {
      codexUsageCache = value
      codexUsageFetchedAt = Date.now()
      return value
    }).finally(() => { codexUsageInFlight = null })
  }
  return codexUsageInFlight
}

async function getCodexThreads(force = false) {
  if (!force && codexThreadsCache && Date.now() - codexThreadsFetchedAt < 15_000) return codexThreadsCache
  if (!codexThreadsInFlight) {
    codexThreadsInFlight = modules.readCodexThreads().then((value) => {
      codexThreadsCache = value
      codexThreadsFetchedAt = Date.now()
      return value
    }).finally(() => { codexThreadsInFlight = null })
  }
  return codexThreadsInFlight
}

async function publishCodexActivity() {
  if (codexActivityPolling || !mainWindow || mainWindow.isDestroyed()) return
  codexActivityPolling = true
  try {
    const activity = await modules.readCodexActivity(await getCodexThreads())
    codexMonitorFailures = 0
    const key = `${activity.phase}:${activity.threadId}:${activity.activeCount}:${activity.title}`
    if (key !== lastCodexActivityKey) {
      lastCodexActivityKey = key
      mainWindow.webContents.send('whale:codex-activity', activity)
    }
  } catch {
    codexMonitorFailures++
    if (codexMonitorFailures >= 3 && lastCodexActivityKey !== 'idle') {
      lastCodexActivityKey = 'idle'
      mainWindow.webContents.send('whale:codex-activity', { phase: 'idle', threadId: null, title: null, activeCount: 0 })
    }
  }
  finally { codexActivityPolling = false }
}

async function readConfig() {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, 'utf8'))
    return {
      ...defaultConfig,
      ...parsed,
      pricing: {
        flash: { ...defaultConfig.pricing.flash, ...parsed?.pricing?.flash },
        pro: { ...defaultConfig.pricing.pro, ...parsed?.pricing?.pro },
      },
    }
  } catch {
    return structuredClone(defaultConfig)
  }
}

async function writeConfig(config) {
  await fs.mkdir(path.dirname(configPath), { recursive: true })
  const temp = `${configPath}.${process.pid}.tmp`
  await fs.writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
  await fs.rename(temp, configPath)
  await fs.chmod(configPath, 0o600).catch(() => {})
}

function decryptApiKey(config) {
  if (config.apiKeyEncrypted && safeStorage.isEncryptionAvailable()) {
    try { return safeStorage.decryptString(Buffer.from(config.apiKeyEncrypted, 'base64')) } catch {}
  }
  return ''
}

async function initializeSecureConfig() {
  const config = await readConfig()
  let changed = false
  if (config.integrationToken) { delete config.integrationToken; changed = true }
  if (config.apiKeyPlainFallback) {
    if (safeStorage.isEncryptionAvailable()) config.apiKeyEncrypted = safeStorage.encryptString(config.apiKeyPlainFallback).toString('base64')
    config.apiKeyPlainFallback = ''
    changed = true
  }
  if (config.animationMode) { delete config.animationMode; changed = true }
  if (config.monitor) { delete config.monitor; changed = true }
  if (changed) await writeConfig(config)
}

async function publicConfig() {
  const config = await readConfig()
  return {
    alwaysOnTop: config.alwaysOnTop,
    clickThrough: config.clickThrough,
    hasApiKey: Boolean(decryptApiKey(config)),
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    pricing: config.pricing,
  }
}

async function snapshot() {
  const [data, config] = await Promise.all([store.read(), readConfig()])
  const balance = data.balanceHistory.at(-1) || null
  return {
    balance,
    latest: data.records.at(-1) || null,
    summary: modules.summarize(data.records, config.pricing),
    records: data.records.slice(-12).reverse(),
  }
}

async function broadcastSnapshot() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('whale:snapshot', await snapshot())
}

async function recordUsage(input, source = 'loopback') {
  const config = await readConfig()
  const model = String(input.model || 'deepseek-v4-flash').slice(0, 80)
  const usage = modules.normalizeUsage(input.usage || input)
  if (usage.total <= 0) throw new Error('usage must contain at least one token')
  const { family, rates } = modules.resolveRates(model, config.pricing)
  const calculated = modules.calculateCost(usage, rates)
  const record = {
    id: randomUUID(),
    timestamp: Date.now(),
    source,
    model,
    family,
    usage,
    rates,
    cost: calculated.totalCost,
  }
  await store.update((data) => {
    data.records.push(record)
    if (data.records.length > 50_000) data.records.splice(0, data.records.length - 50_000)
    return data
  })
  await broadcastSnapshot()
  return record
}

async function refreshBalance() {
  const config = await readConfig()
  const apiKey = decryptApiKey(config)
  if (!apiKey) throw new Error('请先在设置中保存 DeepSeek API Key')
  const response = await fetch('https://api.deepseek.com/user/balance', {
    headers: { Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(`余额接口返回 HTTP ${response.status}`)
  const payload = await readResponseJson(response, 256 * 1024)
  const info = Array.isArray(payload.balance_infos) ? payload.balance_infos[0] : null
  const balance = {
    timestamp: Date.now(),
    available: Boolean(payload.is_available),
    currency: info?.currency || 'CNY',
    total: Number(info?.total_balance || 0),
    granted: Number(info?.granted_balance || 0),
    toppedUp: Number(info?.topped_up_balance || 0),
  }
  await store.update((data) => {
    data.balanceHistory.push(balance)
    if (data.balanceHistory.length > 366) data.balanceHistory.shift()
    return data
  })
  mainWindow?.webContents.send('whale:pet-state', { state: 'success', balance })
  await broadcastSnapshot()
  return balance
}

async function askWhale(question) {
  const now = Date.now()
  if (chatInFlight) throw new Error('小鲸鱼还在回答上一条问题，请稍等一下')
  if (now - lastChatAt < 1500) throw new Error('问得太快啦，让小鲸鱼喘口气～')
  const config = await readConfig()
  const apiKey = decryptApiKey(config)
  if (!apiKey) throw new Error('请先在设置中安全保存 DeepSeek API Key')
  const requestBody = modules.createChatRequest(question)
  chatInFlight = true
  lastChatAt = now
  emitPetState('working', { message: '让我甩甩鲸尾想一想…' })
  try {
    const response = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(requestBody),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) throw new Error(`问答接口返回 HTTP ${response.status}`)
    const result = modules.parseChatResponse(await readResponseJson(response, 1024 * 1024))
    if (result.usage) await recordUsage({ model: result.model, usage: result.usage }, 'pet-chat')
    emitPetState('chat', { message: result.answer })
    return result
  } finally {
    chatInFlight = false
  }
}

function emitPetState(state, detail = {}) {
  mainWindow?.webContents.send('whale:pet-state', { state, ...detail })
}

async function readResponseJson(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error('远端响应超过安全大小限制')
  if (!response.body) return {}
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let text = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new Error('远端响应超过安全大小限制')
    }
    text += decoder.decode(value, { stream: true })
  }
  text += decoder.decode()
  try { return text ? JSON.parse(text) : {} } catch { throw new Error('远端返回了无效 JSON') }
}

function applyWindowSize() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const target = panelOpen ? PANEL_SIZE : bubbleExpanded ? BUBBLE_SIZE : COMPACT_SIZE
  const bounds = mainWindow.getBounds()
  if (bounds.width === target.width && bounds.height === target.height) return
  mainWindow.setBounds({ x: bounds.x + bounds.width - target.width, y: bounds.y + bounds.height - target.height, ...target }, true)
}

function trayIcon() {
  const character = nativeImage.createFromPath(path.join(projectRoot, 'assets', 'whale', 'whale-maid.png'))
  if (!character.isEmpty()) return character
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect rx="9" width="32" height="32" fill="#0ea5e9"/><path d="M7 18c2.5 5 12.5 6 17-1-3 1-5-1-5-4-4 4-8 2-12 5Z" fill="white"/><circle cx="12" cy="15" r="1.5" fill="#0c4a6e"/></svg>`
  return nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`)
}

function createTray() {
  tray = new Tray(trayIcon().resize({ width: 20, height: 20 }))
  tray.setToolTip('小鲸鱼看板娘')
  const show = () => { mainWindow.show(); mainWindow.focus() }
  tray.on('click', show)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示小鲸鱼', click: show },
    { label: '刷新余额', click: () => refreshBalance().catch((error) => mainWindow.webContents.send('whale:pet-state', { state: 'error', message: error.message })) },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ]))
}

async function createWindow() {
  const config = await readConfig()
  mainWindow = new BrowserWindow({
    ...COMPACT_SIZE,
    icon: path.join(projectRoot, 'build', 'icons', 'icon.png'),
    transparent: true,
    frame: false,
    resizable: false,
    show: false,
    alwaysOnTop: config.alwaysOnTop,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  mainWindow.setMenuBarVisibility(false)
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href) event.preventDefault()
  })
  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  mainWindow.once('ready-to-show', () => {
    if (animationSmokeMode) {
      mainWindow.setIgnoreMouseEvents(true)
      mainWindow.showInactive()
    } else mainWindow.show()
  })
  if (!smokeMode && !codexSmokeMode && !animationSmokeMode) {
    mainWindow.webContents.once('did-finish-load', () => {
      void publishCodexActivity()
      codexActivityTimer = setInterval(() => { void publishCodexActivity() }, 2000)
    })
  }
  if (animationSmokeMode) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 500))
        const badge = await mainWindow.webContents.executeJavaScript(`(() => {
          const badge = document.getElementById('usageBadge')
          const pill = document.getElementById('statusPill').getBoundingClientRect()
          return { text: badge.textContent, right: badge.getBoundingClientRect().right, pillLeft: pill.left }
        })()`)
        if (!badge.text.includes('总剩余 60%') || !badge.text.includes('5h 剩余 75%') || badge.right > badge.pillLeft) throw new Error('Usage badge mismatch: ' + JSON.stringify(badge))
        await mainWindow.webContents.executeJavaScript(`(() => {
          const toggle = document.getElementById('dynamicPet')
          toggle.checked = true
          toggle.dispatchEvent(new Event('change'))
        })()`)
        const artifactDir = path.join(process.cwd(), 'artifacts')
        await fs.mkdir(artifactDir, { recursive: true })
        for (const [phase, clip, text] of [
          ['running', 'working', '工作中'],
          ['searching', 'working_command', '查找资料中'],
          ['error', 'error', '遇到问题了'],
        ]) {
          mainWindow.webContents.send('whale:pet-state', { state: `codex-${phase}` })
          await new Promise((resolve) => setTimeout(resolve, phase === 'running' ? 5300 : 2700))
          const result = await mainWindow.webContents.executeJavaScript(`(() => {
            const img = document.querySelector('.pet-image.is-visible')
            return { src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0,
              text: document.getElementById('bubbleText').textContent }
          })()`)
          if (!result.loaded || !result.src.includes('/' + clip + '/') || result.text !== text) throw new Error(JSON.stringify(result))
          await fs.writeFile(path.join(artifactDir, `animation-${phase}.png`), (await mainWindow.webContents.capturePage()).toPNG())
          console.log('[animation-smoke]', phase, result.src, result.text)
        }
        await mainWindow.webContents.executeJavaScript(`(() => {
          const toggle = document.getElementById('dynamicPet')
          toggle.checked = false
          toggle.dispatchEvent(new Event('change'))
        })()`)
        for (const [phase, clip] of [['running', 'working'], ['searching', 'working_command'], ['error', 'error']]) {
          mainWindow.webContents.send('whale:pet-state', { state: `codex-${phase}` })
          await new Promise((resolve) => setTimeout(resolve, 200))
          const src = await mainWindow.webContents.executeJavaScript("document.querySelector('.pet-image.is-visible').getAttribute('src')")
          if (!src.endsWith(clip + '/' + clip + (clip === 'working' ? '_121.webp' : '_061.webp'))) throw new Error('Static status mismatch: ' + src)
        }
        await mainWindow.webContents.executeJavaScript(`(() => { const toggle = document.getElementById('dynamicPet'); toggle.checked = true; toggle.dispatchEvent(new Event('change')) })()`)
        for (const message of ['放我下来！', '抓稳一点……不对，快把我放稳！']) {
          mainWindow.webContents.send('whale:pet-state', { state: 'dragging', message })
          await new Promise((resolve) => setTimeout(resolve, 300))
          // Dragging uses local dialogue; set both widths explicitly for the layout check.
          await mainWindow.webContents.executeJavaScript(`document.getElementById('bubbleText').textContent = ${JSON.stringify(message)}`)
          await new Promise((resolve) => setTimeout(resolve, 100))
          const anchor = await mainWindow.webContents.executeJavaScript(`(() => {
            const bubble = document.getElementById('speechBubble')
            const pet = document.getElementById('petStage').getBoundingClientRect()
            return { tip: bubble.offsetLeft + 2 + parseFloat(getComputedStyle(bubble).getPropertyValue('--tail-left')),
              head: pet.left + pet.width / 2 }
          })()`)
          if (Math.abs(anchor.tip - anchor.head) > 3) throw new Error('Bubble anchor mismatch: ' + JSON.stringify(anchor))
        }
        await fs.writeFile(path.join(artifactDir, 'bubble-drag-anchor.png'), (await mainWindow.webContents.capturePage()).toPNG())
        const dismissal = await mainWindow.webContents.executeJavaScript(`(() => {
          const badge = document.getElementById('usageBadge')
          const panel = document.getElementById('dashboard')
          badge.click()
          const opened = !panel.classList.contains('hidden')
          panel.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
          const staysInside = !panel.classList.contains('hidden')
          document.getElementById('app').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
          const closesOutside = panel.classList.contains('hidden') && !badge.hidden
          badge.click()
          window.dispatchEvent(new Event('blur'))
          return { opened, staysInside, closesOutside, closesOnBlur: panel.classList.contains('hidden') }
        })()`)
        if (!Object.values(dismissal).every(Boolean)) throw new Error('Usage dismissal failed: ' + JSON.stringify(dismissal))

        quitting = true
        app.quit()
      } catch (error) {
        console.error('[animation-smoke]', error)
        quitting = true
        app.exit(1)
      }
    })
  }
  if (codexSmokeMode) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
        await new Promise((resolve) => setTimeout(resolve, 250))
        mainWindow.webContents.send('whale:codex-activity', { phase: 'searching', threadId: 'smoke-thread', title: 'Smoke', activeCount: 1 })
        await new Promise((resolve) => setTimeout(resolve, 180))
        const liveActivity = await mainWindow.webContents.executeJavaScript(`({
          status: document.getElementById('codexLiveStatus').textContent,
          frame: document.querySelector('.pet-image.is-visible')?.getAttribute('src'),
        })`)
        if (!liveActivity.status.includes('查找') || !liveActivity.frame.includes('assets/dsh-pet/working_command/')) throw new Error(`Codex activity animation failed: ${JSON.stringify(liveActivity)}`)
        mainWindow.webContents.send('whale:codex-activity', { phase: 'idle', threadId: null, title: null, activeCount: 0 })
        const wheel = await mainWindow.webContents.executeJavaScript(`(() => {
          document.getElementById('petStage').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
          const menu = document.getElementById('actionWheel')
          return {
            visible: !menu.classList.contains('hidden'),
            modes: [...menu.querySelectorAll('[data-idle]')].map((button) => button.dataset.idle),
            usage: menu.querySelector('[data-action="usage"]')?.textContent,
            topActions: [...document.querySelectorAll('.window-actions button')].map((button) => button.id),
          }
        })()`)
        if (!wheel.visible || wheel.modes.join(',') !== 'swing,game,hover,movie,running' || wheel.usage !== '查看用量' || wheel.topActions.join(',') !== 'minimize,quit') throw new Error(`Action wheel failed: ${JSON.stringify(wheel)}`)
        const artifactDir = path.join(process.cwd(), 'artifacts')
        await fs.mkdir(artifactDir, { recursive: true })
        await new Promise((resolve) => setTimeout(resolve, 250))
        await fs.writeFile(path.join(artifactDir, 'action-wheel.png'), (await mainWindow.webContents.capturePage()).toPNG())
        const actionsWork = await mainWindow.webContents.executeJavaScript(`(() => {
          const menu = document.getElementById('actionWheel')
          const pet = document.getElementById('petStage')
          return [...menu.querySelectorAll('[data-idle]')].every((button) => {
            button.click()
            const selected = button.classList.contains('selected') && localStorage.getItem('whaleIdleMode') === button.dataset.idle
            pet.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
            return selected && !menu.classList.contains('hidden')
          })
        })()`)
        if (!actionsWork) throw new Error('Original idle actions did not work')
        await mainWindow.webContents.executeJavaScript("document.querySelector('#actionWheel [data-action=usage]').click()")
        let state
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          state = await mainWindow.webContents.executeJavaScript(`({
            remaining: document.getElementById('codexRemaining').textContent,
            lifetime: document.getElementById('codexLifetimeTokens').textContent,
            status: document.getElementById('codexStatus').textContent,
          })`)
          if (state.remaining.includes('剩余') && state.lifetime !== '—') break
        }
        if (!state?.remaining.includes('剩余') || state.lifetime === '—') throw new Error(`Codex dashboard failed: ${JSON.stringify(state)}`)
        await fs.writeFile(path.join(artifactDir, 'codex-dashboard.png'), (await mainWindow.webContents.capturePage()).toPNG())
        const layout = await mainWindow.webContents.executeJavaScript(`(() => {
          const panel = document.getElementById('dashboard').getBoundingClientRect()
          const pet = document.getElementById('petStage').getBoundingClientRect()
          return { panelRight: panel.right, petLeft: pet.left }
        })()`)
        if (layout.panelRight > layout.petLeft) throw new Error(`Dashboard covers the pet: ${JSON.stringify(layout)}`)
        await mainWindow.webContents.executeJavaScript("document.getElementById('showDeepSeekTab').click()")
        await new Promise((resolve) => setTimeout(resolve, 250))
        const deepSeekVisible = await mainWindow.webContents.executeJavaScript(`(() => {
          const view = document.getElementById('deepSeekView')
          return !view.hidden && getComputedStyle(view).display !== 'none' &&
            getComputedStyle(document.getElementById('codexView')).display === 'none' &&
            Boolean(document.getElementById('balance')) && Boolean(document.getElementById('openDeepSeekChat'))
        })()`)
        if (!deepSeekVisible) throw new Error('DeepSeek features are not visible')
        await fs.writeFile(path.join(artifactDir, 'deepseek-dashboard.png'), (await mainWindow.webContents.capturePage()).toPNG())
        await mainWindow.webContents.executeJavaScript("document.getElementById('showThreadsTab').click()")
        let conversationState
        for (let attempt = 0; attempt < 40; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 250))
          conversationState = await mainWindow.webContents.executeJavaScript(`({
            visible: !document.getElementById('codexThreadsView').hidden,
            count: document.querySelectorAll('#codexThreadList .thread-card').length,
            preview: document.querySelector('#codexThreadList .thread-card span')?.textContent,
          })`)
          if (conversationState.count) break
        }
        if (!conversationState.visible || !conversationState.count || !conversationState.preview) throw new Error(`Codex conversations failed: ${JSON.stringify(conversationState)}`)
        await fs.writeFile(path.join(artifactDir, 'codex-conversations.png'), (await mainWindow.webContents.capturePage()).toPNG())
        const animation = await mainWindow.webContents.executeJavaScript(`(async () => {
          document.querySelector('#actionWheel [data-idle="hover"]').click()
          await new Promise((resolve) => setTimeout(resolve, 150))
          const first = document.querySelector('.pet-image.is-visible').getAttribute('src')
          await new Promise((resolve) => setTimeout(resolve, 300))
          const second = document.querySelector('.pet-image.is-visible').getAttribute('src')
          return { first, second, enabled: document.getElementById('dynamicPet').checked }
        })()`)
        if (!animation.enabled || animation.first === animation.second || !animation.second.includes('assets/dsh-pet/idle/')) throw new Error(`Dynamic pet failed: ${JSON.stringify(animation)}`)
        await fs.writeFile(path.join(artifactDir, 'dynamic-pet.png'), (await mainWindow.webContents.capturePage()).toPNG())
        console.log(`[codex-smoke] ${state.remaining}, lifetime ${state.lifetime}`)
        quitting = true
        app.quit()
      } catch (error) {
        console.error('[codex-smoke]', error)
        quitting = true
        app.exit(1)
      }
    })
  }
  if (smokeMode) {
    mainWindow.webContents.once('did-finish-load', async () => {
      try {
      await new Promise((resolve) => setTimeout(resolve, 250))
      const artifactDir = path.join(process.cwd(), 'artifacts')
      await fs.mkdir(artifactDir, { recursive: true })
      mainWindow.webContents.send('whale:pet-state', { state: 'dragging' })
      await new Promise((resolve) => setTimeout(resolve, 350))
      const dragImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-drag.png'), dragImage.toPNG())
      mainWindow.webContents.send('whale:pet-state', { state: 'headpat' })
      await new Promise((resolve) => setTimeout(resolve, 350))
      const headpatUi = await mainWindow.webContents.executeJavaScript(`({state:document.getElementById('petStage').className,label:document.getElementById('statusPill').textContent})`)
      if (!headpatUi.state.includes('state-headpat') || headpatUi.label !== '小鲸鱼蹭蹭') throw new Error(`smoke headpat label failed: ${JSON.stringify(headpatUi)}`)
      const headpatImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-headpat.png'), headpatImage.toPNG())
      mainWindow.webContents.send('whale:pet-state', { state: 'chat', message: '好呀～' })
      await new Promise((resolve) => setTimeout(resolve, 250))
      const shortBubbleLayout = await mainWindow.webContents.executeJavaScript(`(()=>{const rect=document.getElementById('speechBubble').getBoundingClientRect();return {height:rect.height,top:rect.top,bottom:rect.bottom,windowHeight:innerHeight}})()`)
      if (shortBubbleLayout.height > 56 || shortBubbleLayout.top < 0 || mainWindow.getBounds().height !== COMPACT_SIZE.height) throw new Error(`smoke short bubble sizing failed: ${JSON.stringify(shortBubbleLayout)}`)
      const shortBubbleImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-short-bubble.png'), shortBubbleImage.toPNG())
      mainWindow.webContents.send('whale:pet-state', { state: 'idle' })
      await new Promise((resolve) => setTimeout(resolve, 300))
      const staticSources = await mainWindow.webContents.executeJavaScript(`(async()=>{const first=document.querySelector('.pet-image.is-visible').getAttribute('src');await new Promise(r=>setTimeout(r,500));return [first,document.querySelector('.pet-image.is-visible').getAttribute('src'),Boolean(document.getElementById('actionWheel')),Boolean(document.getElementById('animationMode'))]})()`)
      if (staticSources[0] !== staticSources[1] || !/whale-(maid|idle-(swing|game|movie|running))\.png/.test(staticSources[0]) || !staticSources[2] || staticSources[3]) throw new Error(`smoke static idle mode failed: ${staticSources.join(',')}`)
      await mainWindow.webContents.executeJavaScript("document.getElementById('petStage').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}))")
      await new Promise((resolve) => setTimeout(resolve, 250))
      const wheelImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-wheel.png'), wheelImage.toPNG())
      await mainWindow.webContents.executeJavaScript("document.querySelector('[data-idle=game]').click()")
      await new Promise((resolve) => setTimeout(resolve, phase === 'running' ? 5300 : 2700))
      const gameSources = await mainWindow.webContents.executeJavaScript(`(async()=>{const first=document.querySelector('.pet-image.is-visible').getAttribute('src');await new Promise(r=>setTimeout(r,450));return [first,document.querySelector('.pet-image.is-visible').getAttribute('src')]})()`)
      if (gameSources[0] !== gameSources[1] || !/whale-idle-game\.png/.test(gameSources[0])) throw new Error(`smoke static game idle failed: ${gameSources.join(',')}`)
      await mainWindow.webContents.executeJavaScript("document.getElementById('statusPill').click()")
      await new Promise((resolve) => setTimeout(resolve, 300))
      const chatUi = await mainWindow.webContents.executeJavaScript(`({chatVisible:!document.getElementById('petChat').classList.contains('hidden'),hasQuestion:Boolean(document.getElementById('chatQuestion')),hasMonitor:Boolean(document.getElementById('monitorEnabled')),button:document.getElementById('statusPill').textContent})`)
      if (!chatUi.chatVisible || !chatUi.hasQuestion || chatUi.hasMonitor) throw new Error(`smoke direct pet chat failed: ${JSON.stringify(chatUi)}`)
      const petChatImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-pet-chat.png'), petChatImage.toPNG())
      await mainWindow.webContents.executeJavaScript("document.getElementById('closePetChat').click()")
      await new Promise((resolve) => setTimeout(resolve, 250))
      mainWindow.webContents.send('whale:pet-state', { state: 'chat', message: `今天的大概要点是：${'经济和科技新闻都有新变化，小鲸鱼会认真说明。'.repeat(10)}` })
      await new Promise((resolve) => setTimeout(resolve, 500))
      const bubbleLayout = await mainWindow.webContents.executeJavaScript(`(()=>{const rect=document.getElementById('speechBubble').getBoundingClientRect();return {top:rect.top,bottom:rect.bottom,height:innerHeight,text:document.getElementById('bubbleText').textContent}})()`)
      if (mainWindow.getBounds().height !== BUBBLE_SIZE.height || bubbleLayout.top < 0 || bubbleLayout.bottom > bubbleLayout.height || bubbleLayout.text.includes('…')) throw new Error(`smoke long bubble layout failed: ${JSON.stringify(bubbleLayout)}`)
      const longBubbleImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-long-bubble.png'), longBubbleImage.toPNG())
      await mainWindow.webContents.executeJavaScript("document.getElementById('petStage').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))")
      await new Promise((resolve) => setTimeout(resolve, 350))
      const securityUi = await mainWindow.webContents.executeJavaScript(`({security:document.getElementById('securityStatus').textContent,hasIntegration:Boolean(document.getElementById('integrationToken') || document.querySelector('.integration-box')),hasMonitor:Boolean(document.getElementById('monitorEnabled')),hasChat:Boolean(document.getElementById('chatQuestion'))})`)
      if (!securityUi.security.includes('加密已启用') || securityUi.hasIntegration || securityUi.hasMonitor || !securityUi.hasChat) throw new Error(`smoke security UI failed: ${JSON.stringify(securityUi)}`)
      const settingsImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-settings.png'), settingsImage.toPNG())
      await mainWindow.webContents.executeJavaScript("document.getElementById('settings').classList.add('hidden');document.getElementById('dashboard').classList.remove('hidden')")
      await new Promise((resolve) => setTimeout(resolve, 350))
      const textLayout = await mainWindow.webContents.executeJavaScript(`(()=>{const bubble=getComputedStyle(document.getElementById('speechBubble'));return {dashboardVisible:!document.getElementById('dashboard').classList.contains('hidden'),dashboardHasChat:Boolean(document.querySelector('#dashboard .chat-box')),bubbleHidden:bubble.display==='none'}})()`)
      if (!textLayout.dashboardVisible || textLayout.dashboardHasChat || !textLayout.bubbleHidden) throw new Error(`smoke dashboard layout failed: ${JSON.stringify(textLayout)}`)
      const dashboardImage = await mainWindow.webContents.capturePage()
      await fs.writeFile(path.join(artifactDir, 'smoke-dashboard.png'), dashboardImage.toPNG())
      quitting = true
      app.quit()
      } catch (error) {
        console.error('[smoke]', error)
        quitting = true
        app.exit(1)
      }
    })
  }
  mainWindow.on('close', (event) => {
    if (!quitting) { event.preventDefault(); mainWindow.hide() }
  })
}

function assertTrustedRenderer(event) {
  const senderUrl = event.senderFrame?.url || event.sender?.getURL?.() || ''
  const expected = pathToFileURL(path.join(__dirname, '..', 'renderer', 'index.html')).href
  if (senderUrl !== expected) throw new Error('拒绝来自非本地界面的请求')
}

function handle(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedRenderer(event)
    return listener(event, ...args)
  })
}

function registerIpc() {
  handle('whale:get-snapshot', () => snapshot())
  handle('whale:get-codex-usage', (_event, force) => getCodexUsage(Boolean(force)))
  handle('whale:get-codex-threads', (_event, force) => getCodexThreads(Boolean(force)))
  handle('whale:open-codex-thread', async (_event, threadId) => {
    const threads = await getCodexThreads()
    if (!threads.some((thread) => thread.id === threadId)) throw new Error('找不到这条 Codex 对话')
    await shell.openExternal(`codex://threads/${encodeURIComponent(threadId)}`)
  })
  handle('whale:get-config', () => publicConfig())
  handle('whale:refresh-balance', () => refreshBalance())
  handle('whale:ask', (_event, question) => askWhale(question))
  handle('whale:save-config', async (_event, patch) => {
    const current = await readConfig()
    if (typeof patch.apiKey === 'string') {
      const apiKey = patch.apiKey.trim()
      if (apiKey) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error('系统安全存储不可用，已拒绝以明文保存 API Key')
        current.apiKeyEncrypted = safeStorage.encryptString(apiKey).toString('base64')
        current.apiKeyPlainFallback = ''
      } else {
        current.apiKeyEncrypted = ''
        current.apiKeyPlainFallback = ''
      }
    }
    if (patch.pricing) current.pricing = {
      flash: { ...current.pricing.flash, ...patch.pricing.flash },
      pro: { ...current.pricing.pro, ...patch.pricing.pro },
    }
    if (typeof patch.alwaysOnTop === 'boolean') current.alwaysOnTop = patch.alwaysOnTop
    if (typeof patch.clickThrough === 'boolean') current.clickThrough = patch.clickThrough
    await writeConfig(current)
    return publicConfig()
  })
  handle('whale:set-always-on-top', async (_event, value) => {
    mainWindow.setAlwaysOnTop(Boolean(value))
    const current = await readConfig(); current.alwaysOnTop = Boolean(value); await writeConfig(current)
  })
  handle('whale:set-click-through', async (_event, value) => {
    mainWindow.setIgnoreMouseEvents(Boolean(value), { forward: true })
    const current = await readConfig(); current.clickThrough = Boolean(value); await writeConfig(current)
  })
  handle('whale:open-data-directory', () => shell.openPath(app.getPath('userData')))
  handle('whale:set-panel-open', (_event, value) => { panelOpen = Boolean(value); if (panelOpen) bubbleExpanded = false; applyWindowSize() })
  handle('whale:set-bubble-expanded', (_event, value) => { bubbleExpanded = Boolean(value) && !panelOpen; applyWindowSize() })
  handle('whale:begin-drag', () => {
    if (dragTimer || !mainWindow) return
    dragAnchor = { cursor: screen.getCursorScreenPoint(), bounds: mainWindow.getBounds() }
    dragTimer = setInterval(() => {
      if (!mainWindow || mainWindow.isDestroyed() || !dragAnchor) return
      const cursor = screen.getCursorScreenPoint()
      mainWindow.setPosition(
        dragAnchor.bounds.x + cursor.x - dragAnchor.cursor.x,
        dragAnchor.bounds.y + cursor.y - dragAnchor.cursor.y,
        false,
      )
    }, 16)
  })
  handle('whale:end-drag', () => {
    clearInterval(dragTimer)
    dragTimer = null
    dragAnchor = null
  })
  handle('whale:minimize', () => mainWindow.hide())
  handle('whale:quit', () => { quitting = true; app.quit() })
}

app.whenReady().then(async () => {
  if (!app.requestSingleInstanceLock()) return app.quit()
  await loadModules()
  const userData = app.getPath('userData')
  store = new modules.JsonStore(path.join(userData, 'usage.json'))
  configPath = path.join(userData, 'config.json')
  await initializeSecureConfig()
  registerIpc()
  await createWindow()
  createTray()
})

app.on('second-instance', () => { if (mainWindow) { mainWindow.show(); mainWindow.focus() } })
app.on('window-all-closed', (event) => event.preventDefault())
app.on('before-quit', () => { quitting = true; clearInterval(dragTimer); clearInterval(codexActivityTimer) })
