#!/usr/bin/env python3
"""Package only redistributable animation assets, with pinned per-file hashes."""
from pathlib import Path
import hashlib,json,tarfile
root=Path(__file__).resolve().parents[1]
out=root/'.tmp/release-assets';out.mkdir(parents=True,exist_ok=True)
catalog=json.loads((root/'assets/action-library/actions.json').read_text())['actions']
actions=sorted(catalog,key=lambda a:a['id'])
groups={
 'state-4x':sorted((root/'assets/dsh-pet-4x60').rglob('*.webp')),
 'state-playback':sorted((root/'assets/pet-runtime').glob('*.webm')),
 'actions-01':[root/'assets/action-library'/a['id']/n for a in actions[:53] for n in ['animation.webm','poster.png']],
 'actions-02':[root/'assets/action-library'/a['id']/n for a in actions[53:] for n in ['animation.webm','poster.png']],
}
def digest(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
 return h.hexdigest()
def public_metadata(info):
 info.uid=info.gid=0;info.uname=info.gname='';info.mtime=0;info.pax_headers={}
 return info
lock={'version':1,'release':'assets-4x60-v1','repository':'psernokx/Codex-Whale-Girl','packs':[]}
for key,files in groups.items():
 name=f'WhaleGirl-4x60-{key}.tar.gz';target=out/name
 entries=[]
 with tarfile.open(target,'w:gz',compresslevel=1,format=tarfile.PAX_FORMAT) as tar:
  for p in files:
   assert p.is_file() and not p.is_symlink()
   rel=p.relative_to(root).as_posix()
   tar.add(p,arcname=rel,recursive=False,filter=public_metadata)
   entries.append({'path':rel,'size':p.stat().st_size,'sha256':digest(p)})
 assert target.stat().st_size<1900*1024*1024
 lock['packs'].append({'id':key,'file':name,'size':target.stat().st_size,'sha256':digest(target),'files':entries})
 print(key,len(files),target.stat().st_size,flush=True)
(root/'assets/enhanced-assets.lock.json').write_text(json.dumps(lock,ensure_ascii=False,indent=2)+'\n')
(out/'SHA256SUMS.txt').write_text(''.join(f"{p['sha256']}  {p['file']}\n" for p in lock['packs']))
