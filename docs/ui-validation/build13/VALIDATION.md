# Build 13 原生界面验证

这些 PNG 是原生 iOS SwiftUI 模拟器截图，使用固定任务数据，非设计稿，也非真实账号数据。后续列表微调已去掉分类下重复的「进行中」「已完成」标签，截图保留微调前的验证记录；详情页仍有状态。

- phone-tasks.png：进行中/最近结束列表，任务名、项目/Agent 与状态分层。
- phone-conversation.png：长提问默认四行，Markdown 回复显示强调、标题和列表。
- phone-keyboard.png：输入框随键盘抬起，发送按钮可用，代码块可横向滚动及复制。
- phone-running.png：执行中没有新回复入口。

22 项 Swift 核心测试通过，新增三个 Markdown 解析测试覆盖标题/列表/引用、代码围栏（含未完成块）与表格/Windows 换行。

隔离 iOS UI 测试通过任务列表 → 对话 → 展开/收起 → 输入 → 返回 → 执行中任务路径。未按发送按钮，未产生真实任务。

另一个测试宿主直接编译 WatchDetail、WatchVoiceFlow、VoiceListening 和 Dictation 源码（移除 WatchKit import/haptic，使用不可用的 LocalSpeech 类型桩），验证点击语音显示错误页、无配对 iPhone 的准确错误、重试及返回。此测试用于页面状态转换，不验证 watchOS 排版、WatchConnectivity 成功传输或物理麦克风。

最终 iPhone 与嵌入的 Watch App 签名构建均成功。首次安装因物理 iPhone unavailable、CoreDevice 4016 失败。2026-11-09 恢复 USB 连接后，最新 Build 13 已成功安装到 iPhone；自动启动被锁屏拒绝。尚未确认手表更新或 Watch 真机录音，未宣称其真机修复已验证。
