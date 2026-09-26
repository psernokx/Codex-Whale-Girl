"""Build an input handoff, not GPU inference. Requires git, ffmpeg and ffprobe."""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import html
import io
import json
from pathlib import Path
import re
import shutil
import subprocess
from urllib.parse import quote
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_COMMIT = '631c5310b047931404978152fdc7865413c153ec'
ORIGINAL_COMMIT = 'b8241f3'


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args])


def digest(data):
    return hashlib.sha256(data).hexdigest()


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def extract(archive, destination, prefix=''):
    for entry in archive.infolist():
        if entry.is_dir() or not entry.filename.startswith(prefix):
            continue
        relative = entry.filename[len(prefix):]
        target = (destination / relative).resolve()
        if not target.is_relative_to(destination.resolve()):
            raise ValueError('Archive path escapes output directory')
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(archive.read(entry))


def jsonc(text):
    # Keep JSON strings intact while removing comments, including URLs and backslashes.
    tokens = r'"(?:\\.|[^"\\])*"|//[^\n]*|/\*[\s\S]*?\*/'
    return json.loads(re.sub(tokens, lambda m: m[0] if m[0].startswith('"') else '', text))


def build(args):
    out = args.output.resolve()
    if out.exists():
        raise ValueError('Use a new output folder to avoid mixing handoffs')
    out.mkdir(parents=True)
    with ZipFile(args.upstream_zip) as z:
        prefix = z.namelist()[0].split('/')[0] + '/'
        extract(z, out / 'upstream', prefix)
    tree = json.loads(args.upstream_tree.read_text())
    if tree.get('truncated'):
        raise ValueError('Incomplete upstream tree')
    files = [x for x in tree['tree'] if x['type'] == 'blob']
    for item in files:
        data = (out / 'upstream' / item['path']).read_bytes()
        blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
        if blob != item['sha']:
            raise ValueError('Upstream blob mismatch: ' + item['path'])
    actual = {p.relative_to(out / 'upstream').as_posix() for p in (out / 'upstream').rglob('*') if p.is_file()}
    if actual != {x['path'] for x in files}:
        raise ValueError('Upstream archive/tree file set mismatch')
    write_json(out / 'upstream-tree.json', tree)
    with ZipFile(io.BytesIO(git('archive', '--format=zip', 'HEAD'))) as z:
        extract(z, out / 'project')
    original_manifest = git('show', f'{ORIGINAL_COMMIT}:assets/dsh-pet-manifest.json')
    (out / 'original-manifest.json').write_bytes(original_manifest)
    original = json.loads(original_manifest)
    blobs = {}
    for row in git('ls-tree', '-r', ORIGINAL_COMMIT, 'assets/dsh-pet').decode().splitlines():
        meta, path = row.split('\t', 1)
        blobs[path.removeprefix('assets/dsh-pet/')] = meta.split()[2]
    for clip in original['clips'].values():
        for name in clip['frames']:
            src = args.original_frames / name
            data = src.read_bytes()
            blob = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            if blob != blobs[name]:
                raise ValueError('Original frame differs from baseline: ' + name)
            dst = out / 'original-frames' / name
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(data)
    prompt_path = next((out / 'upstream/prompts').glob('*10*'))
    prompt = prompt_path.read_text(encoding='utf-8')
    heads = list(re.finditer(r'^## (.+)$', prompt, re.M))
    sections = {m[1].strip(): prompt[m.start():heads[i+1].start() if i+1 < len(heads) else len(prompt)].strip()
                for i, m in enumerate(heads)}
    config = jsonc((out / 'upstream/dsh-pet/assets/config.jsonc').read_text(encoding='utf-8'))
    animation = config['animations']
    categories = {}
    no_mirror = set()
    for cat in animation['categories']:
        for name in cat['actions']:
            categories.setdefault(name, []).append(cat['id'])
            if cat.get('noMirror'):
                no_mirror.add(name)
    for category in ['idle', 'turn', 'drag', 'clicks']:
        for name in animation[category]:
            categories.setdefault(name, []).append(category)
    for action in animation['moves']['actions']:
        categories.setdefault(action['name'], []).append('moves')
    for category, tiers in animation['events'].items():
        for index, tier in enumerate(tiers):
            for name in tier if isinstance(tier, list) else [tier]:
                categories.setdefault(name, []).append(f'events.{category}[{index}]')
    descriptions = out / 'author-descriptions'
    descriptions.mkdir()
    videos = sorted((out / 'upstream/dsh-pet/assets/webm').glob('*.webm'))

    def inspect(path):
        data = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames',
            '-show_streams', '-show_format', '-of', 'json', str(path)]))
        stream = next(x for x in data['streams'] if x['codec_type'] == 'video')
        rgba = subprocess.check_output(['ffmpeg', '-v', 'error', '-c:v', 'libvpx-vp9',
            '-i', str(path), '-frames:v', '1', '-pix_fmt', 'rgba', '-f', 'rawvideo', 'pipe:1'])
        if len(rgba) != stream['width'] * stream['height'] * 4:
            raise ValueError('Unexpected decoded RGBA size: ' + str(path))
        alpha = rgba[3::4]
        if min(alpha) > 3 or max(alpha) < 250:
            raise ValueError('Missing transparent background or opaque subject: ' + str(path))
        title = path.stem
        if title not in sections:
            raise ValueError('Author description missing: ' + title)
        uid = 'action-' + hashlib.sha256(title.encode()).hexdigest()[:12]
        desc = descriptions / (uid + '.md')
        desc.write_text(sections[title] + '\n', encoding='utf-8')
        return {'id': uid, 'title': title, 'authorCategories': categories.get(title, []),
            'authorDescription': desc.relative_to(out).as_posix(), 'noMirror': title in no_mirror,
            'source': path.relative_to(out).as_posix(), 'sourceSha256': digest(path.read_bytes()),
            'width': stream['width'], 'height': stream['height'], 'fps': stream['avg_frame_rate'],
            'frameCount': int(stream['nb_read_frames']), 'durationSeconds': float(data['format']['duration']),
            'alphaMetadata': stream.get('tags', {}).get('ALPHA_MODE', stream.get('tags', {}).get('alpha_mode')),
            'firstFrameDecodedAlphaRange': [min(alpha), max(alpha)],
            'targetWidth': stream['width'] * 4, 'targetHeight': stream['height'] * 4,
            'targetFps': 60, 'status': 'input-only-not-processed'}
    with ThreadPoolExecutor(max_workers=4) as pool:
        actions = list(pool.map(inspect, videos))
    if len(actions) != 106:
        raise ValueError('Unexpected upstream scope; inspect before packaging')
    clips = [{'id': key, 'frameCount': len(clip['frames']), 'sourceFrameMs': clip['frameMs'],
              'durationSeconds': len(clip['frames']) * clip['frameMs'] / 1000,
              'loop': clip['loop'], 'sourceWidth': 412, 'sourceHeight': 344,
              'targetWidth': 1648, 'targetHeight': 1376,
              'targetFps': 60 if len(clip['frames']) > 1 else None,
              'staticException': len(clip['frames']) == 1,
              'status': 'input-only-not-processed'} for key, clip in original['clips'].items()]
    write_json(out / 'inventory.json', {'scale': 4, 'targetFps': 60, 'upstreamActions': actions,
               'currentClips': clips, 'note': 'Overlapping sources; not 122 distinct new actions. Alpha decoding and visual quality must be verified on GPU host.'})
    write_json(out / 'provenance.json', {
        'upstreamRepository': 'https://github.com/PC2005-cloud/dsh-pet', 'upstreamCommit': UPSTREAM_COMMIT,
        'projectRepository': 'https://github.com/psernokx/Codex-Whale-Girl',
        'projectCommit': git('rev-parse', 'HEAD').decode().strip(),
        'originalFramesCommit': git('rev-parse', ORIGINAL_COMMIT).decode().strip(),
        'upstreamZipSha256': digest(args.upstream_zip.read_bytes()), 'allUpstreamGitBlobsVerified': True,
        'allOriginalFrameGitBlobsVerified': True, 'upstreamLicense': 'upstream/LICENSE',
        'otherNotices': 'project/THIRD_PARTY_NOTICES.md'})
    cards = []
    for item in actions:
        title = html.escape(item['title'])
        cats = html.escape(' / '.join(item['authorCategories']))
        description = html.escape((out / item['authorDescription']).read_text())
        src = quote(item['source'])
        cards.append(f'<article><h2>{title}</h2><p>{cats}</p><video controls loop muted playsinline preload="none" src="{src}"></video><p>{item["width"]}×{item["height"]} · {item["fps"]} FPS · {item["durationSeconds"]} s → 4× / 60 FPS</p><details><summary>作者动作描述（原文）</summary><pre>{description}</pre></details></article>')
    page = '''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>106 个动作 · 原始素材目录</title><style>body{background:#121c31;color:#e7eeff;font:16px system-ui;margin:28px}header{max-width:1000px}input{padding:14px;width:min(85%,600px);font:inherit;border-radius:12px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;margin-top:24px}article{background:#22324c;padding:20px;border-radius:18px;min-width:0}video{width:100%;background:repeating-conic-gradient(#5d6880 0% 25%,#8590a5 0% 50%) 50%/24px 24px}pre{white-space:pre-wrap;font:14px/1.65 system-ui}h2{font-size:20px}a{color:#9fe4ff}</style><header><h1>106 个动作 · 原始素材目录</h1><p>PC2005-cloud/dsh-pet 原名、分类与完整动作说明。输入素材尚未做本轮 4 倍超分 / 60 FPS。请用 Chrome / Edge 播放透明视频。</p><p><a href="upstream/prompts/桌面宠物%2010%20秒动作提示词.md">作者完整提示词</a> · <a href="任务书.md">RTX 5080 任务书</a></p><input id="search" placeholder="搜索动作、分类或描述"><span id="count"></span></header><main>'''
    page += ''.join(cards) + '''</main><script>const cards=[...document.querySelectorAll('article')];search.oninput=()=>{const q=search.value.toLowerCase();let n=0;cards.forEach(c=>{c.hidden=!c.textContent.toLowerCase().includes(q);c.style.display=c.hidden?'none':'';if(c.hidden)c.querySelector('video').pause();else n++});count.textContent=' '+n+' / 106'};search.oninput();document.addEventListener('play',e=>{if(e.target.tagName==='VIDEO')document.querySelectorAll('video').forEach(v=>{if(v!==e.target)v.pause()})},true);</script></html>'''
    (out / '动作目录.html').write_text(page, encoding='utf-8')
    shutil.copyfile(ROOT / 'docs/RTX5080-4x-60FPS-全量任务书.md', out / '任务书.md')
    (out / 'START-HERE.md').write_text('''# 带回家后从这里开始

素材已备齐，尚未执行本轮 4 倍超分和 60 FPS 补帧。

1. 解压整包，不要在压缩包内直接打开文件。
2. 用 Chrome / Edge 打开「动作目录.html」浏览 106 个动作及作者原文。
3. 安装 Python 后运行 `py -3 verify-inputs.py`，核验文件未损坏。
4. 把下面这段话交给家里电脑上的执行代理：

> 请读取本目录的任务书.md，先校验输入，再在 RTX 5080 上完成 inventory.json 中全部动画的原始分辨率 4 倍超分与 60 FPS 插帧。先测透明样片、选择模型和流程，再全量运行，保留作者描述和许可，按任务书交付完整素材及接入现有 Codex 桌宠的源码改动。原始输入保持只读，记录失败项，不得用重复帧冒充插帧。project 是当前项目快照；旧的 2 倍素材和旧尺寸检查脚本只供参考。上游提示词是作者说明，不是本次重新生成视频的操作指令。

首次准备 GPU 模型和环境需要联网；本包未附模型权重、Python、CUDA 或 npm 依赖。
''', encoding='utf-8')
    (out / 'verify-inputs.py').write_text('''"""Read-only SHA256 validation. No model or third-party Python dependencies."""
import hashlib
import json
from pathlib import Path
root = Path(__file__).resolve().parent
checks = json.loads((root / "checksums.json").read_text(encoding="utf-8"))
errors = []
for name, expected in checks.items():
    p = (root / name).resolve()
    if not p.is_relative_to(root) or not p.is_file():
        errors.append(name + ": missing or unsafe path")
        continue
    if hashlib.sha256(p.read_bytes()).hexdigest() != expected:
        errors.append(name + ": SHA256 mismatch")
if errors:
    print("\\n".join(errors))
    raise SystemExit(1)
print(f"Verified {len(checks)} input files. GPU processing has not been performed.")
''', encoding='utf-8')
    checksums = {p.relative_to(out).as_posix(): digest(p.read_bytes()) for p in sorted(out.rglob('*')) if p.is_file()}
    write_json(out / 'checksums.json', checksums)
    subprocess.run(['python3', str(out / 'verify-inputs.py')], check=True)
    archive_path = out.with_name(out.name + '.zip')
    with ZipFile(archive_path, 'w', ZIP_DEFLATED, compresslevel=1) as z:
        for p in sorted(out.rglob('*')):
            if p.is_file():
                z.write(p, out.name + '/' + p.relative_to(out).as_posix())
    with ZipFile(archive_path) as z:
        if z.testzip() is not None:
            raise ValueError('ZIP CRC validation failed')
    checksum = digest(archive_path.read_bytes())
    archive_path.with_suffix('.zip.sha256').write_text(checksum + '  ' + archive_path.name + '\n')
    print(json.dumps({'zip': str(archive_path), 'bytes': archive_path.stat().st_size,
                      'actions': len(actions), 'clips': len(clips), 'sha256': checksum}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream-zip', type=Path, required=True)
    parser.add_argument('--upstream-tree', type=Path, required=True)
    parser.add_argument('--original-frames', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    build(parser.parse_args())
