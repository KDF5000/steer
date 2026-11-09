# Build 18：设置按钮形状修复

用户真机照片显示，Build 17 的 `.buttonStyle(.bordered)` 在 watchOS 工具栏中产生了竖向胶囊，与已确认原型的圆形按钮不一致。

本轮仅修正首页设置按钮：改为 plain 样式，显式 36×36 圆形背景（#181818）、1pt 圆形描边（#313131）、灰色 16pt SF Symbols 调节图标；外层 44×44 点击区域，保留设置 NavigationLink 和可访问标签。没有调整统计、分类导航或语音逻辑。

验证：iPhone + Watch 签名构建通过，日志 `/tmp/steer-build18-build.log`；两端最终 CFBundleVersion 均为 18。安装包保存于 `apple/.cache/build18/SteerPhone.app`。

首次 Watch 安装请求未成功：CoreDeviceError 4000，RemotePairingError 1001，建立设备网络通道超时，记录 `/tmp/steer-build18-watch-install.json`。设备列表仍显示 paired / available；有界重试后，Build 18 已成功安装到实体 Watch。成功记录 `/tmp/steer-build18-watch-install-retry.json`；实体 Watch 启动成功，记录 `/tmp/steer-build18-watch-launch.json`。

本轮是低影响外观修复，没有新增镜像实现的测试；不把成功构建当成真机外观验证。现有导航及语音回归结果见 Build 17。
