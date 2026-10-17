import { createFramePlayer, posterIndex } from './frame-player.js'
// Dafeiyu frames and timing, with activity assignments chosen for this desktop pet.
const manifest = await fetch(new URL('../assets/dsh-pet-4x60-manifest.json', import.meta.url)).then((response) => response.json())
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
  return `../assets/dsh-pet-4x60/${clips[name].frames[index]}`
}

export function petStatePoster(state) {
  const name = clipFor(state)
  return name ? framePath(name, posterIndex(clips[name], name === 'working' ? 5040 : 2520)) : null
}

export function petStateDuration(state) {
  const clip = clips[clipFor(state)]
  return clip ? clip.frames.length * clip.frameMs : 0
}

export function createPetAnimator({ onComplete } = {}) {
  let microTimer = null
  let activeName = null
  let target = null
  let video = null
  const cache = new Map()
  // Bound our retained predecode references by pixel size, including future 4x frames.
  const bytesPerFrame = (manifest.maxFrameWidth || 824) * (manifest.maxFrameHeight || 688) * 4
  const cacheLimit = Math.max(1, Math.min(2, Math.floor(24 * 1024 * 1024 / bytesPerFrame)))

  let decodeGeneration = 0
  let pendingImage = null
  let desiredPath = null

  function clearCache() {
    decodeGeneration++
    if (pendingImage) pendingImage.src = ''
    pendingImage = null
    desiredPath = null
    for (const image of cache.values()) image.src = ''
    cache.clear()
  }

  function decodeLatest() {
    if (!target || !desiredPath || pendingImage) return
    const path = desiredPath
    const ready = cache.get(path)
    if (ready) { target.src = path; return }
    const image = new Image()
    const generation = decodeGeneration
    pendingImage = image
    image.decoding = 'async'
    image.src = path
    image.decode().then(() => {
      if (generation !== decodeGeneration || !target) return
      cache.set(path, image)
      while (cache.size > cacheLimit) {
        const oldest = cache.keys().next().value
        cache.delete(oldest)
      }
      // Keep the previous decoded picture visible until the next is ready.
      // Serialize decode work; frames skipped under load do not delay the timeline.
      target.src = path
    }).catch(() => {}).finally(() => {
      if (generation !== decodeGeneration) return
      pendingImage = null
      if (desiredPath !== path) decodeLatest()
    })
  }

  function present(index) {
    if (!target || !activeName) return
    desiredPath = framePath(activeName, index)
    decodeLatest()
  }
  const player = createFramePlayer({ onFrame: present })

  function stopVideo() {
    if (!video) return
    video.onloadeddata = video.onended = video.onerror = null
    video.pause()
    video.classList.remove('is-visible')
    video.parentElement?.classList.remove('has-status-video')
    video.removeAttribute('src')
    video.load()
  }

  function playVideo(clip, onEnd) {
    if (!video) {
      video = document.createElement('video')
      video.id = 'statusVideo'
      video.className = 'pet-image dynamic-pet status-video'
      video.muted = true
      video.playsInline = true
      video.preload = 'auto'
      target.parentElement.append(video)
    }
    const generation = decodeGeneration
    const fallback = () => {
      if (generation !== decodeGeneration || !target) return
      stopVideo()
      player.play(clip, onEnd)
    }
    video.loop = Boolean(clip.loop)
    video.playbackRate = video.defaultPlaybackRate = 1
    video.onloadeddata = () => {
      if (generation !== decodeGeneration || !target) return
      video.play().then(() => {
        if (generation !== decodeGeneration || !target) return
        video.classList.add('is-visible')
        video.parentElement.classList.add('has-status-video')
      }).catch(fallback)
    }
    video.onerror = fallback
    video.onended = () => {
      if (generation === decodeGeneration) onEnd?.()
    }
    video.src = clip.runtimeVideo
    video.load()
  }

  function stop() {
    player.stop()
    stopVideo()
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
    player.stop()
    stopVideo()
    activeName = name
    const clip = clips[name]
    if (clip.runtimeVideo) {
      target.src = framePath(name, posterIndex(clip, 2520))
      playVideo(clip, onEnd)
    } else player.play(clip, onEnd)
  }

  function start(image, state, idleMode, enabled) {
    const name = clipFor(state)
    // The explicit in-app animation switch takes precedence over OS motion preferences.
    if (!name || !enabled || (state === 'idle' && idleMode !== 'hover')) {
      stop()
      return false
    }
    // Shared working states retain their elapsed time, including after a
    // non-looping clip has reached its final pose.
    if (activeName === name) {
      target = image
      if (video?.getAttribute('src')) target.src = framePath(name, posterIndex(clips[name], 2520))
      else present(player.frame)
      return true
    }
    stop()
    target = image
    play(name, clips[name].loop ? undefined : () => onComplete?.(state))
    if (state === 'idle') {
      microTimer = setTimeout(() => play('eat_token', () => play('idle')), 16000 + Math.random() * 10000)
    }
    return true
  }

  return { start, stop }
}
