# Steer Apple Watch

## Build 23：话筒贴近屏幕底边

语音入口改用独立底部容器定位，延伸到底部安全区，避免 ScrollView 的底部让按钮悬在正文中间。保持小圆形话筒、水平居中及正文末尾避让，仅保留短底边间距。无语音入口的任务沿用原安全区。

两端签名构建与结果页位置／滚动交互检查通过。iPhone 与 Watch 均已安装 Build 23，Watch 已启动；实体 Watch 的最终位置需用户验收。包在 `apple/.cache/build23/SteerPhone.app`，安装记录见 `docs/ui-validation/build23/VALIDATION.md`。

## Build 22：话筒按钮底部居中

结果页的小圆形话筒改为底部居中，尺寸、点击区域及正文末尾留白不变。两端签名构建通过，iPhone 与 Watch 均已安装 Build 22，Watch 已启动。包在 `apple/.cache/build22/SteerPhone.app`；安装记录见 `docs/ui-validation/build22/VALIDATION.md`。

## Build 21：小话筒入口与精简失败页

结果页以右下角小圆形话筒图标代替全宽语音继续按钮，移除黑色矩形底栏；正文末尾留出图标空间，不永久缩减整个阅读视口。语音失败页移除“返回任务”，只保留重试与左上关闭。语音资格、重试与关闭逻辑保持原规则。

两端签名构建、两项隔离原生交互回归检查通过。手机与 Watch 均已安装 Build 21，Watch 已启动。安装与验证记录见 `docs/ui-validation/build21/VALIDATION.md`。包在 `apple/.cache/build21/SteerPhone.app`。

## Build 20：精简语音确认页

普通语音确认仅显示关闭、识别文字和底部固定发送；移除识别引擎标签、确认发送标题及重复的项目／Agent／会话信息。未确认发送的恢复重试才显示一行目标会话标题。关闭普通草稿清除内容，关闭待确认发送保留正文与原幂等键。录音页不再重复任务标题。

两端签名构建和两项隔离 iOS 交互检查通过，覆盖长文字时发送可点、普通草稿清除及待确认请求正文／幂等键保留。手机与 Watch 均已安装 Build 20，Watch 成功启动；手机自动启动因锁屏被拒绝。详情见 `docs/ui-validation/build20/VALIDATION.md`。包位于 `apple/.cache/build20/SteerPhone.app`。

## Build 19：紧凑设置与语音验证分层

设置首页采用紧凑的只读状态行：“后台通知／服务端未启用”等真实通知状态，以及当前语音转写方式。去掉配对回执与系统 Section 大间距；Debug 语音验证收进独立页面，测试开关和模型选择的原配置不变。后台通知提示不是配置开关，本轮未启用服务端 APNs。

两端签名构建及一项现有原生设置导航回归通过。恢复连接后 iPhone 已安装并启动；Watch 安装请求两次超时，延长等待后成功安装、启动，再次读取设备信息确认 Build 19。两端均已更新。包在 `apple/.cache/build19/SteerPhone.app`；安装及验证范围见 `docs/ui-validation/build19/VALIDATION.md`。

## Build 18：设置按钮对齐原型圆形外观

修复真机上右上角设置按钮被 `.bordered` 样式拉成竖向胶囊的问题。改用 plain 按钮，显式绘制 36×36 圆形深灰背景与 1pt 细描边，保留 44×44 点击区域和原设置导航。统计及任务分类导航未改动。

iPhone／Watch 签名构建通过，两端安装包版本均为 18，保存于 `apple/.cache/build18/SteerPhone.app`。设备连接超时后重试成功，实体 Watch 已安装 Build 18。详细记录见 `docs/ui-validation/build18/VALIDATION.md`；实际圆形外观仍需真机确认。

## Build 17：独立分类导航与紧凑 Watch 首页

首页改为双栏任务入口与双栏累计统计，移除重复的 Steer 标题。设置只在首页右上角，以灰色系统圆形工具栏按钮呈现；保留 watchOS 系统时间。默认使用一屏布局，空间不足时选择紧凑版本，大字号再回退到无滚动条的滚动内容。

