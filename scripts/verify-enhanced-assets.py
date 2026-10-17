import json,hashlib,subprocess,math
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from PIL import Image
root=Path(__file__).resolve().parents[1]
base=root/'assets';m=json.loads((base/'dsh-pet-4x60-manifest.json').read_text());old=json.loads((base/'dsh-pet-manifest.json').read_text());items=json.loads((base/'action-library/actions.json').read_text())['actions']
for key in ['stateMap','workingActivityMap','idleMicroClips']:assert m[key]==old[key],key
assert len(items)==106 and len(m['clips'])==16
count=0
for name,c in m['clips'].items():
 original=old['clips'][name];assert c['loop']==original['loop'];duration=len(c['frames'])*c['frameMs'];srcduration=len(original['frames'])*original['frameMs']
 assert abs(duration-srcduration)<16.667,(name,duration,srcduration)
 assert len(c['frames'])==1 or abs(c['frameMs']-1000/60)<1e-8
 for i,f in enumerate(c['frames']):
  p=base/'dsh-pet-4x60'/f
  with Image.open(p) as im:
   assert im.size==(1648,1376) and im.mode=='RGBA',(f,im.size,im.mode)
   if i in (0,len(c['frames'])//2,len(c['frames'])-1):
    ex=im.getchannel('A').getextrema();assert ex[0]<=3 and ex[1]>=250,(f,ex)
  count+=1
 print('verified clip',name,len(c['frames']),flush=True)
def check(a):
 p=base/'action-library'/a['id']/'animation.webm'
 assert hashlib.sha256(p.read_bytes()).hexdigest()==a['outputSha256'],a['id']
 data=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-count_packets','-show_streams','-show_format','-of','json',str(p)]))
 s=data['streams'][0];assert (s['width'],s['height'])==(2560,1440);assert s['avg_frame_rate']=='60/1';assert int(s['nb_read_packets'])==a['frameCount']
 assert abs(float(data['format']['duration'])-a['durationSeconds'])<.02
 rgba=subprocess.check_output(['ffmpeg','-v','error','-c:v','libvpx-vp9','-i',str(p),'-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1'])
 alpha=rgba[3::4];assert min(alpha)<=3 and max(alpha)>=250
 assert (base/'action-library'/a['authorDescription']).is_file()
 return {'id':a['id'],'width':s['width'],'height':s['height'],'fps':s['avg_frame_rate'],'frames':int(s['nb_read_packets']),'sha256':a['outputSha256'],'firstAlpha':[min(alpha),max(alpha)]}
with ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(check,items))
report={'framesVerified':count,'clips':16,'videos':results,'note':'Dimensions, source duration, packet count, SHA256 and sampled decoded alpha verified. This does not prove interpolation model quality or stable display FPS. GPU generation scripts and reports were not supplied in the installer.'}
(root/'artifacts/verification').mkdir(parents=True,exist_ok=True)
(root/'artifacts/verification/mac-asset-verification.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
print('PASS',count,'RGBA frames;',len(results),'4x60 videos with matching hashes and decoded transparency',flush=True)
