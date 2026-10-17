import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rm, stat } from 'node:fs/promises'
import { pipeline } from 'node:stream/promises'
import { Readable, Transform } from 'node:stream'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const lock = JSON.parse(await readFile(path.join(root,'assets/enhanced-assets.lock.json'),'utf8'))
const args = process.argv.slice(2)
const option = key => args.includes(key) ? args[args.indexOf(key)+1] : null
const selected = option('--pack')
if (selected && !lock.packs.some(p=>p.id===selected)) throw new Error('Unknown asset pack')
const temp = path.join(root,'.tmp/asset-downloads')
const sha = async file => {const h=createHash('sha256');for await(const c of createReadStream(file))h.update(c);return h.digest('hex')}
const validFile = async entry => {
  try {return (await stat(path.join(root,entry.path))).size===entry.size && await sha(path.join(root,entry.path))===entry.sha256}
  catch {return false}
}
function runTar(args) {
  const r=spawnSync('tar',args,{encoding:'utf8',maxBuffer:8*1024*1024,windowsHide:true})
  if(r.error || r.status!==0)throw new Error('tar unavailable or extraction failed: '+(r.error?.message || r.stderr))
  return r.stdout
}
for(const pack of lock.packs.filter(p=>!selected || p.id===selected)) {
  if(pack.files.some(f=>!f.path.startsWith('assets/') || f.path.split('/').includes('..') || path.isAbsolute(f.path)))throw new Error('Unsafe asset path')
  let valid=true
  for(const entry of pack.files)if(!await validFile(entry)){valid=false;break}
  if(valid){console.log(pack.id+': verified');continue}
  if(args.includes('--check'))throw new Error(pack.id+': missing or modified assets; run npm run assets:fetch')
  const offline=option('--offline-dir')
  await mkdir(temp,{recursive:true})
  const archive=offline?path.resolve(offline,pack.file):path.join(temp,pack.file)
  try {
    if(!offline) {
      const url=`https://github.com/${lock.repository}/releases/download/${lock.release}/${pack.file}`
      console.log('Downloading '+pack.id)
      const response=await fetch(url,{signal:AbortSignal.timeout(30*60*1000)})
      if(!response.ok)throw new Error('Asset download HTTP '+response.status)
      let size=0
      const limit=new Transform({transform(chunk,_encoding,callback){size+=chunk.length;callback(size>pack.size?new Error('Unexpected archive size'):null,chunk)}})
      await pipeline(Readable.fromWeb(response.body),limit,createWriteStream(archive))
    }
    if((await stat(archive)).size!==pack.size || await sha(archive)!==pack.sha256)throw new Error('Archive checksum mismatch: '+pack.id)
    const entries=runTar(['-tzf',archive]).trim().split(/\r?\n/).filter(Boolean)
    const allowed=new Set(pack.files.map(f=>f.path))
    if(entries.length!==allowed.size || entries.some(p=>!allowed.has(p)))throw new Error('Unexpected archive entries')
    runTar(['-xzf',archive,'-C',root])
    for(const entry of pack.files)if(!await validFile(entry))throw new Error('Extracted asset checksum mismatch: '+entry.path)
    console.log(pack.id+': restored and verified')
  } finally {if(!offline)await rm(archive,{force:true})}
}