进行中页面仅包含运行任务：左右滑动到末尾停止，零任务时只保留空状态，不提供所有任务入口。所有任务列表移除工具栏刷新入口；分类之间必须返回首页切换，列表详情使用独立系统导航返回原列表。任务运行时最新指令和运行时间仍可见，时间与 Agent 同行；完成结果页保留顶部朗读和底部语音继续，运行任务不能发起新的语音追问。

验证：25 项 Swift 核心测试、3 项隔离 iOS 宿主导航／语音回归检查和 iPhone／Watch 签名构建通过。物理 Watch 已安装 Build 17 并成功启动。iPhone 当前连接不可用，安装尚未成功；包含新版 Watch 的手机安装包保存在 `apple/.cache/build17/SteerPhone.app`。交互宿主不是 watchOS，实际系统工具栏间距与最小表型布局仍需真机验收。详情见 `docs/ui-validation/build17/VALIDATION.md`。

## Build 16：Watch 统计首页与结果操作

Watch 默认进入统计概览，点击「进行中」进入横向任务分页，点击「所有任务」进入紧凑列表；没有进行中任务时显示对应空状态。列表使用自定义紧凑行与分组标题，移除重复的页面标题和系统 Section 大间距，并支持分页加载更多。结果页直接滚动阅读全文，朗读改为顶部工具栏图标，底部只保留语音继续；开始语音前停止朗读。

新增 `GET /api/v1/watch/overview`，使用现有 `tasks:read` 权限及工作空间隔离。任务数量统计所有未归档会话的最新任务，不受列表分页影响。消息数使用 Footprints 的非空 user／agent 消息口径；累计 Token 复用已有已结束 chat 用量记录，按 attempt 去重、不包含系统报告、缺失时返回 null 并显示「—」。统计缓存按账号隔离，失败时保留缓存并标记未同步。

验证：25 项 Swift 核心测试通过；权限、工作空间隔离、分页校验、Token 去重及 Footprints 一致性数据库测试通过；3 项隔离原生交互检查通过；手机及 Watch 签名构建通过。后端 Docker 已更新，健康检查返回正常。安装包在 `apple/.cache/build16/SteerPhone.app`，包含嵌入的 Watch App。2026-11-09 恢复连接后，两端 Build 16 均已成功安装，实体 Watch 已自动启动成功；iPhone 自动启动被锁屏拒绝。Watch 实际布局与收音仍需用户真机验收。

## Build 15：修复 ATS 配置冲突

移除手机和 Watch 中的 `NSAllowsLocalNetworking`，保留现有 `NSAllowsArbitraryLoads`。iOS 在两者同时存在时会忽略后者，导致用户配置的 HTTP 服务地址被安全连接策略拦截。HTTPS 的证书校验逻辑没有修改。

24 项核心测试与两端签名构建通过，最终两个 App 的 Info.plist 均验证为仅包含 `NSAllowsArbitraryLoads: true`。安装包在 `apple/.cache/build15/SteerPhone.app`。2026-11-09 恢复连接后 Build 15 已成功安装到 iPhone 并启动。实际网络诊断显示已配置的 `http://192.168.31.24` 主机返回 NSURLErrorDomain -1001（超时），没有 -1022 ATS 拦截；Mac 访问该主机的 8080/health 也超时，而本地 127.0.0.1:8080/health 返回 200。仍需恢复该局域网地址的可达性或更新服务器地址。

恢复连接后可安装并使用 `STEER_NETWORK_DIAGNOSTICS=1` 环境变量启动，读取缓存 `SteerNetworkDiagnostic.json` 确认实际 HTTP 状态。诊断仅在开发者明确启用时运行，只记录构建版本、协议/主机、HTTP 状态或错误域/编号，不记录密钥、正文、查询参数或任务标识。

## Build 14：任务详情对齐 Steer 聊天页

