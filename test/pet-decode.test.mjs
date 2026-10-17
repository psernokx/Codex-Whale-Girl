import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('slow decoding retains the picture, skips backlog, and cannot overwrite a new action', async () => {
  const pending = []
  let playerOptions
  const context = vm.createContext({
    URL, setTimeout, clearTimeout,
    fetch: async () => ({ json: async () => ({
      maxFrameWidth: 1648, maxFrameHeight: 1376,
      clips: { working: { frames: ['work0', 'work1', 'work2'] }, error: { frames: ['error0'] } },
      stateMap: { WORKING: 'working', ERROR: 'error' }, workingActivityMap: {},
    }) }),
    Image: class { decode() { return new Promise(resolve => pending.push({ image: this, resolve })) } },
    createFramePlayer: options => { playerOptions = options; return { play() { options.onFrame(0) }, stop() {}, frame: 0 } },
    posterIndex: () => 0,
  })
  // Evaluate the browser module with controlled decode completion; no filesystem assets needed.
  const source = (await readFile(new URL('../renderer/pet-animation.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/, '')
    .replaceAll('export function', 'function')
    .replace('import.meta.url', JSON.stringify(new URL('../renderer/pet-animation.js', import.meta.url).href))
  await vm.runInContext(`(async () => { ${source}; globalThis.animator = createPetAnimator() })()`, context)
  const animator = context.animator
  const target = { src: 'old-picture' }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  animator.start(target, 'working', 'hover', true)
  playerOptions.onFrame(1); playerOptions.onFrame(2)
  assert.equal(pending.length, 1)
  assert.equal(target.src, 'old-picture')
  pending[0].resolve(); await flush()
  assert.equal(target.src.endsWith('work0'), true)
  assert.equal(pending.length, 2)
  assert.equal(pending[1].image.src.endsWith('work2'), true)
  animator.start(target, 'error', 'hover', true)
  pending[2].resolve(); await flush()
  assert.equal(target.src.endsWith('error0'), true)
  pending[1].resolve(); await flush()
  assert.equal(target.src.endsWith('error0'), true)
  animator.stop()
})

test('video changes reject stale playback, preserve a shared clip, and fall back on load failure', async () => {
  const plays = [], framePlays = []
  const classList = () => { const set = new Set(); return { add: v => set.add(v), remove: v => set.delete(v), contains: v => set.has(v) } }
  const parent = { classList: classList(), append: v => { v.parentElement = parent } }
  const video = { classList: classList(), pause() {}, load() {},
    play() { return new Promise(resolve => plays.push(resolve)) },
    removeAttribute(name) { this[name] = '' }, getAttribute(name) { return this[name] },
  }
  const clips = Object.fromEntries(['working', 'error'].map(n => [n, { frames: [n], loop: true, runtimeVideo: n + '.webm' }]))
  const context = vm.createContext({ URL, setTimeout, clearTimeout,
    fetch: async () => ({ json: async () => ({ clips, stateMap: { WORKING: 'working', ERROR: 'error' }, workingActivityMap: {} }) }),
    document: { createElement: () => video },
    createFramePlayer: () => ({ play: clip => framePlays.push(clip), stop() {}, frame: 0 }), posterIndex: () => 0,
  })
  const source = (await readFile(new URL('../renderer/pet-animation.js', import.meta.url), 'utf8'))
    .replace(/^import .*\n/, '').replaceAll('export function', 'function')
    .replace('import.meta.url', JSON.stringify(new URL('../renderer/pet-animation.js', import.meta.url).href))
  await vm.runInContext(`(async () => { ${source}; globalThis.animator = createPetAnimator() })()`, context)
  const a = context.animator, target = { parentElement: parent }
  const flush = () => new Promise(resolve => setImmediate(resolve))
  a.start(target, 'working', 'hover', true); video.onloadeddata()
  a.start(target, 'error', 'hover', true)
  plays[0](); await flush()
  assert.equal(parent.classList.contains('has-status-video'), false)
  video.onloadeddata(); plays[1](); await flush()
  assert.equal(parent.classList.contains('has-status-video'), true)
  const originalLoad = video.onloadeddata
  a.start({ parentElement: parent }, 'error', 'hover', true)
  assert.equal(video.onloadeddata, originalLoad)
  assert.equal(video.playbackRate, 1)
  video.onerror()
  assert.equal(framePlays.at(-1), clips.error)
  assert.equal(parent.classList.contains('has-status-video'), false)
  a.start(target, 'working', 'hover', false)
  assert.equal(video.src, '')
})
