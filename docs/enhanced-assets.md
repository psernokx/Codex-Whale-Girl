# 高清素材恢复与分发

完整 4 倍/60 FPS 素材保留在 `assets/dsh-pet-4x60/` 和 `assets/action-library/`；状态播放副本在 `assets/pet-runtime/`。原作者 106 份动作描述、动作清单、状态映射和许可证都在源码仓库。

大型二进制通过仓库的 `assets-4x60-v1` GitHub Release 发布，分四包，每包小于 2 GB。`assets/enhanced-assets.lock.json` 固定每包及每个文件的 SHA256 和大小，避免将几 GB 素材写入 Git 历史。

```sh
npm run assets:fetch
npm ci
npm test
npm start
```

恢复使用 Node.js 22+ 的内置下载功能和系统 `tar`（macOS/Linux 自带，现代 Windows 内置）。已校验的资源不会重复下载。`npm run assets:check` 可只检查本地文件。离线恢复：

```sh
node scripts/fetch-enhanced-assets.mjs --offline-dir /path/to/downloaded-packs
```

脚本先核对整包 SHA256 和归档路径，再解包并核对文件 SHA256。构建任务在测试/打包前恢复素材，三端使用相同清单。`scripts/package-enhanced-assets.py` 可重建资源包，但 gzip 元数据变化会影响整包哈希；更新后应同时更新清单与发布附件，不要覆盖已固定的发布版本。

2026-10-18 清理：先核对 6,770 个保留文件与旧导入副本一致，再删除导入解包目录、旧安装备份、超分模型/中间帧和旧 5080 交接包。当前代码、高清素材、作者说明及正在使用的应用保留。历史接入记录中的部分 artifacts 路径已清理；核验报告移至本地 `artifacts/verification/`（不上传）。