手机任务详情参照现有 Steer ChatView：顶部显示标题和项目，用户消息靠右，Agent 回复采用正文 Markdown 排版，复制和朗读使用轻量图标。输入区显示 Agent／模型上下文，支持回到最新消息和停止执行。历史作者、模型及引用按每轮数据解码，缺失的信息不虚构。只有成功完成的任务允许新回复，不确定的提交保留原幂等键，Watch 导航保持独立。

验证：24 项核心测试与原生模拟器交互检查通过，iPhone 和 Watch 签名构建通过。2026-11-09 Build 14 已成功安装到 iPhone，并自动启动成功。截图及验证范围见 `docs/ui-validation/build14/VALIDATION.md`；安装包保存在 `apple/.cache/build14/SteerPhone.app`。

## Build 13：手机导航与 Watch 语音流程修复

手机以任务列表作为首页，进行中与最近结束分组，搜索和设置使用独立入口；分组列表不重复显示「进行中」「已完成」，只保留运行时间和失败、停止、等待等具体状态。点开任务后使用系统返回导航。对话去掉重复的大标题，长提问默认收起，Agent 回复支持 Markdown 标题、列表、引用、代码块与表格。输入框从单行开始增长，空输入发送按钮明确禁用，任务执行中不提供新的回复入口。两端的导航仍独立。

Watch 进行中页面限制标题高度，运行时间仍在 Agent 同一行；结果页将状态与项目放到一行，正文可展开。点击「语音继续」同步打开一个弹层，任务检查、连接、录音、识别、确认均在同一页面完成，消除录音弹层关闭与确认页推入的竞争。录音前使用会抛出错误的最新任务状态检查，网络失败不能用缓存成功状态继续；错误与重试直接显示在语音页面。已尝试发送的草稿保留原 idempotency key，通过同一流程重新确认。

验证：22 项核心测试通过，包括 Markdown 结构、未闭合代码块与旧任务字段兼容性；手机真实 SwiftUI 页面在隔离的 iOS 模拟器中验证任务导航、提问展开/收起、键盘输入与执行中禁用回复。预览使用固定数据与内存存储，没有真实账户，也未提交任务。截图见 `docs/ui-validation/build13/`。Watch 目标签名构建通过；WatchDetail、WatchVoiceFlow 和实际 Dictation 的无配对手机错误路径在 iOS 隔离测试宿主中验证了打开、错误提示、重试和返回（仅替换不可用的 Watch 硬件类型，未模拟成功收音）。本机没有 watchOS 模拟器 runtime，Watch 收音和物理设备页面仍需真机验收。

最终 Build 13 包保存在 `apple/.cache/build13/SteerPhone.app`，包含嵌入的 Watch App。2026-11-09 恢复 USB 连接后，最新 Build 13 已成功安装到 iPhone。自动启动被设备锁屏拒绝，仍需手动解锁并打开 Steer；尚未确认配对手表已更新到 Build 13。后续重新安装可执行：

```sh
xcrun devicectl device install app --device 00008160-000970112E40000A apple/.cache/build13/SteerPhone.app
xcrun devicectl device process launch --device 00008160-000970112E40000A com.kongdefei.steer.phone
```

## Build 11：手机任务首页与 Watch 分页

手机默认进入任务对话，右上角任务数量打开任务列表，设置独立打开；任务正文与结果直接排版，已完成任务可文字续接和按需朗读。Watch 首页左右分页查看进行中任务，最右侧固定为所有任务列表；没有进行中任务时直接显示列表。标题下方的项目 / Agent 与运行时长同行，最近发送给 Agent 的消息位于下方，可点击查看全文。运行时长按当前任务的实际 startedAt 计算，排队阶段不展示运行计时。

仅 status=succeeded 且有 taskId 的任务显示新语音入口。失败、停止、待执行或运行中的任务不允许新录音续接。发送前再次读取服务端任务状态；已有结果未知的发送可以恢复原请求与 Idempotency-Key，不因任务已进入运行状态而丢失确认机会。录音中与确认页不参与横向分页。配置或任务状态变化时保留／取消行为延续原有幂等机制。

