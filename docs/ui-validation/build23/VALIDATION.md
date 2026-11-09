# Build 23：话筒贴近屏幕底边

用户真机照片显示 Build 22 的话筒仍悬在正文中间。此前按钮附着于 ScrollView 的底部，其可见底部与 watchOS 安全区处理不等于物理屏幕底边。

本轮改为独立 ZStack 底部对齐：仅有语音／待确认入口时延伸容器到底部安全区；顶部系统导航保持不变。可见圆形仍为 36pt，点击区域 44pt，外层距底边 8pt（圆形自身再内缩 4pt）。正文末尾留白 60pt，滚到末尾后可完整阅读。无按钮时沿用原底部安全区，不改变运行任务或失败任务的阅读范围。未采用负 padding 或整体偏移补丁。

验证：

- 最终 iPhone / Watch 签名构建通过，日志 `/tmp/steer-build23-build.log`，包 `apple/.cache/build23/SteerPhone.app`。
- 隔离 iOS 交互宿主的既有结果阅读检查实际执行通过，新增几何断言确认话筒水平居中（偏差 < 2pt）、点击区域下沿距宿主屏幕底部 < 24pt，滚动后仍可点。
- 结果 `/tmp/steer-build23-layout.xcresult`，日志 `/tmp/steer-build23-layout.log`。这个宿主不等于 watchOS 安全区或实体表型证明，真机最终间距需用户确认。

安装：iPhone 首次连接重置（NWError 54），记录 `/tmp/steer-build23-phone-install.json`。Watch Build 23 安装并启动成功，记录 `/tmp/steer-build23-watch-install.json`、`/tmp/steer-build23-watch-launch.json`。iPhone 重试安装成功，记录 `/tmp/steer-build23-phone-install-retry.json`。两端均已更新；真实表型的底边间距仍待用户验收。
