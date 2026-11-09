# Build 20：语音确认页聚焦文字

## 设计与实现

普通确认页只保留左上角关闭、可滚动的识别文字和底部固定发送按钮。移除“iPhone 本地 · 增强”等识别引擎标签、右上“确认发送”导航标题，以及重复的项目 / Agent / 会话标题。录音界面也不再重复显示会话标题；正在聆听、识别进度与错误状态继续保留。

用户刚从具体任务进入语音流程，普通确认时无需重复上下文。恢复未确认发送的重试草稿时，保留一行简短会话标题，供核对目标。绑定的 Conversation 与发送前状态校验未变；不把可见标题作为目标选择依据。

关闭未发送的普通草稿会清除；关闭已尝试发送、结果未确认的页面则保留正文及 Idempotency-Key。发送过程中关闭禁用。成功后仍显示已提交、等待执行及返回任务。

识别来源字段仍留在识别实现中，未改变实际语音服务或手机增强转写逻辑；本轮只移除产品确认界面的诊断标签。

## 验证

- iPhone + Watch 签名构建通过，`/tmp/steer-build20-build.log`。
- 隔离 iOS 交互宿主直接编译当前 Watch 视图源码，构造仅存于内存存储的测试草稿，不调用录音或发送真实任务。
- 两项 UI 检查实际执行并通过：
  - 普通确认页无会话、Agent 与确认发送标题；长识别文字滚动前后发送按钮都可点；关闭后草稿清除。
  - 未确认发送页保留一行会话标题；关闭后重新读取存储，正文与原 Idempotency-Key 都保留。
- 结果 `/tmp/steer-build20-compose-verified.xcresult`，日志 `/tmp/steer-build20-compose-verified.log`（Executed 2 tests，0 failures）。
- 初次宿主检查使用读取存储的非响应式底层文字，关闭后的显示未刷新；改为在 sheet onDismiss 读取实际存储并比较原请求标识。一次复用构建缓存的执行为 0 tests，不计入验证；新 derivedDataPath 实际执行两项检查通过。
- 本机没有 watchOS 模拟器，iOS 宿主不是 Watch 安全区、工具栏外观或人声识别验证。

## 安装

包：`apple/.cache/build20/SteerPhone.app`（含 Watch App）。iPhone 已安装成功，记录 `/tmp/steer-build20-phone-install.json`。Watch 安装成功并启动成功，记录 `/tmp/steer-build20-watch-install.json`、`/tmp/steer-build20-watch-launch.json`。两端均已安装 Build 20。手机自动启动因锁屏被拒绝（`/tmp/steer-build20-phone-launch.json`），不影响安装结果。实际 Watch 录音与确认页视觉仍待用户验收。