Watch 与 iPhone 各自维护页面、当前任务和草稿；Watch 操作不改变手机导航。配对连接仍用于配置同步与后台语音转写。两端独立从服务端更新任务业务状态。调试语音开关移到 Watch 设置页。

Watch feed 新增可选 lastUserMessage 和 startedAt 字段，无数据库迁移。旧服务端兼容：从任务详情获取开始时间，从会话历史获取用户消息；缺少字段时不编造时间，同一轮已读取的信息保留到下一次刷新，新轮清空。Phone/Watch 共用 TaskModel 与 ResultSpeech 源码，但各进程实例独立。

验证（2026-11-08）：19 项 Swift 核心测试通过；iPhone 与 Watch 目标签名构建通过；后端 API/store 单元测试和隔离数据库的 Watch feed 权限、字段、Workspace 隔离集成检查通过。本地 Docker 服务更新后 /health 返回 200。Build 11 已安装到 iPhone，包含嵌入的 Watch App；手机锁屏导致自动启动被拒绝，Watch 未作为可直接运行目标出现在 Xcode，因此尚未确认手表已更新、分页实际手势、动态字体和通知跳转的真机表现。

## Build 10：增强端侧转写

iOS 26+ 在模型就绪、设备与所选语言支持时，默认优先使用 Apple `SpeechAnalyzer` + `SpeechTranscriber`。模型通过 `AssetInventory` 准备，由系统管理；手机设置中的「准备增强本地识别」可以下载尚未安装的模型。准备过程不上传录音。请求时不会等待模型下载，模型尚未就绪或新引擎失败时使用原来的兼容路径。iOS 17–25 保持原识别方式。

手机可选择「增强转写」或「标准听写」，修改后点「验证并同步」。新引擎不保证所有内容都更准：当前中文短句表现较好，中英项目名混说仍存在明显错误，所以保留选择权。两条本地路径均加入 Steer、Relay、Codex、GitHub 等术语提示；不通过强制文本替换猜测用户原话。

增强路径返回来源「iPhone 本地 · 增强」，旧引擎本地返回「iPhone 本地」，若旧兼容路径实际使用 Apple 服务则显示「Apple 云端」。原有云端回退策略保留；本轮没有把全部兼容路径改成严格离线。Watch 上的来源显示需要 Build 9+，旧 Watch 仍可由新手机转写。Mac mini 服务没有改动。

新引擎使用最终转写结果，独立处理每段录音，保留取消、后台执行时间限制与超时保护。单次增强识别限 20 秒；失败后在总计 40 秒预算内回退兼容识别。取消会结束 analyzer，取消期间的结果不会回传成成功。系统模型使用 lingering 策略减少连续短句的加载开销，不永久保留每轮转写上下文。

### iPhone 真机对照（2026-11-08）

用 Tingting 生成六条 16kHz、单声道、32kbps AAC/M4A，覆盖普通中文、否定约束、取消指令、时间金额、中英项目名和较长中文。每条分别走旧本地与新本地引擎，均未调用识别服务器：

| 样本 | 标准听写 | 增强转写 |
|---|---:|---:|
| 当前任务状态 | 345ms | 243ms |
| 不提交、不推送 | 174ms | 143ms |
| 取消与失败原因 | 93ms | 127ms |
| 时间与金额 | 120ms | 141ms |
| 中英项目名 | 242ms | 155ms |
| 较长中文 | 436ms | 264ms |
| 中位数 | 208ms | 149ms |

增强模型保住了第一条旧引擎遗漏的「请总结当前」等开头内容；其余中文仍有「只/之/知」等同音字错误。时间和金额包含系统格式化，不直接按原字串算准确率。中英项目名样本中旧引擎反而更好，两者都未完全正确；Tingting 对英文词的发音也限制了这条样本的代表性。

取消测试返回 cancelled，随后再次识别成功。完整 WatchConnectivity 分块接收→手机选择引擎→返回文字路径也用合成音频验证，实际来源为「iPhone 本地 · 增强」。16 项核心测试、真机签名构建通过，Build 10 已安装到 iPhone。

