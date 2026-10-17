#!/usr/bin/env python3
"""Create display-sized transparent 60 FPS playback copies; keep 4x source frames intact."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/dsh-pet-4x60'
OUTPUT = ROOT / 'assets/pet-runtime'
MANIFEST = ROOT / 'assets/dsh-pet-4x60-manifest.json'
REPORT = ROOT / 'artifacts/runtime-video-build.json'
OUTPUT.mkdir(exist_ok=True)
REPORT.parent.mkdir(parents=True,exist_ok=True)
manifest = json.loads(MANIFEST.read_text())

def build(item):
    name, clip = item
    if len(clip['frames']) == 1:
        return name, None
    target = OUTPUT / (name + '.webm')
    temporary = OUTPUT / (name + '.partial.webm')
    fps = 1000 / clip['frameMs']
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error', '-framerate', str(fps),
        '-start_number', '1', '-i', str(SOURCE / name / '%08d.webp'),
        '-frames:v', str(len(clip['frames'])), '-vf', 'scale=1024:856:flags=lanczos',
        '-an', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', '18',
        '-deadline', 'realtime', '-cpu-used', '8', '-row-mt', '1', '-threads', '2',
        '-filter_threads', '1', '-auto-alt-ref', '0', '-y', str(temporary),
    ], check=True)
    probe = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-count_packets',
        '-show_entries', 'stream=width,height,r_frame_rate,nb_read_packets:format=duration',
        '-of', 'json', str(temporary),
    ]))
    stream = probe['streams'][0]
    assert int(stream['nb_read_packets']) == len(clip['frames']), name
    assert abs(float(probe['format']['duration']) - len(clip['frames']) / fps) < .02, name
    assert (stream['width'], stream['height']) == (1024, 856), name
    rgba = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9',
        '-i', str(temporary), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'])
    assert min(rgba[3::4]) == 0 and max(rgba[3::4]) == 255, name
    temporary.replace(target)
    print('Verified', name, flush=True)
    return name, dict(file=target.name, sha256=hashlib.sha256(target.read_bytes()).hexdigest(), **probe)

with concurrent.futures.ThreadPoolExecutor(max_workers=2) as workers:
    results = dict(workers.map(build, manifest['clips'].items()))
# Publish the manifest only after every playback copy validates.
for name, result in results.items():
    if result:
        manifest['clips'][name]['runtimeVideo'] = '../assets/pet-runtime/' + result['file']
MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
REPORT.write_text(json.dumps(results, ensure_ascii=False, indent=2) + '\n')
print('All playback copies ready; original 4x frames unchanged.', flush=True)
