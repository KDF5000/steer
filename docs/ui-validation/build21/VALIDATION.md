# Build 21：小话筒入口与语音失败页

## 实现

结果页移除全宽的“语音继续”胶囊按钮与固定黑色矩形底栏，改为右下角 36×36 圆形话筒图标、44×44 点击区域。按钮使用 overlay，不再永久缩减整块正文视口；正文末尾增加 48pt 留白，滚到末尾后可完整读到最后几行。图标保留“语音继续”无障碍名称，未确认发送的请求使用上箭头图标与“确认发送”无障碍名称；资格校验、幂等重试及开始录音前停止朗读保持不变。

语音失败页移除底部“返回任务”，保留错误信息、重试及左上角关闭。关闭通过现有 sheet dismiss 返回原任务，语音取消清理仍由原生命周期处理；失败页隐藏滚动条与重复导航标题。

## 验证

- iPhone + Watch 签名构建通过，`/tmp/steer-build21-build.log`。
- 两端最终 CFBundleVersion 均为 21，包位于 `apple/.cache/build21/SteerPhone.app`。
- 隔离 iOS 宿主直接编译当前 Watch 视图源码，两个现有交互检查实际执行并通过（0 failures）：
  - 结果页只有一个语音入口，按钮宽度小于宿主屏幕一半，无“语音继续”正文文字，滚动结果后按钮仍可点击。
  - 图标入口打开语音，配对手机不可达时显示错误；重试可用，无“返回任务”按钮；左上角关闭后返回原结果。
- 日志 `/tmp/steer-build21-voice.log`，结果 `/tmp/steer-build21-voice.xcresult`。
- iOS 宿主不是 watchOS 安全区、外观或音频验证。右下角图标对真实最小表型正文的影响仍需用户验收。

## 安装

iPhone Build 21 已安装，记录 `/tmp/steer-build21-phone-install.json`。Watch Build 21 安装成功并启动成功，记录 `/tmp/steer-build21-watch-install.json`、`/tmp/steer-build21-watch-launch.json`。两端均已安装；真实 Watch 的图标外观、正文末尾留白与实际收音仍需用户试用确认。