这是小规模合成录音对照，不是人声准确率、蜂窝/Watch 传输耗时或 p95 基准；未开飞行模式作额外离线验证。报告为 `services/speech/verification/iphone-enhanced-comparison.json` 和 `iphone-enhanced-pipeline.json`。仍需要用户在 Watch 上对日常中文及项目名混说复测。

用户随后保持自托管关闭，在真实 Watch 上复测，反馈带英文也能转写出正确文字。该次实际人声表现优于上述 Tingting 中英混说合成样本；保留标准听写选项，不将这一次成功外推为通用准确率。

## Build 9：固定识别语言与实际来源

修复中文录音被送给英语识别器的问题：Watch 不再将 `Locale.current`（系统地区）当作录音语言。iPhone 设置中显式选择「中文（普通话）」或「English」，默认中文；手机以保存的选择为准，也兼容旧 Watch 传入 en-US 的情况。不再在指定识别器初始化失败后退回默认语言。更改语言仍需点「验证并同步到手表」。

手机回复中包含实际使用的识别来源：iPhone 本地或 Apple 云端。Watch 文字确认页显示来源，自托管与手表本地实验也分别标明；不再根据配置回执猜测某次实际请求。现有 Apple 云端回退逻辑保留。

关闭自托管开关会立即保存并发起同步，不必再点击上方验证；等待手表回执后才确认同步完成。开启自托管或编辑地址/密钥仍需验证并保存。旧配置默认中文，服务端 Docker 与通知接口没有改动。

真机合成中文录音对照：英语本地识别器输出「We was your guy」，中文本地识别器输出「总结当前任务的状态不要修改代码」。修复后的完整手机转写路径即使收到 en-US，也返回 locale=zh-CN、source=iPhone 本地及中文结果；仍漏了开头的「请」，不视作逐字准确率通过。16 项核心测试与签名构建通过。诊断仅使用预置合成录音，不提交任务；真实 Watch 人声效果需要用户复测。

用户随后在保持自托管关闭的情况下，用真实 Watch 重新输入中文，确认「这次可以了」。当时最新配对回执为 phone、Watch Build 8，验证了手机端修复对旧 Watch 的兼容性；来源标签仍需 Watch 更新至 Build 9 后显示。

## Build 8：自托管语音识别与可选朗读

iPhone 设置新增「使用自托管语音服务」，填写独立语音服务地址与密钥后，点击「验证并同步到手表」。Watch 将短录音直接交给服务识别，再显示文字供确认发送；此模式不要求配对 iPhone 可达，不会自动回退 Apple 云端识别。关闭该选项并保存可恢复原有手机识别。配置与密钥随配对配置保存在 Keychain，旧配置仍兼容。

任务结果仍以文字展示，点「朗读结果」才播放系统语音，可随时停止；进入录音、离开页面或后台时停止。Mac 服务部署、接口及验证记录见 [Speech 服务](../services/speech/README.md)。以下 Build 4–7 内容保留为历史说明。

当前识别服务已在 Mac mini 的 Docker 中运行（SenseVoice INT8），由 Caddy 转发。iPhone 已配置 `http://192.168.31.248:18766`，Watch Build 8 已确认接收；用户已在真实手表上确认录音识别文字正确、速度可接受。公网入口由用户配置，已有 TLS 站点预留 `/speech/` 路径。

原生 SwiftUI 客户端，聚焦任务状态通知和语音续聊。iPhone 负责配置、配对同步和录音转写，Watch 直接访问 Steer Server。

## 当前能力

- 首页呈现执行中的任务，以及最近八条完成／失败动态，展示项目、Agent 和任务状态。
- 前台运行中的任务变为完成／失败时，弹出原生提示，可跳转结果；不重复提示同一任务。
- 前台每 15 秒刷新；运行任务通过现有 Task API 校准 Relay 状态，同时最多四个请求。离开前台后不维持后台轮询。
- 任务结果摘要可展开；正文可滚动，语音操作放在底部安全区域，适配不同表盘尺寸与系统字号。
- 点击「语音」直接进入聆听，点「完成」后自动识别并显示文字，只提供「发送／取消」。不弹系统录音控制器，不需要单独操作转写；取消后重新点语音即可开始新的输入。单次最长 20 秒。
- 相同 conversationId 续聊，复用原 Agent 与工作目录；停止任务需要二次确认，不撤销文件改动。
- API Key、会话缓存和草稿存 Keychain；草稿按服务器与 Key 的指纹、会话隔离。
- 请求超时后保留正文与 Idempotency-Key，重试不会重复创建任务。结果待确认时禁止修改该请求正文；服务器明确拒绝时可编辑重发。
- 已去掉手机查看入口和完整历史聊天页。

