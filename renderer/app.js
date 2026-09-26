import { pickDialogue } from './dialogues.js'
import { createPetAnimator, petStatePoster } from './pet-animation.js'

const api = window.whaleAPI
const $ = (id) => document.getElementById(id)
const dashboard = $('dashboard')
const settings = $('settings')
const petChat = $('petChat')
const petLayers = [$('petSprite'), $('petSpriteNext')]
const petStage = $('petStage')
const bubble = $('speechBubble')
const actionWheel = $('actionWheel')
const extraActions = $('extraActions')
const petVideo = $('petVideo')
const extraIdleModes = ['swing', 'rubik', 'cat', 'stretch', 'dance', 'snack']
let videoVersion = 0
const petAnimator = createPetAnimator()
const staticIdleAssets = {
  hover: '../assets/whale/whale-maid.png',
  swing: '../assets/whale/whale-idle-swing.png',
  game: '../assets/whale/whale-idle-game.png',
  movie: '../assets/whale/whale-idle-movie.png',
  running: '../assets/whale/whale-idle-running.png',
  ...Object.fromEntries(extraIdleModes.map(mode => [mode, `../assets/extra-actions/${mode}.png`])),
}
const petAssets = {
  idle: staticIdleAssets.hover,
  working: '../assets/whale/whale-working-desk.png',
  dragging: '../assets/whale/whale-drag-panic.png',
  busy: '../assets/whale/whale-busy-cry.png',
  headpat: '../assets/whale/whale-headpat.png',
  success: '../assets/whale/whale-satiated.png',
  error: '../assets/whale/whale-maid.png',
  bite: '../assets/whale/whale-bite-hand.png',
  chat: '../assets/whale/whale-maid.png',
}
Object.values({ ...petAssets, ...staticIdleAssets }).forEach((src) => { const image = new Image(); image.src = src })
let stateVersion = 0
let longPressTimer
let dragging = false
let suppressClickUntil = 0
let activePetLayer = 0
let selectedIdle = localStorage.getItem('whaleIdleMode') || 'hover'
if (!staticIdleAssets[selectedIdle]) selectedIdle = 'hover'
let dynamicPetEnabled = localStorage.getItem('whaleDynamicPet') !== 'false'
let patCount = 0
let patResetTimer
let patCooldownUntil = 0
let singleClickTimer
let idleChatterTimer
let currentPetState = 'idle'
let duckAudioContext
let bubbleVersion = 0
let codexActivity = { phase: 'idle', threadId: null, activeCount: 0 }
let petInteractionUntil = 0
let deepSeekBusy = false

const codexPhaseText = {
  thinking: '思考中', searching: '查找资料中', editing: '修改文件中',
  running: '工作中', testing: '测试中', waiting: '等你处理一下',
  completed: '完成啦', error: '遇到问题了', idle: '休息中', goal: '目标进行中',
}

function applyCodexActivity(activity) {
  const previousDescription = codexActivity.description || codexPhaseText[codexActivity.phase]
  codexActivity = activity
  const description = activity.description || codexPhaseText[activity.phase] || '进行中'
  const taskName = activity.title ? ` · ${activity.project ? `${activity.project} · ` : ''}${activity.title.slice(0, 24)}` : ''
  $('codexLiveStatus').textContent = activity.phase === 'idle'
    ? codexPhaseText.idle
    : `${description}${activity.detail ? ` · ${activity.detail}` : ''}${taskName}${activity.activeCount > 1 ? ` · 另有 ${activity.activeCount - 1} 个任务` : ''}${activity.goalCount ? ` · ${activity.goalCount} 个持续目标` : ''}`
  document.querySelectorAll('.thread-card').forEach((button) => button.classList.toggle('is-active', button.dataset.threadId === activity.threadId && activity.phase !== 'idle'))
  if (deepSeekBusy || dragging || Date.now() < petInteractionUntil) return
  const state = activity.phase === 'idle' ? 'idle' : `codex-${activity.phase}`
  if (currentPetState === state && previousDescription === description) return
  if (state === 'idle' && !currentPetState.startsWith('codex-')) return
  setPetState(state, { message: activity.phase === 'idle' ? undefined : description })
}

function resumeCodexAfter(delay) {
  setTimeout(() => { if (Date.now() >= petInteractionUntil) applyCodexActivity(codexActivity) }, delay + 30)
}

