# Token Speed Implementation Plan

**Goal:** 清理重复生成文件，保留完整高清素材，实现诚实标注的输入/输出 tok/s 并同步可重建仓库。

**Architecture:** 现有 rollout 增量解析器增加纯函数计数状态。主进程复用活动消息向界面推送选中会话的速率；初始化缓存/退出/过期使用同一逻辑。

**Tech Stack:** Node.js, Electron, SQLite, JavaScript, tar/gzip, GitHub Releases.

1. 校验 `assets/` 与旧解包素材一致；保留检查报告，删除 artifacts 中重复副本及 tools-local 已完成处理的模型。
2. 在 `test/token-speed.test.mjs` 写边界行为测试；实现 `src/token-speed.mjs`，接入 `src/codex-monitor.mjs` 的增量解析。先运行失败测试，再实现并验证。
3. 修改 `renderer/index.html`, `renderer/app.js`, `renderer/styles.css`；使用量牌和详情显示输入/输出估算与状态，保持独立缩放布局。主进程消息去重包含速率状态。
4. 更新集成检查，验证推送、过期、没有数据、缩放与工作状态共存；运行单元测试和安装版检查。
5. 生成高清资源包、SHA256 清单及跨平台恢复脚本；资源不加入 Git 历史。CI 增加恢复步骤，保留来源/许可证说明。
6. 发布资源附件，提交并推送 codex-desktop，核对远端提交与资源。更新本机安装版，清理本次构建中间副本。