后台完成提醒通过 APNs 接入，需配置服务端推送密钥并取得系统通知授权。未配置时仅提供前台同步和触感提醒。Complication 和无 iPhone 的独立配置流程尚未实现。

## 工程

工程包含 `SteerPhone`、`SteerWatch` 和 `SteerCoreTests`。首次构建前准备本地识别实验依赖（需完整 Xcode、CMake 和 Ninja）：

```bash
bash apple/scripts/prepare-local-speech.sh
xcodegen generate --spec apple/project.yml
```

脚本固定 whisper.cpp 源码版本和模型 SHA-256，将 Watch 的 arm64／arm64_32、iPhone arm64 静态库合成 XCFramework。模型及构建缓存保存在未纳入 Git 的 `apple/.cache/asr`。如需 Apple Silicon 模拟器构建，传 `--simulators`；模拟器耗时不能作为手表性能数据。随后打开 `apple/SteerApple.xcodeproj`。

`project.yml` 是工程配置来源。修改源文件或工程配置后，可用 XcodeGen 重新生成：

```bash
brew install xcodegen
xcodegen generate --spec apple/project.yml
```

重新生成会覆盖在 Xcode 中临时修改的工程设置；长期使用的 Bundle 前缀和 DEVELOPMENT_TEAM 应保存在 `project.yml`，不要将 API Key 写进工程文件。

## 真机安装

1. iPhone 和 Apple Watch 已正常配对；iPhone iOS 17+、Watch watchOS 10+。Mac 上安装支持设备系统版本的完整 Xcode。
2. Xcode → Settings → Accounts 添加 Apple ID。免费 Personal Team 可以做开发安装，通常每七天需重新签名；付费开发者账号可用于长期测试或 TestFlight。
3. 打开工程，选择项目 → Build Settings，将 `STEER_BUNDLE_PREFIX` 改为你独有的前缀，例如 `com.yourname.steer`。Phone／Watch Bundle ID 和 Companion ID 会同步使用此前缀。
4. 在 `SteerPhone` 和 `SteerWatch` → Signing & Capabilities 勾选 Automatically manage signing，选择同一个 Team。
5. iPhone 连接 Mac 并信任电脑；在 iPhone 和 Watch 的「设置 → 隐私与安全性 → 开发者模式」中启用开发者模式，按系统要求重启。设备未显示时，在 Xcode → Window → Devices and Simulators 完成配对，保持设备解锁。
6. Scheme 选择 `SteerPhone`，运行目标选择真实 iPhone，点击 Run 安装。随后选择 `SteerWatch` Scheme 和配对的 Apple Watch 运行，等待 Xcode 安装完成。
7. 先将最新 Steer 后端部署到测试服务器。此版增加两个会话接口；使用后台通知还需执行 `000034_watch_notifications.sql` 迁移，Relay 无需更新：
   - `GET /api/v1/watch/conversations`
   - `GET /api/v1/watch/conversations/{id}`
8. 在 Steer 网页 Settings → API access 为相应 Workspace 创建 API Key，保留默认三个 task scope。
9. iPhone Steer 中填写：服务器地址（例如 `https://steer.example.com` 或 `http://your-mac.local:8080`）和 API Key。点击「验证并同步到手表」，打开 Watch App 等待配置到达。
10. 先在 iPhone Steer 中允许语音识别，再在 Watch 选择已有会话，点「语音」，允许麦克风权限，说「只总结当前状态，不修改代码」。点「完成」后显示文字，检查后发送，在网页同一会话核对消息。取消会清除这次输入，返回任务页后可重新开始。

