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
  return name ? framePath(name, Math.min(name === 'working' ? 120 : 60, clips[name].frames.length - 1)) : null
}

export function createPetAnimator() {
  let frameTimer = null
  let microTimer = null
  let activeName = null
  let target = null
  let frame = 0

  function stop() {
    clearInterval(frameTimer)
    clearTimeout(microTimer)
    frameTimer = null
    microTimer = null
    activeName = null
  }

  function play(name, onEnd) {
    clearInterval(frameTimer)
    const clip = clips[name]
    activeName = name
    frame = 0
    target.src = framePath(name, frame)
    frameTimer = setInterval(() => {
      frame++
      if (frame >= clip.frames.length) {
        if (!clip.loop) {
          frame = clip.frames.length - 1
          clearInterval(frameTimer)
          frameTimer = null
          onEnd?.()
          return
        }
        frame = 0
      }
      target.src = framePath(name, frame)
    }, clip.frameMs)
  }

  function start(image, state, idleMode, enabled) {
    const name = clipFor(state)
    if (!name || !enabled || (state === 'idle' && idleMode !== 'hover') || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stop()
      return false
    }
    target = image
    // Running and testing share a clip; keep its position when their labels change.
    if (activeName === name && frameTimer) {
      target.src = framePath(name, frame)
      return true
    }
    stop()
    play(name)
    if (state === 'idle') {
      microTimer = setTimeout(() => play('eat_token', () => play('idle')), 16000 + Math.random() * 10000)
    }
    return true
  }

  return { start, stop }
}
