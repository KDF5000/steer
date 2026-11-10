# Build 26：旧服务端权限白名单兼容

用户反馈设置验证 API Key 成功，但首页显示无权限。真机 Build 25 网络诊断确认实际目标为 `https://steer.byted.org`、HTTP 403；开发机 Docker 在上一轮已更新，但没有来自该手机的 Watch API 请求。两者是不同服务实例，不能把开发机部署验证当作手机实际服务验证。

修复：项目目录 403／404 时，经已授权会话读取接口分页获取完整会话，按项目 ID（旧字段缺失时按项目名）构建目录。在兼容模式下，项目内分页与搜索仅使用对应项目／匹配会话，避免旧服务端忽略新查询参数后返回跨项目内容。真正的鉴权失败和服务端故障继续提示；不新增 Key 权限。旧分页不支持 offset 时终止，避免循环请求。配置验证覆盖首页目录流程。

验证（2026-11-10）：

- Swift 34 项测试通过，新增覆盖目录 403／404 回退、第二页才出现的项目、目录统计、401 不回退、503 有限重试、旧服务端忽略 offset 后停止请求。
- iPhone／Watch 最终签名构建通过，日志 `/tmp/steer-build26-build.log`。包 `apple/.cache/build26/SteerPhone.app`。
- 两项隔离 iOS 原生 UI 检查通过：模拟项目目录 403，且会话接口忽略 projectId，确认项目 → 会话 → 对话导航与项目内容隔离、消息操作、设置与语音保存正常；Watch 项目层级也通过。结果 `/tmp/steer-build26-legacy-ui.xcresult`，日志 `/tmp/steer-build26-legacy-ui.log`。固定数据和内存配置，不使用真实账号或提交任务。
- iPhone Build 26 已安装并启动，记录 `/tmp/steer-build26-phone-install.json`、`/tmp/steer-build26-phone-launch.json`。
- 真机读取实际 `steer.byted.org` 返回 HTTP 200，网络诊断 `/tmp/steer-build26-network.json`，Build 26，2026-11-10 09:10:43 +08:00。此诊断仅记录最后一次请求状态，不包含凭证、任务正文或项目数据；尚未由用户确认首页视觉表现。
- 没有改动远端 `steer.byted.org` 的部署或权限；访问其 SSH 及 Mac mini SSH 均超时。本轮通过客户端兼容恢复读取。

Watch Build 26 已安装并启动，记录 `/tmp/steer-build26-watch-install.json`、`/tmp/steer-build26-watch-launch.json`。手机已重新以普通模式启动，退出本轮网络诊断模式，记录 `/tmp/steer-build26-phone-normal-launch.json`。
