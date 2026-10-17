const fs = require('node:fs/promises')
const path = require('node:path')
exports.run = async function(window, artifactDir) {
  const wait = () => new Promise(resolve => setTimeout(resolve,100))
  const sample = {status:'recent',estimated:true,measuredAt:Date.now(),inputRate:12345,outputRate:25.4,
    inputTokens:123450,cachedInputTokens:120000,outputTokens:254,reasoningTokens:40,inputSeconds:10,outputSeconds:10,outputMethod:'request'}
  const send = speed => window.webContents.send('whale:codex-activity',{phase:'running',threadId:'speed-test',activeCount:1,tokenSpeed:speed})
  const read = () => window.webContents.executeJavaScript(`({input:document.getElementById('usageInputRate').textContent,
    output:document.getElementById('usageOutputRate').textContent,status:document.getElementById('tokenSpeedStatus').textContent,
    detail:document.getElementById('tokenSpeedDetails').textContent})`)
  send(sample);await wait();const first=await read()
  if(first.input!=='12.3k'||first.output!=='25.4'||!first.detail.includes('缓存'))throw new Error('Token rates missing: '+JSON.stringify(first))
  send({...sample,measuredAt:Date.now(),outputRate:42.5});await wait()
  if((await read()).output!=='42.5')throw new Error('Rates did not update while work phase stayed unchanged')
  await fs.writeFile(path.join(artifactDir,'token-speed-badge.png'),(await window.webContents.capturePage()).toPNG())
  send({...sample,measuredAt:Date.now()-60000});await wait();const stale=await read()
  if(stale.output!=='—'||!stale.status.includes('过期'))throw new Error('Stale rate shown as live')
  send({...sample,status:'offline'});await wait();const offline=await read()
  if(offline.output!=='—'||!offline.status.includes('未运行'))throw new Error('Exit preserved live rate')
  send(null)
  await fs.writeFile(path.join(artifactDir,'token-speed-audit.json'),JSON.stringify({first,stale,offline},null,2))
}
