import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

test('release after a long drag suppresses the click that follows pointerup', async () => {
  const source = await readFile(new URL('../renderer/app.js', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('const finishLongPress ='), source.indexOf("petStage.addEventListener('pointerup'"))
  const states = []
  const context = vm.createContext({
    dragging: true, suppressClickUntil: 1200, longPressTimer: null,
    Date: { now: () => 6000 }, clearTimeout() {},
    petStage: { classList: { remove() {} } }, api: { endDrag: async () => {} },
    setPetState: state => states.push(state), applyCodexActivity() {}, codexActivity: {},
  })
  await vm.runInContext(handler + '\nfinishLongPress()', context)
  assert.equal(context.dragging, false)
  assert.ok(context.suppressClickUntil > 6000, 'release click must not start a head pat')
  assert.ok(context.suppressClickUntil < 7000, 'ordinary clicks should recover promptly')
  assert.deepEqual(states, ['idle'])
})
