const fs = require('node:fs/promises')
const path = require('node:path')
const { app } = require('electron')

// Renderer observations, not a claim of physical display scanout measurement.
exports.run = async function run(window, artifactDir) {
  const report = { packaged: app.isPackaged, platform: process.platform,
    reducedMotion: 'test emulates reduce; explicit in-app animation switch takes precedence',
    measurement: 'requestVideoFrameCallback submissions and requestAnimationFrame observations; not physical scanout',
    nativePointerDrag: 'not-tested; dragging animation state is exercised', cases: [] }
  for (const scenario of [
    { name: 'pet100-usage150', pet: 1, usage: 1.5 },
    { name: 'pet150-usage150', pet: 1.5, usage: 1.5 },
    { name: 'switch-drag-restore', pet: 1, usage: 1.5, switching: true },
  ]) {
    await window.webContents.executeJavaScript(`window.whaleAPI.saveConfig({petScale:${scenario.pet},usageScale:${scenario.usage}})`)
    window.webContents.send('whale:pet-state', { state: 'codex-running' })
    await new Promise(resolve => setTimeout(resolve, 500))
    const metrics = []
    const sampler = setInterval(() => metrics.push({ time: Date.now(), processes: app.getAppMetrics().map(p => ({
      type: p.type, cpu: p.cpu.percentCPUUsage, memory: p.memory })) }), 1000)
    let switches = 0
    const switching = scenario.switching ? setInterval(() => {
      window.webContents.send('whale:pet-state', { state: ['codex-searching', 'dragging', 'codex-running'][switches++ % 3] })
    }, 2000) : null
    let result
    try {
      result = await window.webContents.executeJavaScript(`new Promise(resolve => {
        const started=performance.now(), intervals=[], decodedIntervals=[];
        let previous=started, previousDecoded=started, lastSrc='', unavailable=0, samples=0;
        const video=document.getElementById('statusVideo');
        let videoFrames=0, observedFrames=0, callbackId=null, finished=false;
        function videoFrame(){
          if(finished)return;
          if(video.classList.contains('is-visible')) videoFrames++;
          callbackId=video.requestVideoFrameCallback(videoFrame);
        }
        if(video?.requestVideoFrameCallback)callbackId=video.requestVideoFrameCallback(videoFrame);
        function tick(now) {
          intervals.push(now-previous);previous=now;samples++;
          const image=document.querySelector('img.pet-image.is-visible');
          const playing=video?.classList.contains('is-visible');
          if(playing && video.readyState>=2) {
            if(videoFrames!==observedFrames){decodedIntervals.push(now-previousDecoded);previousDecoded=now;observedFrames=videoFrames;lastSrc=video.currentSrc}
          } else if(image?.complete && image.naturalWidth>0) {
            if(image.currentSrc!==lastSrc) {decodedIntervals.push(now-previousDecoded);previousDecoded=now;lastSrc=image.currentSrc}
          } else unavailable++;
          if(now-started<20000) return requestAnimationFrame(tick);
          finished=true;if(callbackId!==null)video.cancelVideoFrameCallback(callbackId);
          const summarize=values=>{const sorted=[...values].sort((a,b)=>a-b);return {count:values.length,
            meanMs:values.reduce((a,b)=>a+b,0)/Math.max(1,values.length),p95Ms:sorted[Math.floor(sorted.length*.95)]??null,
            over25msFraction:values.filter(x=>x>25).length/Math.max(1,values.length)}};
          resolve({elapsedMs:now-started,raf:summarize(intervals),decodedChanges:summarize(decodedIntervals),
            unavailableFraction:unavailable/samples,lastSrc,videoFrames,videoFps:videoFrames/((now-started)/1000),
            width:playing?video.videoWidth:image?.naturalWidth,height:playing?video.videoHeight:image?.naturalHeight});
        } requestAnimationFrame(tick);
      })`)
    } finally {
      clearInterval(sampler)
      clearInterval(switching)
    }
    report.cases.push({ ...scenario, ...result, processMetrics: metrics })
    await fs.writeFile(path.join(artifactDir, `runtime-${scenario.name}.png`), (await window.webContents.capturePage()).toPNG())
  }
  window.webContents.send('whale:pet-state', { state: 'codex-running' })
  await new Promise(resolve => setTimeout(resolve, 700))
  report.restoredWorking = await window.webContents.executeJavaScript(`(document.querySelector('#statusVideo.is-visible')?.getAttribute('src')?.endsWith('/working.webm') || document.querySelector('img.pet-image.is-visible')?.getAttribute('src')?.includes('/working/')) && !document.getElementById('petVideo').classList.contains('is-visible')`)
  report.totalMeasuredSeconds = report.cases.reduce((sum, item) => sum + item.elapsedMs / 1000, 0)
  await fs.writeFile(path.join(artifactDir, `${process.platform}-runtime-audit.json`), JSON.stringify(report, null, 2))
  if (!report.restoredWorking) throw new Error('Runtime audit: working animation did not restore')
  if (report.cases.some(item=>!item.switching && item.videoFps<30)) throw new Error('Runtime audit: steady playback below 30 FPS')
}
