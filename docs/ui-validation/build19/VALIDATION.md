# Build 19：紧凑 Watch 设置页面

“后台通知待配置”来自服务端通知能力检测（WatchNotifications.configureCurrent 中 service.enabled 为 false），是状态文字，不是配置项。本轮将其改为明确的只读两行信息：标题“后台通知”，值“服务端未启用”；已开启、授权或注册错误继续显示对应真实状态。不启用或修改服务端 APNs。

设置页由 List / Section 改为无滚动条的 ScrollView + 紧凑 VStack，以细分隔线区分信息；移除配对配置回执的临时文字，避免看起来像空白配置行。增加“语音转写”只读信息，按实际优先级显示自托管服务、可用的手表本地测试或 iPhone 转写；未连接时显示未配置。这不是对某条录音实际识别来源的诊断。

Debug 的“语音验证”改为带右箭头的独立页面；测试开关和 Base / Tiny 模型选择仍使用原 AppStorage 键，无配置重置。设置首页不再直接放实验开关。只读状态行无箭头、背景卡片或点击行为；语音验证为真正的导航入口。

验证：

- iPhone / Watch Debug 签名构建通过，日志 `/tmp/steer-build19-build.log`。
- 两端最终安装包 CFBundleVersion 均为 19，包保存在 `apple/.cache/build19/SteerPhone.app`。
- 隔离 iOS Release 交互宿主的现有首页 → 设置 → 返回 → 零任务 → 所有任务 → 结果／语音入口回归通过，结果 `/tmp/steer-build19-settings.xcresult`。此宿主不包含 Debug 语音验证，也不是 watchOS 布局或麦克风验证。
- 首次 Watch 安装连接断开，CoreDeviceError 4000，记录 `/tmp/steer-build19-watch-install.json`；有界重试也未成功，设备 tunnel 返回 NWError 49（Can't assign requested address），记录 `/tmp/steer-build19-watch-install-retry.json`。Build 19 尚未安装，实体 Watch 仍为此前版本；需要恢复 iPhone / Watch 与 Mac 的设备连接后再安装。

实际表型上的设置页面间距、语音验证开关与模型选择仍需用户真机验收。

## 恢复连接后的安装

iPhone Build 19 安装并启动成功，记录 `/tmp/steer-build19-phone-install-connected.json`、`/tmp/steer-build19-phone-launch-connected.json`。Watch 两次 60 秒安装请求超时；随后应用信息查询成功，确认手表仍为 Build 18（`/tmp/steer-build19-watch-apps-connected.json`）。延长有界等待后 Watch Build 19 安装成功，记录 `/tmp/steer-build19-watch-install-connected-final.json`；启动成功，记录 `/tmp/steer-build19-watch-launch-connected.json`。再次读取设备应用信息，确认 bundleVersion 为 19，记录 `/tmp/steer-build19-watch-apps-verified.json`。两端现在均已安装并启动 Build 19；设置页面的真机视觉仍待用户验收。
