import test from 'node:test'
import assert from 'node:assert/strict'
import { createFramePlayer, frameAt, posterIndex } from '../renderer/frame-player.js'
const clip = (fps, loop = false) => ({ frames: Array.from({ length: fps * 2 }, (_, i) => i), frameMs: 1000 / fps, loop })

test('24, 30 and 60 FPS retain a two-second duration and sample elapsed time', () => {
  for (const fps of [24, 30, 60]) {
    const c = clip(fps)
    assert.equal(frameAt(c, 1500).index, fps * 1.5)
    assert.equal(frameAt(c, 1999).ended, false)
    assert.equal(frameAt(c, 2000).ended, true)
    assert.equal(frameAt(c, 3000).index, fps * 2 - 1)
    assert.equal(frameAt(clip(fps, true), 2500).index, fps / 2)
  }
})

test('posters retain the same moment after interpolation', () => {
  assert.equal(posterIndex({ frames: Array(241), frameMs: 42 }, 5040), 120)
  assert.equal(posterIndex({ frames: Array(608), frameMs: 1000 / 60 }, 5040), 302)
  assert.equal(posterIndex({ frames: Array(600), frameMs: 1000 / 60, posterTimeMs: 1000 }), 60)
  assert.equal(posterIndex({ frames: [1], frameMs: 42 }), 0)
})

function harness() {
  let time = 100, id = 0
  const callbacks = new Map(), shown = []
  const player = createFramePlayer({ onFrame: i => shown.push(i), now: () => time,
    request: fn => { callbacks.set(++id, fn); return id }, cancel: n => callbacks.delete(n) })
  const advance = delta => { time += delta; const batch = [...callbacks.values()]; callbacks.clear(); batch.forEach(fn => fn(time)) }
  return { player, callbacks, shown, advance }
}

test('dropped callbacks skip expired frames without slowing the clip; completion happens once', () => {
  const h = harness(); let ended = 0
  h.player.play(clip(60), () => ended++)
  h.advance(500)
  assert.deepEqual(h.shown, [0, 30])
  h.advance(1600)
  assert.equal(h.shown.at(-1), 119)
  assert.equal(ended, 1)
  h.advance(1000)
  assert.equal(ended, 1)
  assert.equal(h.callbacks.size, 0)
})

test('stop and replacement invalidate stale callbacks', () => {
  const h = harness(); let ended = 0
  h.player.play(clip(24), () => ended++)
  const stale = [...h.callbacks.values()][0]
  h.player.stop(); stale(99999)
  assert.equal(ended, 0)
  assert.deepEqual(h.shown, [0])
  h.player.play(clip(60, true)); stale(99999)
  h.advance(1000)
  assert.equal(h.player.frame, 60)
  assert.equal(h.callbacks.size, 1)
})

test('end callback can start idle without duplicate scheduled callbacks', () => {
  const h = harness()
  h.player.play(clip(60), () => h.player.play(clip(24, true)))
  h.advance(2000)
  assert.equal(h.player.frame, 0)
  assert.equal(h.callbacks.size, 1)
  h.advance(500)
  assert.equal(h.player.frame, 12)
})

test('single-frame loop has no render timer; one-shot retains duration', () => {
  const h = harness(); let ended = 0
  h.player.play({ frames: [1], frameMs: 42, loop: true })
  assert.equal(h.callbacks.size, 0)
  h.player.play({ frames: [1], frameMs: 42, loop: false }, () => ended++)
  h.advance(41); assert.equal(ended, 0)
  h.advance(1); assert.equal(ended, 1)
})
