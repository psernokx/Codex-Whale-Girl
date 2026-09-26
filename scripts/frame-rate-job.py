"""Plan and validate a transparent-frame interpolation job; does not run a model."""
import argparse
import hashlib
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def timeline(count, frame_ms, loop, fps):
    if count == 1:
        return [(0, 0, 0.0)]
    duration = count * frame_ms
    output_count = math.ceil(duration * fps / 1000 - 1e-9)
    result = []
    for k in range(output_count):
        position = k * 1000 / fps / frame_ms
        left = min(int(position), count - 1)
        right = (left + 1) % count if loop else min(left + 1, count - 1)
        result.append((left, right, position - left if left != right else 0.0))
    return result


def plan(root, fps, destination):
    raw = (root / 'assets/dsh-pet-manifest.json').read_bytes()
    manifest = json.loads(raw)
    job = {'status': 'planned-not-rendered', 'targetFps': fps,
           'sourceManifestSha256': hashlib.sha256(raw).hexdigest(), 'clips': {}}
    expected = json.loads(raw)
    expected['frameInterpolation'] = {'status': 'planned', 'targetFps': fps,
                                     'sourceManifestSha256': job['sourceManifestSha256']}
    for name, clip in manifest['clips'].items():
        samples = timeline(len(clip['frames']), clip['frameMs'], clip['loop'], fps)
        paths = [f'{name}/{name}_{k + 1:04d}.webp' for k in range(len(samples))]
        job['clips'][name] = {
            'sourceFrames': clip['frames'],
            'sourceSha256': [hashlib.sha256((root / 'assets/dsh-pet' / p).read_bytes()).hexdigest() for p in clip['frames']],
            'sourceFrameMs': clip['frameMs'], 'loop': clip['loop'],
            'sourceDurationMs': len(clip['frames']) * clip['frameMs'],
            'samples': [{'left': a, 'right': b, 't': t, 'output': output}
                        for (a, b, t), output in zip(samples, paths)]}
        expected['clips'][name]['frames'] = paths
        expected['clips'][name]['frameMs'] = 1000 / fps if len(samples) > 1 else clip['frameMs']
        expected['clips'][name]['posterTimeMs'] = min(120 if name == 'working' else 60, len(clip['frames']) - 1) * clip['frameMs']
    destination.mkdir(parents=True, exist_ok=True)
    (destination / 'timeline.json').write_text(json.dumps(job, ensure_ascii=False, indent=2), encoding='utf-8')
    (destination / 'expected-manifest.json').write_text(json.dumps(expected, ensure_ascii=False, indent=2), encoding='utf-8')
    rows = ['clip,source_frames,output_frames,source_duration_ms,output_duration_ms']
    for name, clip in job['clips'].items():
        out = expected['clips'][name]
        rows.append(f"{name},{len(clip['sourceFrames'])},{len(out['frames'])},{clip['sourceDurationMs']},{len(out['frames'])*out['frameMs']:.6f}")
    (destination / 'summary.csv').write_text('\n'.join(rows)+'\n', encoding='utf-8')
    print(f"Plan only: {sum(len(c['samples']) for c in job['clips'].values())} output frames, {len(job['clips'])} clips; no interpolation performed.")


def validate(job_dir, output):
    from PIL import Image
    expected = json.loads((job_dir / 'expected-manifest.json').read_text(encoding='utf-8'))
    actual = json.loads((output / 'assets/dsh-pet-manifest.json').read_text(encoding='utf-8'))
    interpolation = actual.get('frameInterpolation', {})
    if interpolation.get('status') != 'complete' or not interpolation.get('modelSha256'):
        raise ValueError('Output must record completed interpolation and the model SHA256')
    if interpolation.get('sourceManifestSha256') != expected['frameInterpolation']['sourceManifestSha256']:
        raise ValueError('Source manifest mismatch')
    if set(actual['clips']) != set(expected['clips']):
        raise ValueError('Clip set mismatch')
    for key in ['stateMap', 'workingActivityMap', 'idleMicroClips']:
        if actual.get(key) != expected.get(key):
            raise ValueError(f'{key} changed')
    count = 0
    for name, planned in expected['clips'].items():
        got = actual['clips'][name]
        for key in ['frames', 'loop', 'posterTimeMs']:
            if got.get(key) != planned[key]:
                raise ValueError(f'{name}: {key} mismatch')
        if abs(got['frameMs'] - planned['frameMs']) > 1e-6:
            raise ValueError(f'{name}: timing mismatch')
        for frame in got['frames']:
            image_path = (output / 'assets/dsh-pet' / frame).resolve()
            if not image_path.is_relative_to((output / 'assets/dsh-pet').resolve()):
                raise ValueError('Frame outside output directory')
            with Image.open(image_path) as image:
                image.load()
                if image.size != (824, 688) or image.mode != 'RGBA':
                    raise ValueError(f'{frame}: expected 824x688 RGBA')
                if image.getchannel('A').getextrema()[0] != 0:
                    raise ValueError(f'{frame}: transparent background missing')
            count += 1
    print(f'Structural validation passed: {count} frames. Visual, true-interpolation and playback checks still required.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    p = sub.add_parser('plan')
    p.add_argument('--root', type=Path, default=ROOT)
    p.add_argument('--fps', type=int, choices=[30, 60], default=60)
    p.add_argument('--out', type=Path, default=ROOT / 'artifacts/frame-rate-60')
    p = sub.add_parser('validate')
    p.add_argument('--job', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'plan':
        plan(args.root, args.fps, args.out)
    else:
        validate(args.job, args.output)