局域网测试的服务器必须监听可访问的网卡，且 iPhone／Watch 能访问相同网络。`localhost`、`127.0.0.1` 指向设备自身，不能访问 Mac。设备首次请求时允许本地网络权限；使用 IP 地址时填 Mac／服务器的局域网 IP。

本开发客户端允许 HTTP，以便测试自托管的局域网部署；HTTP 不加密 API Key，跨公网使用 HTTPS。服务器地址应为 Steer API 所在的源站，支持 `/api/v1` 后缀。

## 建议真机检查

- 最小尺寸手表上，列表可以滚动；正文长时，底部发送／续聊按钮完整可点；调整系统文字大小后再检查。
- 点击语音实际打开录音界面，完成后得到文字草稿；取消录音不会启动任务。拒绝麦克风或语音识别权限时，应显示可操作的错误。
- 转写失败时，录音保留在手表，允许重试转写或重新录音；旧的文字草稿不会被失败操作清除。
- 发送确认中的项目、Agent 与目标会话正确，网页只出现一次追问。
- 执行期间切换其他会话；完成后刷新，查看结果。停止按钮应弹出确认。
- 断开网络时显示上次同步时间和错误；保存草稿，关闭／打开 App 后仍能恢复。
- 恢复网络后重试同一请求，网页不应出现重复任务。
- 推送配置完成后，退出 Watch App，等待新任务结束，确认系统通知能打开对应任务并语音接续。

## 验证命令

从仓库根目录执行：

```bash
swift test --package-path apple
xcodebuild -project apple/SteerApple.xcodeproj -scheme SteerPhone \
  -destination 'generic/platform=iOS' \
  -derivedDataPath /tmp/steer-apple-build CODE_SIGNING_ALLOWED=NO build
```

不要在 Phone Scheme 中强制传 `-sdk iphoneos`，该参数也会覆盖 Watch 依赖的 SDK；由目标平台选择各自 SDK。

Swift 测试覆盖 API 地址与鉴权、超时后的幂等重试、取消响应和地址校验，以及音频分块重组、顺序、大小与 SHA-256 完整性校验。后端权限／跨 Workspace 隔离回归需要设置 `STEER_TEST_DATABASE_URL` 后运行 `TestWatchFeedScopesAndWorkspaceIsolation`。

## 通知与真实语音版本（Build 4）

手表首页只呈现执行中的任务与最近八条完成／失败动态，去掉完整聊天页、手机查看和网页地址设置。任务页呈现状态及简短结果；长结果可展开。点击麦克风调用 WatchKit `presentAudioRecorderController` 并自动录音，使用 16 kHz AAC，最多 60 秒，不再调用键盘／文字输入控制器。录音通过 WatchConnectivity 以 32 KB 分块传给配对 iPhone，校验字节数和 SHA-256 后，由 Speech.framework 转成文字；支持时优先本地识别，本地识别服务失败时可回退 Apple 识别服务。录音仅用于转写，不作为附件上传 Steer Server。

配对 iPhone 必须可达，并已在 Steer 中允许语音识别；若连接失败，请打开手机 Steer 后重试。Apple 识别服务需要网络，受系统语言及服务可用性影响。转写有超时和取消处理，临时手机音频用后删除。转写失败时保留手表录音用于重试；识别文字保存为当前账号／会话草稿后才删除该录音。用户确认发送前不会创建任务。

## 聆听与本地识别实验（Build 5）

Build 5 用 App 内的聆听界面取代 Build 4 的系统录音界面。显示动态音量和「正在听」，根据连续说话及停顿自动结束，连续说话最长 20 秒；8 秒没有检测到说话时退出并提示重试。当前端点检测依赖麦克风音量，嘈杂环境可能需要点击「说完了」。离开前台或取消时停止聆听／识别，不创建任务。

