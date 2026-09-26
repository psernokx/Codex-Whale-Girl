"""Restore original alpha and encode 2x model outputs as runtime WebP frames.

Use after (or while) Real-ESRGAN writes clip__frame.png into --inference.
Original files are read-only; keep them outside the output directory.
"""
import argparse
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from PIL import Image


def convert(source, inference, output):
    model = inference / (source.parent.name + '__' + source.stem + '.png')
    if not model.exists():
        return False
    try:
        with Image.open(source) as im:
            original = im.convert('RGBA')
        with Image.open(model) as im:
            enhanced = im.convert('RGBA')
    except (OSError, ValueError):
        return False  # The inference process may still be writing this frame.
    expected = tuple(value * 2 for value in original.size)
    if enhanced.size != expected:
        raise ValueError(f'Unexpected model size: {model.name}: {enhanced.size}')
    enhanced.putalpha(original.getchannel('A').resize(expected, Image.Resampling.LANCZOS))
    target = output / source.parent.name / source.name
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix('.webp.tmp')
    enhanced.save(temporary, format='WEBP', quality=95, method=1)
    temporary.replace(target)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--originals', type=Path, required=True)
    parser.add_argument('--inference', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    if args.originals.resolve() == args.output.resolve():
        parser.error('Keep original frames in a separate backup directory')
    pending = set(args.originals.rglob('*.webp'))
    total = len(pending)
    if not total:
        parser.error('No original frames found')
    deadline = time.monotonic() + 3600
    last_report = -1
    with ThreadPoolExecutor(max_workers=4) as pool:
        while pending:
            available = [p for p in sorted(pending) if (args.inference / (p.parent.name + '__' + p.stem + '.png')).exists()]
            results = pool.map(lambda p: convert(p, args.inference, args.output), available)
            for source, success in zip(available, results):
                if success:
                    pending.remove(source)
            completed = total - len(pending)
            if completed // 100 != last_report or not pending:
                print(f'{completed}/{total} frames encoded', flush=True)
                last_report = completed // 100
            if time.monotonic() > deadline:
                raise TimeoutError(f'{len(pending)} model outputs are still missing')
            if pending:
                time.sleep(2)
    print('All frames are 2x, with original alpha preserved.', flush=True)


if __name__ == '__main__':
    main()