const fmtTokens = (value = 0) => {
  if (value >= 100_000_000) return `${(value / 100_000_000).toFixed(1)}亿`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
  return String(Math.round(value))
}
const fmtYuan = (value = 0) => `¥${Number(value).toLocaleString('zh-CN', { minimumFractionDigits: value >= 1 ? 2 : 4, maximumFractionDigits: value >= 1 ? 2 : 6 })}`
const quotaLabel = (minutes) => minutes >= 1440 ? `${Math.round(minutes / 1440)} 天额度` : minutes >= 60 ? `${Math.round(minutes / 60)} 小时额度` : 'Codex 额度'
let codexUsage = null

function renderCodex(value) {
  codexUsage = value
  const windows = [value.primary, value.secondary].filter(Boolean)
  const total = windows.find((item) => item.windowDurationMins !== 300)
  const fiveHour = windows.find((item) => item.windowDurationMins === 300)
  const remaining = (item) => `${Math.max(0, Math.round(100 - item.usedPercent))}%`
  $('usageBadgeMain').textContent = total ? `总剩余 ${remaining(total)}` : fiveHour ? `5h 剩余 ${remaining(fiveHour)}` : '暂无额度数据'
  $('usageBadgeFiveHour').hidden = !(total && fiveHour)
  $('usageBadgeFiveHour').textContent = fiveHour ? `5h 剩余 ${remaining(fiveHour)}` : ''
  for (const id of ['usageBadgeMain', 'usageBadgeFiveHour']) {
    const line = $(id)
    const match = line.textContent.match(/^(.*?)(\d+%)$/)
    if (match) {
      const number = document.createElement('strong')
      number.textContent = match[2]
      line.replaceChildren(document.createTextNode(match[1]), number)
    }
  }
  $('usageBadge').classList.remove('is-stale')
  $('usageBadge').title = `点击查看详情 · ${new Date(value.fetchedAt).toLocaleTimeString()} 更新`
  const primary = value.primary || value.secondary
  if (primary) {
    const remaining = Math.max(0, Math.round(100 - primary.usedPercent))
    $('codexWindowLabel').textContent = quotaLabel(primary.windowDurationMins)
    $('codexRemaining').textContent = `${remaining}% 剩余`
    $('codexMeterFill').style.width = `${remaining}%`
    $('codexReset').textContent = primary.resetsAt ? new Date(primary.resetsAt * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
  } else {
    $('codexRemaining').textContent = '暂无额度数据'
    $('codexMeterFill').style.width = '0%'
  }
  const other = value.primary && value.secondary ? value.secondary : null
  $('codexOtherRow').hidden = !other
  if (other) {
    $('codexOtherLabel').textContent = quotaLabel(other.windowDurationMins)
    $('codexOtherRemaining').textContent = `${Math.max(0, Math.round(100 - other.usedPercent))}% 剩余`
  }
  const latestDay = value.dailyUsage.at(-1)
  $('codexTodayTokens').textContent = latestDay ? fmtTokens(latestDay.tokens) : '—'
  $('codexLifetimeTokens').textContent = value.lifetimeTokens == null ? '—' : fmtTokens(value.lifetimeTokens)
  $('codexStreak').textContent = value.currentStreakDays == null ? '—' : `${value.currentStreakDays} 天`
  $('codexStatus').textContent = `由 Codex 提供 · 更新于 ${new Date(value.fetchedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
}

async function refreshCodexUsage(force = false) {
  $('codexStatus').textContent = '正在读取 Codex 用量…'
  $('refreshCodex').disabled = true
  try {
    renderCodex(await api.getCodexUsage(force))
  } catch (error) {
    $('codexStatus').textContent = error.message || 'Codex 用量暂时不可用'
    $('usageBadge').classList.add('is-stale')
    $('usageBadge').title = codexUsage ? '刷新失败，显示上次额度 · 点击重试' : '点击查看连接说明并重试'
    if (!codexUsage) $('usageBadgeMain').textContent = '额度暂不可用'
    if (!codexUsage) $('codexRemaining').textContent = '暂不可用'
  } finally {
    $('refreshCodex').disabled = false
  }
}

function renderCodexThreads(threads) {
  const list = $('codexThreadList')
  list.replaceChildren()
  if (!threads.length) {
    list.textContent = '还没有找到本机 Codex 对话'
    return
  }
  for (const thread of threads.slice(0, Math.max(3, threads.filter((item) => item.goalStatus).length))) {
    const button = document.createElement('button')
    button.className = 'thread-card'
    button.dataset.threadId = thread.id
    button.classList.toggle('is-active', thread.id === codexActivity.threadId && codexActivity.phase !== 'idle')
    button.type = 'button'
    button.title = '在 Codex 中打开这条对话'
    const title = document.createElement('strong')
    title.textContent = thread.title
    const preview = document.createElement('span')
    preview.textContent = thread.preview || '暂无消息预览'
    const updated = document.createElement('small')
    updated.textContent = thread.updatedAt ? `${new Date(thread.updatedAt * 1000).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 更新 · 点击打开` : '点击在 Codex 中打开'
    button.append(title, preview, updated)
    button.addEventListener('click', () => { void api.openCodexThread(thread.id).catch((error) => { $('codexThreadList').textContent = error.message || '打开对话失败' }) })
    list.append(button)
  }
}

async function refreshCodexThreads(force = false) {
  $('codexThreadList').textContent = '正在读取对话…'
  $('refreshCodexThreads').disabled = true
  try { renderCodexThreads(await api.getCodexThreads(force)) }
  catch (error) { $('codexThreadList').textContent = error.message || 'Codex 对话暂时不可用' }
  finally { $('refreshCodexThreads').disabled = false }
}

function playDuckSqueak() {
  const AudioContext = window.AudioContext || window.webkitAudioContext
  if (!AudioContext) return
  duckAudioContext ||= new AudioContext()
  const now = duckAudioContext.currentTime
  const oscillator = duckAudioContext.createOscillator()
  const gain = duckAudioContext.createGain()
  const filter = duckAudioContext.createBiquadFilter()
  oscillator.type = 'square'
  oscillator.frequency.setValueAtTime(760, now)
  oscillator.frequency.exponentialRampToValueAtTime(430, now + 0.075)
  oscillator.frequency.exponentialRampToValueAtTime(610, now + 0.18)
  filter.type = 'bandpass'
  filter.frequency.value = 1150
  filter.Q.value = 2.1
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.075, now + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22)
  oscillator.connect(filter).connect(gain).connect(duckAudioContext.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.23)
}

const thinkingLines = ['让我甩甩鲸尾想想…', '正在把问题揉成小蛋糕…', '唔，答案快浮上来啦…', '再眨一下眼就想好啦…']

async function askQuestion() {
  const question = $('chatQuestion').value.trim()
  if (!question) return setPetState('error', { message: '先写下想问的问题呀～' })
  const button = $('askWhale')
  button.disabled = true
  deepSeekBusy = true
  setPetChat(false)
  let index = 0
  $('chatStatus').textContent = thinkingLines[index]
  speak(thinkingLines[index], true)
  const chatter = setInterval(() => {
    index = (index + 1) % thinkingLines.length
    $('chatStatus').textContent = thinkingLines[index]
    speak(thinkingLines[index], true)
  }, 1800)
  try {
    const result = await api.ask(question)
    $('chatStatus').textContent = '回答完成 · 内容未在本地留存'
    $('chatQuestion').value = ''
    setPetState('chat', { message: result.answer })
  } catch (error) {
    $('chatStatus').textContent = '这次没答上来'
    setPetState('error', { message: error.message })
  } finally {
    clearInterval(chatter)
    button.disabled = false
    deepSeekBusy = false
    applyCodexActivity(codexActivity)
  }
}

function updateBubbleAnchor() {
  const petRect = petStage.getBoundingClientRect()
  const headX = petRect.left + petRect.width / 2
  const width = bubble.offsetWidth
  const left = Math.max(12, Math.min(headX - width * 0.4, innerWidth - width - 24))
  bubble.style.right = `${innerWidth - left - width}px`
  const tailX = Math.max(14, Math.min(width - 30, headX - left - 2))
  bubble.style.setProperty('--tail-left', `${tailX}px`)
}

new ResizeObserver(updateBubbleAnchor).observe(bubble)
window.addEventListener('resize', updateBubbleAnchor)

function speak(text, persistent = false) {
  const version = ++bubbleVersion
  const content = String(text || '')
  $('bubbleText').textContent = content
  bubble.classList.remove('is-busy')
  bubble.classList.remove('pop')
  bubble.classList.toggle('is-short', content.length <= 28 && !content.includes('\n'))
  bubble.classList.toggle('is-long', content.length > 120 || content.split('\n').length > 4)
  void bubble.offsetWidth
  updateBubbleAnchor()
  if (!persistent) bubble.classList.add('pop')
  requestAnimationFrame(() => {
    if (version !== bubbleVersion || bubble.classList.contains('is-panel-hidden')) return
    api.setBubbleExpanded(bubble.scrollHeight > 92)
  })
  if (!persistent) setTimeout(() => {
    if (version === bubbleVersion) api.setBubbleExpanded(false)
  }, 2850)
}

function scheduleIdleChatter() {
  clearTimeout(idleChatterTimer)
  if (currentPetState !== 'idle') return
  idleChatterTimer = setTimeout(() => {
    if (currentPetState !== 'idle' || !dashboard.classList.contains('hidden') || !settings.classList.contains('hidden') || !petChat.classList.contains('hidden')) return scheduleIdleChatter()
    speak(pickDialogue(selectedIdle === 'hover' ? 'idle' : selectedIdle))
    scheduleIdleChatter()
  }, 18000 + Math.random() * 12000)
}

function transitionPet(state, assetOverride = null, extraClass = '') {
  clearTimeout(idleChatterTimer)
  currentPetState = state
  const previous = petLayers[activePetLayer]
  const nextIndex = 1 - activePetLayer
  const next = petLayers[nextIndex]
  if (assetOverride) petAnimator.stop()
  const extra = !assetOverride && state === 'idle' && extraIdleModes.includes(selectedIdle) && dynamicPetEnabled && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const dynamic = !assetOverride && !extra && petAnimator.start(next, state, selectedIdle, dynamicPetEnabled)
  if (extra) petAnimator.stop()
  const videoToken = ++videoVersion
  petVideo.pause()
  petVideo.onloadeddata = null
  petVideo.classList.remove('is-visible')
  if (extra) {
    petVideo.playbackRate = 1
    petVideo.defaultPlaybackRate = 1
    petVideo.src = `../assets/extra-actions/${selectedIdle}.webm`
    petVideo.onloadeddata = () => {
      if (videoToken !== videoVersion) return
      petVideo.play().then(() => {
        if (videoToken !== videoVersion) return
        petLayers.forEach(layer => layer.classList.remove('is-visible'))
        petVideo.classList.add('is-visible')
      }).catch(() => {})
    }
    petVideo.load()
  } else { petVideo.removeAttribute('src'); petVideo.load() }
  const statusPoster = state.startsWith('codex-') ? petStatePoster(state) : null
  const fallbackState = state.startsWith('codex-')
    ? ({ waiting: 'busy', completed: 'success', error: 'error' }[state.slice(6)] || 'working')
    : state
  if (!dynamic) next.src = assetOverride || statusPoster || (state === 'idle' ? staticIdleAssets[selectedIdle] : (petAssets[fallbackState] || petAssets.idle))
  next.className = `pet-image state-${state}${dynamic || statusPoster ? ' dynamic-pet' : ''}${state === 'idle' && !dynamic ? ` idle-${selectedIdle} idle-float` : ''}${state === 'idle' && extraIdleModes.includes(selectedIdle) ? ' extra-poster' : ''}${extraClass ? ` ${extraClass}` : ''}`
  void next.offsetWidth
  previous.classList.remove('is-visible')
  next.classList.add('is-visible')
  setTimeout(() => {
    if (activePetLayer === nextIndex) previous.className = 'pet-image'
  }, 260)
  activePetLayer = nextIndex
  petStage.className = `pet-stage state-${state} idle-${selectedIdle}${dragging ? ' is-long-pressing' : ''}`
  bubble.classList.toggle('is-working', ['codex-running', 'codex-editing', 'codex-testing'].includes(state))
  if (state === 'idle') scheduleIdleChatter()
}

function changeIdleMode(mode) {
  if (!staticIdleAssets[mode]) return
  selectedIdle = mode
  localStorage.setItem('whaleIdleMode', selectedIdle)
  actionWheel.classList.add('hidden')
  extraActions.classList.add('hidden')
  actionWheel.querySelectorAll('[data-idle]').forEach((button) => button.classList.toggle('selected', button.dataset.idle === selectedIdle))
  speak(pickDialogue(mode === 'hover' ? 'idle' : mode))
  petInteractionUntil = Date.now() + 10000
  setPetState('idle')
  resumeCodexAfter(10000)
}

function setPetState(state, detail = {}) {
  const version = ++stateVersion
  transitionPet(state)
  const label = { idle: '问问小鲸鱼', working: '小鲸鱼思考中…', dragging: '放我下来！', headpat: '小鲸鱼蹭蹭', bite: '摸头冷却中', busy: '小鲸鱼忙不过来啦', success: '小鲸鱼吃饱啦', chat: '继续问小鲸鱼', error: '小鲸鱼出错了' }[state] || (state.startsWith('codex-') ? '问问小鲸鱼' : state)
  $('statusPill').textContent = label
  if (state === 'working') {
    speak(detail.message || pickDialogue('working'), true)
  } else if (state === 'dragging') {
    speak(pickDialogue('dragging'), true)
  } else if (state === 'headpat') {
    speak(pickDialogue('headpat'))
  } else if (state === 'bite') {
    speak(pickDialogue('bite'), true)
  } else if (state === 'busy') {
    bubble.classList.add('is-busy')
    speak(detail.message || pickDialogue('busy'), true)
    bubble.classList.add('is-busy')
  } else if (state === 'success' && detail.record) {
    speak(`${pickDialogue('success')} 这轮 ${fmtTokens(detail.record.usage.total)} tokens，${fmtYuan(detail.record.cost)}。`)
  } else if (state === 'success' && detail.balance) {
    speak(`余额还有 ${fmtYuan(detail.balance.total)}。${pickDialogue('balance')}`)
  } else if (state === 'success') {
    speak(pickDialogue('success'))
  } else if (state === 'chat') {
    speak(detail.message || '回答送到啦～', true)
  } else if (state === 'error') {
    speak(detail.message || pickDialogue('error'))
  } else if (state.startsWith('codex-')) {
    speak(detail.message || codexPhaseText[state.slice(6)] || '进行中', state !== 'codex-completed' && state !== 'codex-error')
  }
  const resumeState = detail.resumeState || 'idle'
  const duration = state === 'busy' ? 3800 : state === 'success' ? 10000 : state === 'headpat' ? 2200 : state === 'bite' ? 4200 : state === 'error' ? 3000 : state === 'codex-completed' || state === 'codex-error' ? 7000 : 0
  if (['headpat', 'bite', 'busy', 'success', 'error', 'chat'].includes(state)) {
    petInteractionUntil = Date.now() + (duration || 10000)
    resumeCodexAfter(duration || 10000)
  }
  if (duration) setTimeout(() => {
    if (version !== stateVersion) return
    setPetState(resumeState)
    applyCodexActivity(codexActivity)
  }, duration)
}

function render(snapshot) {
  const today = snapshot.summary.today
  const month = snapshot.summary.month
  $('todayCost').textContent = fmtYuan(today.cost)
  $('todayTokens').textContent = fmtTokens(today.total)
  $('monthCost').textContent = fmtYuan(month.cost)
  $('monthRequests').textContent = String(month.requests)
  $('hitTokens').textContent = fmtTokens(today.hit)
  $('missTokens').textContent = fmtTokens(today.miss)
  $('outputTokens').textContent = fmtTokens(today.output)
  $('balance').textContent = snapshot.balance ? fmtYuan(snapshot.balance.total) : '未连接'
  $('settingsBalance').textContent = snapshot.balance ? fmtYuan(snapshot.balance.total) : '未连接'
}

async function load() {
  render(await api.getSnapshot())
  const config = await api.getConfig()
  $('usageScale').value = Math.round((config.usageScale || 1) * 100)
  $('usageScaleValue').textContent = `${$('usageScale').value}%`
  $('petScale').value = Math.round((config.petScale || 1) * 100)
  $('petScaleValue').textContent = `${$('petScale').value}%`
  $('alwaysOnTop').checked = config.alwaysOnTop
  $('dynamicPet').checked = dynamicPetEnabled
  $('securityStatus').textContent = config.encryptionAvailable ? '系统加密已启用' : '系统加密不可用'
  $('securityStatus').classList.toggle('warning', !config.encryptionAvailable)
  actionWheel.querySelectorAll('[data-idle]').forEach((button) => button.classList.toggle('selected', button.dataset.idle === selectedIdle))
  setPetState('idle')
  void refreshCodexUsage()
}

function setPanel(panel = null) {
  $('usageBadge').hidden = Boolean(panel)
  dashboard.classList.toggle('hidden', panel !== 'dashboard')
  if (panel === 'dashboard') void refreshCodexUsage()
  settings.classList.toggle('hidden', panel !== 'settings')
  petChat.classList.add('hidden')
  bubble.classList.toggle('is-panel-hidden', Boolean(panel))
  if (panel) api.setBubbleExpanded(false)
  actionWheel.classList.add('hidden')
  extraActions.classList.add('hidden')
  api.setPanelOpen(Boolean(panel))
}

function setUsageTab(tab) {
  const codexSelected = tab === 'codex'
  const deepSeekSelected = tab === 'deepseek'
  $('codexView').hidden = !codexSelected
  $('deepSeekView').hidden = !deepSeekSelected
  $('codexThreadsView').hidden = tab !== 'threads'
  $('showCodexTab').classList.toggle('selected', codexSelected)
  $('showDeepSeekTab').classList.toggle('selected', deepSeekSelected)
  $('showThreadsTab').classList.toggle('selected', tab === 'threads')
  $('showCodexTab').setAttribute('aria-pressed', String(codexSelected))
  $('showDeepSeekTab').setAttribute('aria-pressed', String(deepSeekSelected))
  $('showThreadsTab').setAttribute('aria-pressed', String(tab === 'threads'))
  if (codexSelected) void refreshCodexUsage()
  if (tab === 'threads') void refreshCodexThreads()
}

function setPetChat(open) {
  $('usageBadge').hidden = false
  petChat.classList.toggle('hidden', !open)
  dashboard.classList.add('hidden')
  settings.classList.add('hidden')
  bubble.classList.toggle('is-panel-hidden', open)
  actionWheel.classList.add('hidden')
  extraActions.classList.add('hidden')
  api.setBubbleExpanded(false)
  api.setPanelOpen(open)
  if (open) {
    $('chatStatus').textContent = '对话不会保存在本地'
    setTimeout(() => $('chatQuestion').focus(), 120)
  }
}

$('showCodexTab').addEventListener('click', () => setUsageTab('codex'))
$('showDeepSeekTab').addEventListener('click', () => setUsageTab('deepseek'))
$('showThreadsTab').addEventListener('click', () => setUsageTab('threads'))
$('refreshCodexThreads').addEventListener('click', () => { void refreshCodexThreads(true) })
$('dynamicPet').addEventListener('change', (event) => {
  dynamicPetEnabled = event.target.checked
  localStorage.setItem('whaleDynamicPet', String(dynamicPetEnabled))
  transitionPet(currentPetState)
})
$('openDeepSeekChat').addEventListener('click', () => setPetChat(true))
petStage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return
  if (event.target.closest('#statusPill')) return
  petStage.setPointerCapture(event.pointerId)
  longPressTimer = setTimeout(async () => {
    dragging = true
    suppressClickUntil = Date.now() + 500
    petStage.classList.add('is-long-pressing')
    setPetState('dragging')
    await api.beginDrag()
  }, 360)
})
const finishLongPress = async () => {
  clearTimeout(longPressTimer)
  if (!dragging) return
  dragging = false
  petStage.classList.remove('is-long-pressing')
  await api.endDrag()
  setPetState('idle')
  applyCodexActivity(codexActivity)
}
petStage.addEventListener('pointerup', finishLongPress)
petStage.addEventListener('pointercancel', finishLongPress)
petStage.addEventListener('lostpointercapture', finishLongPress)
petStage.addEventListener('click', (event) => {
  if (event.target.closest('#statusPill')) return
  if (Date.now() < suppressClickUntil) return
  clearTimeout(singleClickTimer)
  singleClickTimer = setTimeout(() => {
    playDuckSqueak()
    if (Date.now() < patCooldownUntil) {
      speak(pickDialogue('patCooldown'))
      return
    }
    patCount += 1
    clearTimeout(patResetTimer)
    patResetTimer = setTimeout(() => { patCount = 0 }, 15000)
    if (patCount >= 5) {
      patCount = 0
      patCooldownUntil = Date.now() + 30000
      setPetState('bite')
    } else setPetState('headpat')
  }, 240)
})
petStage.addEventListener('dblclick', () => {
  clearTimeout(singleClickTimer)
  actionWheel.classList.toggle('hidden')
})
petStage.addEventListener('contextmenu', (event) => { event.preventDefault(); setPanel('settings') })
$('statusPill').addEventListener('click', (event) => { event.stopPropagation(); setPetChat(true) })
$('statusPill').addEventListener('dblclick', (event) => event.stopPropagation())
extraActions.addEventListener('click', event => {
  const button = event.target.closest('[data-idle]')
  if (button) changeIdleMode(button.dataset.idle)
})
$('closeExtraActions').addEventListener('click', () => extraActions.classList.add('hidden'))
document.addEventListener('pointerdown', event => {
  if (!event.target.closest('#extraActions, #actionWheel')) extraActions.classList.add('hidden')
})
actionWheel.addEventListener('click', (event) => {
  if (event.target.closest('[data-action="more"]')) {
    actionWheel.classList.add('hidden')
    extraActions.classList.remove('hidden')
    return
  }
  if (event.target.closest('[data-action="usage"]')) {
    setUsageTab('codex')
    setPanel('dashboard')
    return
  }
  const button = event.target.closest('[data-idle]')
  if (button) changeIdleMode(button.dataset.idle)
})
$('closePanel').addEventListener('click', () => setPanel())
$('openSettings').addEventListener('click', () => setPanel('settings'))
$('closeSettings').addEventListener('click', () => setPanel())
$('closePetChat').addEventListener('click', () => setPetChat(false))
$('askWhale').addEventListener('click', askQuestion)
$('chatQuestion').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); askQuestion() }
})
$('refreshBalance').addEventListener('click', async () => { try { await api.refreshBalance() } catch (error) { setPetState('error', { message: error.message }) } })
$('refreshCodex').addEventListener('click', () => { void refreshCodexUsage(true) })
$('settingsRefreshBalance').addEventListener('click', async () => { try { await api.refreshBalance() } catch (error) { setPetState('error', { message: error.message }) } })
$('usageScale').addEventListener('input', () => { $('usageScaleValue').textContent = `${$('usageScale').value}%` })
$('usageScale').addEventListener('change', async () => {
  try { await api.saveConfig({ usageScale: Number($('usageScale').value) / 100 }) }
  catch (error) { setPetState('error', { message: error.message }) }
})
$('petScale').addEventListener('input', () => { $('petScaleValue').textContent = `${$('petScale').value}%` })
$('petScale').addEventListener('change', async () => {
  try { await api.saveConfig({ petScale: Number($('petScale').value) / 100 }) }
  catch (error) { setPetState('error', { message: error.message }) }
})
$('saveSettings').addEventListener('click', async () => {
  const apiKey = $('apiKey').value
  try {
    await api.saveConfig({ apiKey: apiKey || undefined, alwaysOnTop: $('alwaysOnTop').checked })
    await api.setAlwaysOnTop($('alwaysOnTop').checked)
    $('apiKey').value = ''
    setPanel()
    speak('设置保存好啦～')
  } catch (error) { setPetState('error', { message: error.message }) }
})
$('openData').addEventListener('click', () => api.openDataDirectory())
$('minimize').addEventListener('click', () => api.minimize())
$('quit').addEventListener('click', () => api.quit())

api.onDisplayScale(({pet, usage}) => {
  const badge = $('usageBadge')
  badge.style.transform = `scale(${usage / pet})`
  badge.style.left = `${18 / pet}px`
  badge.style.bottom = `${12 / pet}px`
})
api.onSnapshot(render)
api.onPetState((detail) => setPetState(detail.state, detail))
api.onCodexActivity(applyCodexActivity)
$('usageBadge').addEventListener('click', () => {
  setUsageTab('codex')
  setPanel('dashboard')
})
document.addEventListener('pointerdown', (event) => {
  if (!dashboard.classList.contains('hidden') && !event.target.closest('#dashboard')) setPanel()
})
window.addEventListener('blur', () => {
  if (!dashboard.classList.contains('hidden')) setPanel()
})
setInterval(() => {
  void refreshCodexUsage(true)
  if (!dashboard.classList.contains('hidden') && !$('codexThreadsView').hidden) void refreshCodexThreads(true)
}, 5 * 60 * 1000)
load().catch((error) => setPetState('error', { message: error.message }))
