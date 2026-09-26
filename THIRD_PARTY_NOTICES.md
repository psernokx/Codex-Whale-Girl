# Third-party notices / 第三方与素材声明

## Application upstream: DeepSeek-Whale-Girl

This repository is a fork of GarfieldZhung/DeepSeek-Whale-Girl:
https://github.com/GarfieldZhung/DeepSeek-Whale-Girl

The Electron application, original UI and interactions, DeepSeek integration,
and original static assets derive from that project. The original program
license and copyright notice remain in `LICENSE` (Copyright (c) 2026 Whale Girl
Dashboard contributors). Original static artwork has the separate limitations
stated below; it is not relicensed by this fork.

## Animation and state-design upstream: dsh-dafeiyu

https://github.com/QCYTSN/dsh-dafeiyu

The frame manifest and animation/state design were adapted from QCYTSN's
project. Its MIT license (Copyright (c) 2026 QCYTSN) is preserved in
`assets/dsh-dafeiyu-LICENSE.txt`. This fork uses an Electron player and adds a
Codex adapter; it does not require the DeepSeek Harness runtime.

## Dynamic whale-maid animation

`assets/dsh-pet/` contains transparent WebP animation frames from
`QCYTSN/dsh-dafeiyu` (MIT), converted there from the `PC2005-cloud/dsh-pet`
animation set (Copyright (c) 2026 PC2005-cloud, MIT). The upstream MIT license
is included verbatim at `assets/dsh-pet-LICENSE.txt`. The animation player in
this application is an independent Electron implementation. The archived
`legacy/dafeiyu/` frames in that repository have a separate restricted notice
and are not included here.

- https://github.com/QCYTSN/dsh-dafeiyu
- https://github.com/PC2005-cloud/dsh-pet

## Animation super-resolution processing

The 2,600 frames in `assets/dsh-pet/` were processed at 2x resolution using
Real-ESRGAN's `realesr-animevideov3` model (v0.2.5.0 release):
https://github.com/xinntao/Real-ESRGAN
https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan

RGB uses the model output. Alpha is resized from each original frame using
Lanczos filtering, then the result is encoded as WebP quality 95 (method 1). No additional
contrast adjustment is applied. Frame count, order, and timing are unchanged.
Super-resolution does not change the upstream artwork's license or attribution.
The model and inference executable are local processing tools and are not
included in the application package. `scripts/finish-upscaled-frames.py` records
the alpha-restoration and encoding step. Original frames remain recoverable
from Git history before the super-resolution commit.

## Application icons

`build/icons/icon.png`, `icon.ico`, and `icon.icns` are resized exports of
`assets/dsh-pet/idle/idle_061.webp` from the MIT-licensed animation above.

## User-supplied whale-maid image

The base character file at `assets/whale/whale-maid.png` was supplied by the
project initiator as a community-created visual reference. Its original artist,
first publication source, and redistribution license have not been verified.
The MIT license for the application code does **not** grant rights to this image.

A Douyin short link (`https://v.douyin.com/HHBVz-khRA0/`) was supplied in the
project discussion as a discovery reference. It is not proof of authorship,
ownership, or redistribution permission.

The following state images were generated with OpenAI's built-in image
generation tool using the user-supplied image as the character reference:

- `assets/whale/whale-drag-panic.png`
- `assets/whale/whale-working-desk.png`
- `assets/whale/whale-busy-cry.png`
- `assets/whale/whale-headpat.png`
- `assets/whale/whale-satiated.png`
- `assets/whale/whale-bite-hand.png`
- `assets/whale/whale-idle-swing.png`
- `assets/whale/whale-idle-game.png`
- `assets/whale/whale-idle-movie.png`
- `assets/whale/whale-idle-running.png`
- V1.5 transitions and 120 animation frames are preserved locally under `archive/v1.5-animation-assets/`; they are excluded from current packages and ignored by the GitHub-ready configuration.

Generated variations may still depend on rights in the supplied source image;
their presence does not resolve or replace the source artwork's license.

The character is an unofficial community creation and is not an official
DeepSeek product or endorsement. DeepSeek names and marks belong to their
respective owner. Obtain permission from the image rights holder and add accurate
attribution before public redistribution, GitHub Releases, promotional use, or commercial use.

## Cost-tracking design reference

The completed-turn aggregation and three-bucket pricing design was informed by
`ZhaYi-Miao/dsh-survival-cost`, released under the MIT License:

- Source: https://github.com/ZhaYi-Miao/dsh-survival-cost
- Copyright (c) 2026 ZhaYi-Miao

This project contains an independent implementation adapted for a standalone
Electron application.
