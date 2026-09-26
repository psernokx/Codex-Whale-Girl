"""Regenerate the app icons from the MIT-licensed whale idle frame (Pillow)."""
from pathlib import Path
import shutil
import subprocess
import tempfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
output = root / 'build' / 'icons'
output.mkdir(parents=True, exist_ok=True)
source = Image.open(root / 'assets/dsh-pet/idle/idle_061.webp').convert('RGBA')
# Ignore near-transparent frame-edge pixels when fitting the character.
source = source.crop(source.getchannel('A').point(lambda alpha: 255 if alpha >= 32 else 0).getbbox())
source.thumbnail((920, 920), Image.Resampling.LANCZOS)
# Upscale this existing frame only for the required icon canvas sizes.
ratio = min(920 / source.width, 920 / source.height)
source = source.resize((round(source.width * ratio), round(source.height * ratio)), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', (1024, 1024))
canvas.alpha_composite(source, ((1024 - source.width) // 2, (1024 - source.height) // 2))
canvas.save(output / 'icon.png')
canvas.save(output / 'icon.ico', sizes=[(n, n) for n in (16, 24, 32, 48, 64, 128, 256)])
if shutil.which('iconutil'):
    with tempfile.TemporaryDirectory() as temporary:
        iconset = Path(temporary) / 'Whale.iconset'
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                suffix = '@2x' if scale == 2 else ''
                canvas.resize((size * scale, size * scale), Image.Resampling.LANCZOS).save(iconset / f'icon_{size}x{size}{suffix}.png')
        subprocess.run(['iconutil', '-c', 'icns', str(iconset), '-o', str(output / 'icon.icns')], check=True)
