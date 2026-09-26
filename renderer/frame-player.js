// All positions are derived from elapsed milliseconds, not callback counts.
export function frameAt(clip, elapsedMs) {
  const count = clip.frames.length
  if (!count || !Number.isFinite(clip.frameMs) || clip.frameMs <= 0) throw new Error('Invalid animation timing')
  const position = Math.floor(Math.max(0, elapsedMs) / clip.frameMs + 1e-7)
  return { index: clip.loop ? position % count : Math.min(position, count - 1),
    ended: !clip.loop && position >= count }
}

export function posterIndex(clip, fallbackTimeMs = 2520) {
  const time = Number.isFinite(clip.posterTimeMs) ? clip.posterTimeMs : fallbackTimeMs
  return Math.min(clip.frames.length - 1, Math.max(0, Math.floor(time / clip.frameMs + 1e-7)))
}

export function createFramePlayer({ onFrame, now = () => performance.now(),
  request = (fn) => requestAnimationFrame(fn), cancel = (id) => cancelAnimationFrame(id) }) {
  let pending = null
  let generation = 0
  let current = 0
  function stop() {
    generation++
    if (pending !== null) cancel(pending)
    pending = null
  }
  function play(clip, onEnd) {
    stop()
    const token = generation
    const started = now()
    current = 0
    frameAt(clip, 0) // Validate before scheduling.
    onFrame(current)
    function tick(timestamp) {
      if (token !== generation) return
      pending = null
      const { index, ended } = frameAt(clip, timestamp - started)
      if (index !== current) {
        current = index
        onFrame(index)
      }
      if (token !== generation) return
      if (ended) { onEnd?.(); return }
      pending = request(tick)
    }
    // Static loops need no recurring render callback.
    if (token === generation && !(clip.loop && clip.frames.length === 1)) pending = request(tick)
  }
  return { play, stop, get frame() { return current } }
}