Debug 版本首页底部有「语音验证 → 本地识别测试」开关，以及 Base／Tiny 模型选择。开启后在 Watch CPU 上用多语言 Whisper 识别，用户音频不传手机，手机不可达也可进入聆听；关闭时继续使用已验证的手机识别。Release 尚未启用本地识别，需先确认真实手表上的中文准确率、内存、响应时间和耗电。音频识别独立于 Steer Server，确认发送任务仍需要服务器网络。

本地实验逐句加载并释放模型，不复用前一句的识别上下文，识别超时为 25 秒。失败保留录音和已有文字草稿。降低音频计算窗口在短句测试中出现重复文字，当前未启用。Swift 回归测试覆盖无声、短促噪声、句中停顿和最长聆听时间。

开发诊断使用缓存中的合成音频，不访问麦克风或提交 Agent 任务。Debug iPhone 进程设置 `STEER_LOCAL_SPEECH_SELF_TEST=1` 后，会输出本机识别结果，并将测试音频通过配对连接交给新版 Watch；Watch 输出再传回手机缓存 `SteerWatchSpeechDiagnostic.json`。记录明确标注 iOS／watchOS 平台，以及加载、识别耗时和进程生命周期峰值内存；手机或桌面结果不能当作手表实测。

## 简化语音流程（Build 7）

当前流程为「语音 → 聆听 → 完成 → 文字确认 → 发送／取消」。点完成后在同一界面短暂等待，平台自动识别，不显示录音／转写操作或额外转写页面。停顿不会提前结束聆听，20 秒仍是安全上限。取消聆听会中止识别并删除这段音频；取消文字确认会删除本次草稿，返回任务页，重新点语音从新录音开始。确认页不再提供重新录音、重新识别、稍后再发按钮。

已尝试发送但结果未知的请求仍保留幂等标识，任务页的「确认发送」可恢复重试，避免把未知结果误当成尚未发送。确认页中的取消只放弃本地输入，不撤销已发送到服务端的任务。

前台任务完成会提醒并触发触感反馈。退出 App 后的提醒走 APNs，需要额外配置；未配置的服务端不会被显示为“后台通知已开启”。后台同步复用 Steer 的 usage sync worker，从 Relay 读取终态；新安装不会推送注册前已经完成的历史任务。

### 开启后台通知

1. 在 Apple Developer 的 Keys 中创建具有 Apple Push Notifications service 权限的密钥，保存 `.p8`、Key ID 和 Team ID。账号持有人／管理员需要完成此步骤。
2. 在 Steer Server 所在机器保存 `.p8` 文件，保持文件权限仅部署用户可读；不要把密钥提交到 Git。
3. 设置下面四个环境变量（开发版本 Watch token 使用 sandbox，Release 使用 production）：

```bash
export STEER_APNS_KEY_PATH=/absolute/path/AuthKey_XXXXXXXXXX.p8
export STEER_APNS_KEY_ID=XXXXXXXXXX
export STEER_APNS_TEAM_ID=4U87V5XYY4
export STEER_APNS_TOPIC=com.kongdefei.steer.phone.watchkitapp

docker compose -f docker-compose.yml -f docker-compose.watch.yml up -d --build steer-server
```

原生工程已增加 APNs entitlement。自动签名需生成支持 Push Notifications 的明确 App ID 和开发描述文件，旧的 wildcard 描述文件无法用于新版 Watch App。重新安装后打开 Watch，允许系统通知授权；服务端配置和 App bundle identifier 一致时显示“任务完成通知已开启”。

如果直接启动后端，设置 `STEER_APNS_KEY_FILE` 为后端进程可读取的文件路径，另三项同上。

系统通知包含任务标题与完成／失败状态，不携带完整 Agent 正文。点击通知读取对应任务；通知操作“语音续聊”可直接接续。送达依赖 APNs 和设备网络；重试采用持久化队列、租约与 collapse ID，无法保证网络超时场景下严格只提醒一次。API Key 撤销后停止新发送；切换 Workspace 的已排队任务不会交给新的 Workspace。

服务端新增迁移 `000034_watch_notifications.sql`，需在使用后台通知前更新后端；前端 Web、Relay Server 和 Node 无需更新。
