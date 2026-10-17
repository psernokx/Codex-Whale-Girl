# 输入与输出 Token 速率

用量牌常驻显示输入/输出 tok/s，点击查看响应时间区间、缓存和推理计数。统计范围为当前监控选中的会话；没有工作时可展示最近响应，45 秒没有新用量记录后数字失效。Codex 退出后立即显示未运行，不保留“实时”数字。

## 统计口径

- 从本机 Codex sessions 的 JSONL 用量事件增量读取，支持 `token_usage_record` 与旧版 `event_msg/token_count`。
- 输入 = 本次报告的 input_tokens（含缓存）÷ 从请求开始或上次工具返回到用量记录的时间。因此是请求吞吐估算，不能当作精确的 prefill 速度。详情列出缓存量。
- 输出 = 本次 output_tokens ÷ 助手 Reasoning/AgentMessage item 开始到用量记录的时间。没有 item 时间戳时用请求区间；没有请求边界时以相邻累计记录差分估算。思考 Token 通常已经包含在 output_tokens，不能再相加。
- 计数重复、时间倒序与计数重置不会产生负数或无限速率。缺少有效边界、区间小于 0.2 秒或过长时不计算。相邻记录差分最多允许 120 秒，明确请求最多 600 秒。
- 日志按响应写入，数值在收到记录后才更新。工具运行期间和等待期间不会伪造逐秒 Token 数；界面标注“最近响应 · 估算”。

## 开源参考

参考以下项目公开描述的统计方式，独立实现本项目的计数状态机和三端 Electron 界面，没有复制其代码：

- [d-ridelman/token-pulse](https://github.com/d-ridelman/token-pulse)：响应边界、item 时间与累计 token_count 差分；其 README 同样明确区分估算吞吐与精确解码速度。
- [petergpt/codex-speed-monitor](https://github.com/petergpt/codex-speed-monitor)：本地速度监控及剔除工具耗时的思路。本项目不启用其遥测代理或修改 Codex 设置。

所有会话内容、路径和用量记录留在本机；不会写入 GitHub 发布资源。读取权限范围沿用现有 Codex 状态监控。
