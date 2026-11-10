# Build 24：数据读取有限重试

网络临时故障与 HTTP 408／429／5xx 的 GET 请求最多尝试三次，间隔 1 秒、2 秒。现有数据在重试期间保留，API 仅在重试耗尽后向页面返回错误。401／403／404、格式错误等不重试，POST 提交／停止任务也不自动重发。

轮询取消、URLSession 取消和退到后台时的重试等待取消均不会写入列表、统计、详情或历史的同步错误。后台取消会终止后续重试。

验证（2026-11-10）：

- `swift test --package-path apple`：30 项测试通过。新增覆盖断连后 503 再恢复、三次超时后返回错误、永久错误不重试、请求取消不重试、等待重试期间取消后停止请求。既有提交响应丢失与幂等标识测试通过，确认 POST 仍需显式重试。
- iPhone／Watch 签名构建通过，日志 `/tmp/steer-build24-build.log`。两个 App 的 CFBundleVersion 均为 24。包为 `apple/.cache/build24/SteerPhone.app`。
- 自动化测试使用 URLProtocol 模拟网络故障；真实 Watch 弱网与切后台行为尚未真机验收。

安装：iPhone 当前 unavailable；Watch 虽显示 available (paired)，安装时未能建立设备连接隧道（CoreDevice 4000／RemotePairing 1001），记录 `/tmp/steer-build24-watch-install.json`。此次两端尚未更新，Build 24 安装包已保存。
