# Build 27：iPhone／Watch 应用图标

用户确认“转向 S”设计后，将同一图稿接入两端 AppIcon。保留 PNG 母版，导出 1024×1024、不含透明通道的应用图标，不在源图中预裁系统圆角。

新增 Phone／Watch 的 Assets.xcassets，使用平台 universal AppIcon 描述；AppIcon 编译名称只配置在两个应用目标。`apple/scripts/export-app-icons.sh` 可从母版重建两端 PNG，`apple/project.yml` 与生成的 Xcode 工程同步更新。

验证（2026-11-10）：

- 两端签名构建通过，日志 `/tmp/steer-build27-build.log`，包 `apple/.cache/build27/SteerPhone.app`，版本 27。
- 两个 AppIcon PNG 实际均为 1024×1024，没有透明通道。
- 产物两端均有图标 Info.plist 元数据与 Assets.car；assetutil 确认 iPhone 4 个、Watch 2 个 AppIcon 命名资源项。
- 已查看编译后的 iPhone 120px 图标，图稿轮廓在小尺寸下可识别。`compiled-icon-preview.png` 是对 Apple 优化 PNG 的标准格式转换预览，未改变图稿。
- 本轮为图标资产接入，没有修改业务逻辑，验证采用资源检查和实际两端构建。

安装：iPhone 当前 unavailable；Watch 虽显示 available (paired)，安装时设备隧道连接超时（NWError 60）。记录 `/tmp/steer-build27-devices.json`、`/tmp/steer-build27-watch-install.json`。两端尚未确认安装 Build 27，安装包已保存。

恢复连接后（2026-11-10）：iPhone 与 Watch 的 Build 27 均已安装成功，记录 `/tmp/steer-build27-phone-install-connected.json`、`/tmp/steer-build27-watch-install-connected.json`。iPhone 已自动启动，记录 `/tmp/steer-build27-phone-launch-connected.json`。Watch 自动启动两次遇到设备连接中断（NWError 49／RemotePairing 5），记录 `/tmp/steer-build27-watch-launch-connected.json`、`/tmp/steer-build27-watch-launch-retry.json`；安装已完成，可在手表上手动打开。
