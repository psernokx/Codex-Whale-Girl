# 🐋 小鲸鱼看板娘 · Codex + DeepSeek

在原版小鲸鱼桌宠上新增 **Codex 用量、最近对话和工作状态动画**，保留 DeepSeek 余额、问答、用量统计以及原来的桌宠互动。目标平台为 Windows、macOS 和 Linux。

## 来源与分支关系

本仓库是 [GarfieldZhung/DeepSeek-Whale-Girl](https://github.com/GarfieldZhung/DeepSeek-Whale-Girl) 的 fork：沿用其 Electron 应用、桌宠界面、互动、DeepSeek 功能和原有静态素材。

动态动画和动作配置来自 [QCYTSN/dsh-dafeiyu](https://github.com/QCYTSN/dsh-dafeiyu)，其动画素材来源为 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。本分支将这些动画接入 Electron，并按使用习惯重新对应：查找资料时翻任务单，工作、运行命令和测试时显示工具环绕，出错时显示汗滴和红叉。无需安装 DeepSeek Harness。

上述项目均保留原作者署名和相应许可；完整说明见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本仓库为非官方社区扩展，与 OpenAI、DeepSeek 均无隶属或背书关系。

<p align="center">
  <img src="assets/whale/whale-maid.png" width="320" alt="小鲸鱼看板娘">
</p>

> “主人，Token 不是零食……至少不能一口气全吃掉嘛！”

你好呀，这里是 **大肥鱼**——一只住在桌面上的深蓝色女仆小鲸鱼。

平时她会安静地在屏幕角落发呆、打游戏、看电影，偶尔努力跑步减肥；需要时也能帮你查看 Codex 用量，以及可选的 DeepSeek 余额和问答用量。她脾气很好，但连续摸头太多次，真的会咬住你的手撒娇。

桌宠支持静态角色图和动态形象。可在设置中切换“动态小鲸鱼”：使用 `QCYTSN/dsh-dafeiyu` 的 MIT 许可动画帧，让悬浮待机、思考、拖动、摸头、等待与完成等状态动起来；选择“荡秋千”等原有动作时仍使用对应静态形象。动态播放沿用素材配置的约 24 fps，系统开启“减少动态效果”时自动退回静态形象。

> [!IMPORTANT]
> 这是非官方社区项目，与 DeepSeek 无隶属、合作或背书关系。原有静态角色基础图由项目发起者提供，但原作者和再分发许可尚未核实；项目的 MIT License **不覆盖图片素材**中的原有静态图。新增动态帧另有 MIT 许可。公开分发或商用原有静态素材前，请先取得图片权利人的许可。详细说明见[角色和素材从哪里来？](#角色和素材从哪里来)。

## 她能做什么？

- 🫧 **安静挂机**：悬浮可播放动态帧；荡秋千、玩游戏、看电影、跑步减肥等原有静态待机状态仍可切换。
- 💬 **陪你问答**：点击脚下的“问问小鲸鱼”，直接打开漫画风问答卡。
- 🍰 **记住吃掉的 Token**：统计桌宠问答产生的缓存命中、未命中输入、模型输出与估算费用。
- 💰 **看看饭钱还剩多少**：查询 DeepSeek API 余额，免得聊到一半突然饿肚子。
- 🫳 **可以摸头**：摸一下会播放橡皮小鸭般的可爱按压声；连续摸五次，她会咬住你的手进入冷却。
- 🐳 **会闹小情绪**：拖拽、思考、吃饱、咬手等场景都有独立状态图和符合人设的对白。
- 🌙 **动静可选**：动态帧按素材配置的约 24 fps 播放，也可在设置中切回原有静态形象。

### Codex 用量与工作状态

左下方的小用量牌持续显示总剩余额度；账号提供 5 小时窗口时同时显示 5h 剩余。点击小牌进入原来的用量详情页，点击面板外空白处、桌面或其他应用即可收起，后台每 5 分钟刷新。用量牌放在角色与脚下互动按钮之外，不扩展窗口。气泡尖角随人物位置和文本宽度定位，工作气泡更靠近人物，并跟随系统使用浅色或深蓝配色。

本分支可通过已登录的 Codex 命令行程序读取额度窗口、重置时间、Token 汇总和最近的每日用量。双击小鲸鱼，在原有动作轮盘中点击“查看用量”打开看板，再用 Codex / DeepSeek / 对话标签切换。“对话”页显示最近更新的 Codex 对话标题、最近一轮用户消息和本机工作阶段，点击即可在 Codex 中打开。工作时，小鲸鱼会按思考、查找、修改、运行、测试和完成等阶段切换动态动作。原有 DeepSeek 余额、用量、问答和桌宠动作均保留；只有使用 DeepSeek 问答时才需要 DeepSeek API Key。

Codex 用量与对话索引来自官方 App Server 的只读 `account/rateLimits/read`、`account/usage/read`、`thread/list` 与 `thread/turns/list` 接口。工作阶段通过只读本机 Codex 任务事件文件判断；同时读取本机任务索引与目标数据库，将进行中的持续目标置于监控和对话列表前面，使用索引记录的最新日志路径。目标不会受到最近对话条数限制，两轮间显示“目标进行中”，暂停、阻塞或额度限制会单独标明。桌宠不读取或保存 `~/.codex/auth.json`，也不保存对话正文。额度百分比与 Token 活动是不同指标，不能按 Token 数推算剩余额度。桌宠展示最近活跃任务，不宣称识别 Codex 桌面窗口当前聚焦的对话；事件文件格式若随 Codex 更新而改变，动态监控可能暂时失效，但看板和手动动作仍可使用。

问答等待期间出现的“碎碎念”是本地预设台词，不是模型隐藏思维链。问题和回答正文也不会被写进本地文件。

## 怎么和她相处？

| 你的操作 | 小鲸鱼的反应 |
| --- | --- |
| 单击角色 | 开心接受摸头 |
| 连续摸头 5 次 | 咬住手并进入摸头冷却 |
| 左键双击角色 | 展开待机动作轮盘 |
| 长按角色 | 被提起来并跟随鼠标拖动 |
| 右键角色 | 打开设置 |
| 点击脚下按钮 | 打开问答卡 |
| 双击角色后点击“查看用量” | 打开 Codex / DeepSeek 用量看板 |

## 把小鲸鱼接回家

仓库的 GitHub Actions 分别在三个系统上运行测试和打包，构建产物位于 [Actions](https://github.com/psernokx/Codex-Whale-Girl/actions) 对应运行的 Artifacts 中：

| 系统 | 构建产物 | 说明 |
| --- | --- | --- |
| Windows | x64 `.exe` 安装包 | 原生 Windows 桌宠与 Codex CLI |
| macOS | Universal `.dmg`、`.zip` | Apple Silicon 与 Intel |
| Linux | x64 `.AppImage`、`.tar.gz` | 建议 X11；Wayland 下拖动、置顶与托盘行为取决于桌面环境 |

本地开发需要 Node.js 22 或更新版本：

```sh
npm ci
npm start
```

在相应系统上执行 `npm run dist:win`、`npm run dist:mac`、`npm run dist:linux` 生成安装包。macOS 的自动构建包未进行开发者签名和公证，Windows 包未做代码签名。

使用 Codex 功能前，请安装并登录 Codex 桌面应用或 Codex CLI。应用优先采用明确设置的 `CODEX_BINARY`，随后从正在运行的 Codex 程序定位安装目录，再查找常见安装位置和系统 PATH；支持 macOS、Windows 和 Linux 的自定义安装目录。进程发现只读取程序名称、路径及进程关系，不读取内存或命令行参数，详见 [进程发现与隐私](SECURITY.md#codex-进程发现与隐私)。找不到时，可通过 `CODEX_BINARY` 指定 Codex 可执行文件的完整路径；需要自定义数据目录时使用 `CODEX_HOME`。Windows 支持 npm 安装产生的 `codex.cmd`，无需经过命令解释器拼接路径。Windows 桌宠读取原生 Windows 的 Codex 会话，不会自动读取 WSL 内的会话。

只装 CLI 也能读取可用的额度和任务信息；点击对话跳转需要系统注册了 `codex://` 协议的 Codex 桌面应用。部分 CLI 版本不提供累计 Token 等扩展字段，此时仍显示可用额度。Linux 使用 DeepSeek API Key 时需要可用的系统密钥环。

若要使用 DeepSeek 问答，第一次启动后右键小鲸鱼打开设置，填入自己的 DeepSeek API Key。Key 只会交给 Electron 主进程，并使用系统安全存储加密。

> [!CAUTION]
> 不要把真实 API Key 发进 Issue、聊天截图、源码、Release 说明或 GitHub Actions 日志。如果 Key 曾经进入 Git 历史，请立即在服务端撤销并重新生成。


## 她会把什么留在电脑里？

只有两类本地数据：

- `config.json`：加密后的 API Key 与本地设置。
- `usage.json`：余额历史、Token 数量与估算费用，不包含问题或回答正文。

在设置页点击“数据目录”可以直接查看。它们已经写入 `.gitignore`，请不要手动上传。

## 进程读取与隐私

**桌宠会读取本机进程信息**，用于自动找到 Codex 的安装位置，以及判断它退出后是否应该停止工作动画。

- 读取范围：进程名称、程序路径、PID 和父 PID；不读取进程内存、命令行参数或窗口内容。
- 进程列表仅在内存中处理，不保存、不上传。程序路径可能包含用户名，因此仍属于需要说明的本机隐私信息。
- Windows 的普通本地进程查询通常不会弹出 UAC 授权框。本程序不主动请求管理员权限；受权限或系统策略限制时，路径可能不可用，程序会回退到常见位置和 PATH。
- 不保证所有安全软件都不提示或拦截。没有授权弹窗，也不意味着完全没有隐私影响。

更多边界见 [SECURITY.md：Codex 进程发现与隐私](SECURITY.md#codex-进程发现与隐私)。Windows 权限行为参考微软的 [WMI 与 UAC](https://learn.microsoft.com/en-us/windows/win32/wmisdk/user-account-control-and-wmi) 和 [Win32_Process](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-process) 文档。

## 安全防线

可爱归可爱，边界还是要认真守住：

- Electron 渲染进程启用 `sandbox` 与 `contextIsolation`，关闭 Node.js 集成。
- 禁止新窗口、外部导航和浏览器权限请求；IPC 会校验调用页面来源。
- DeepSeek 功能仅向固定的 DeepSeek 官方 HTTPS API 发起余额和问答请求；Codex 看板通过本机 Codex App Server 读取账号用量与对话索引，并只读本机任务事件判断工作阶段。
- API Key 使用操作系统 `safeStorage` 加密；安全存储不可用时拒绝明文保存。
- 问答有长度、响应体、并发、频率和超时限制，模型回复以纯文本方式展示。
- 应用不监听本地或公网端口，不提供网页状态检测或本地用量接收服务，因此不需要开放入站防火墙规则。
- 问题和回复不落盘，本地只保存必要的用量汇总与余额历史。

完整安全边界和漏洞报告方式见 [SECURITY.md](SECURITY.md)。这些措施用于降低风险，不代表任何软件可以绝对安全。

## 角色和素材从哪里来？

- `assets/whale/whale-maid.png` 是项目发起者提供的社区二创参考图。
- 项目讨论中出现过抖音短链 `https://v.douyin.com/HHBVz-khRA0/`，它只是素材发现线索，不能证明视频发布者是原作者，也不能作为再分发授权。
- 其余状态图以基础图为角色一致性参考，通过 OpenAI 图像生成工具制作。
- 小鲸鱼是非官方社区二创角色，不是 DeepSeek 官方角色、产品素材或官方背书。
- DeepSeek 名称和标识归其相应权利人所有。
- 根目录 MIT License 只覆盖程序代码，不会自动授予 PNG 图片的使用权。

公开仓库、Release、宣传或商用前，请先找到图片权利人并取得许可，然后在这里补上准确署名。

完整素材清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 和 [assets/whale/README.md](assets/whale/README.md)。

## 一起养鲸鱼

Bug、台词、轻量交互和安全改进都欢迎参与。

如果她在桌面角落安静地陪了你一天，也别忘了偶尔点一下她的头。只是……五次以内比较安全。🐋

### 调整桌宠大小

右键小鲸鱼 → 设置，可分别调整「人物大小」与「额度大小」，范围均为 50%～150%。松开滑块后自动保存；额度大小独立于人物，气泡跟随人物缩放。超出屏幕可用范围时会自动限制显示大小。当前动画仍使用原始分辨率素材，放大不会增加图像细节。
