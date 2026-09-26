import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

test('every packaged animation frame referenced by the manifest exists', async () => {
  const manifest = JSON.parse(await readFile('assets/dsh-pet-manifest.json', 'utf8'))
  for (const [name, clip] of Object.entries(manifest.clips)) {
    const files = new Set(await readdir(path.join('assets', 'dsh-pet', name)))
    assert.ok(clip.frameMs > 0)
    for (const frame of clip.frames) assert.ok(files.has(path.basename(frame)), `missing frame: ${frame}`)
  }
})

test('V1.6 renderer uses static idle assets and does not load archived frame sequences', async () => {
  const renderer = await readFile(path.join('renderer', 'app.js'), 'utf8')
  assert.equal(renderer.includes('assets/whale/sequences'), false)
  assert.equal(renderer.includes('startIdleSequence'), false)
  assert.equal(/(?:frame|inbetween)-\d{2}\.png/.test(renderer), false)
  for (const mode of ['swing', 'game', 'movie', 'running']) {
    const files = await readdir(path.join('assets', 'whale'))
    assert.equal(files.includes(`whale-idle-${mode}.png`), true, `${mode} static idle asset`)
  }
  assert.equal(renderer.includes("actionWheel.addEventListener('click'"), true)
})
