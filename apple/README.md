# Steer Apple Watch

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
