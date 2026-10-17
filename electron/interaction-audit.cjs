const fs = require('node:fs/promises')
const path = require('node:path')
exports.run = async function(window, artifactDir) {
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
  const read = () => window.webContents.executeJavaScript(`({stage:document.getElementById('petStage').className,
    src:document.getElementById('statusVideo')?.getAttribute('src'),time:document.getElementById('statusVideo')?.currentTime,
    ended:document.getElementById('statusVideo')?.ended,visible:document.getElementById('statusVideo')?.classList.contains('is-visible')})`)
  window.webContents.send('whale:codex-activity', {phase:'running',threadId:'interaction-test',activeCount:1})
  window.webContents.send('whale:pet-state', {state:'headpat'})
  await wait(3000)
  const pat = await read()
  if (!pat.src?.endsWith('/head_pat.webm') || !pat.visible) throw new Error('Head pat interrupted before its four-second clip completed: '+JSON.stringify(pat))
  await wait(2000)
  const restored = await read()
  if (!restored.src?.endsWith('/working.webm')) throw new Error('Work did not resume after head pat: '+JSON.stringify(restored))
  await window.webContents.executeJavaScript(`(()=>{const t=document.getElementById('dynamicPet');t.checked=false;t.dispatchEvent(new Event('change'))})()`)
  window.webContents.send('whale:pet-state', {state:'headpat'})
  await wait(100)
  await window.webContents.executeJavaScript(`(()=>{const t=document.getElementById('dynamicPet');t.checked=true;t.dispatchEvent(new Event('change'))})()`)
  await wait(3000)
  const toggledPat = await read()
  if (!toggledPat.src?.endsWith('/head_pat.webm') || !toggledPat.visible) throw new Error('Enabling animation reused the old static timeout: '+JSON.stringify(toggledPat))
  await wait(2000)
  for (const state of ['dragging','codex-thinking','codex-searching','codex-running','dragging','codex-running']) {
    window.webContents.send('whale:pet-state', {state})
    await wait(80)
  }
  await wait(600)
  const switched = await read()
  if (!switched.visible || !switched.src?.endsWith('/working.webm')) throw new Error('Rapid switches restored a stale clip: '+JSON.stringify(switched))
  await fs.writeFile(path.join(artifactDir,'interaction-audit.json'),JSON.stringify({pat,restored,toggledPat,switched},null,2))
}
