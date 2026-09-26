import { createFramePlayer, posterIndex } from './frame-player.js'
// Dafeiyu frames and timing, with activity assignments chosen for this desktop pet.
const manifest = await fetch(new URL('../assets/dsh-pet-manifest.json', import.meta.url)).then((response) => response.json())
const clips = manifest.clips
const states = {
  idle: ['IDLE'], working: ['WORKING'], dragging: ['dragging'], busy: ['WAITING'],
  headpat: ['head_pat'], success: ['SUCCESS'], error: ['ERROR'], bite: ['poke'], chat: ['SUCCESS'],
  'codex-thinking': ['THINKING'], 'codex-searching': ['WORKING', 'searching'],
  'codex-editing': ['WORKING', 'editing'], 'codex-running': ['WORKING', 'commanding'],
  'codex-testing': ['WORKING', 'testing'], 'codex-waiting': ['WAITING'],
  'codex-completed': ['SUCCESS'], 'codex-error': ['ERROR'],
  'codex-goal': ['THINKING'],
}

function clipFor(state) {
  const [base, activity] = states[state] || []
  return manifest.workingActivityMap[activity] || manifest.stateMap[base] || (clips[base] ? base : null)
}
function framePath(name, index) {
  return `../assets/dsh-pet/${clips[name].frames[index]}`
}

export function petStatePoster(state) {
  const name = clipFor(state)
  return name ? framePath(name, posterIndex(clips[name], name === 'working' ? 5040 : 2520)) : null
}

export function createPetAnimator() {
  let microTimer = null
  let activeName = null
  let target = null
  const cache = new Map()
  // Bound our retained predecode references by pixel size, including future 4x frames.
  const bytesPerFrame = (manifest.maxFrameWidth || 824) * (manifest.maxFrameHeight || 688) * 4
  const cacheLimit = Math.max(1, Math.min(12, Math.floor(24 * 1024 * 1024 / bytesPerFrame)))

  function clearCache() {
    for (const image of cache.values()) image.src = ''
    cache.clear()
  }
  function present(index) {
    if (!target || !activeName) return
    const clip = clips[activeName]
    target.src = framePath(activeName, index)
    const wanted = new Set()
    for (let offset = 0; offset < Math.min(cacheLimit, clip.frames.length); offset++) {
      const next = clip.loop ? (index + offset) % clip.frames.length : index + offset
      if (next >= clip.frames.length) break
      wanted.add(framePath(activeName, next))
    }
    for (const [path, image] of cache) {
      if (!wanted.has(path)) { image.src = ''; cache.delete(path) }
    }
    for (const path of wanted) {
      if (cache.has(path)) continue
      const image = new Image()
      image.decoding = 'async'
      image.src = path
      cache.set(path, image)
      // Completion never writes to the visible image, so an old decode cannot
      // overwrite a newer action. The browser also manages its own image cache.
      image.decode().catch(() => {})
    }
  }
  const player = createFramePlayer({ onFrame: present })

  function stop() {
    player.stop()
    clearTimeout(microTimer)
    microTimer = null
    activeName = null
    target = null
    clearCache()
  }

  function play(name, onEnd) {
    clearTimeout(microTimer)
    microTimer = null
    clearCache()
    activeName = name
    player.play(clips[name], onEnd)
  }

  function start(image, state, idleMode, enabled) {
    const name = clipFor(state)
    if (!name || !enabled || (state === 'idle' && idleMode !== 'hover') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stop()
      return false
    }
    // Shared working states retain their elapsed time, including after a
    // non-looping clip has reached its final pose.
    if (activeName === name) {
      target = image
      present(player.frame)
      return true
    }
    stop()
    target = image
    play(name)
    if (state === 'idle') {
      microTimer = setTimeout(() => play('eat_token', () => play('idle')), 16000 + Math.random() * 10000)
    }
    return true
  }

  return { start, stop }
}
