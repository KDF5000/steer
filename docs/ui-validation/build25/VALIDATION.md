# Build 25：项目目录、手机设置与消息操作

手机任务首页保留进行中任务入口，历史会话按项目浏览；Watch 的所有任务进入项目目录后，再查看项目内会话。目录覆盖服务端全部未归档会话，按项目 ID 筛选并分页读取，项目内不重复展示项目名。手机搜索使用服务端检索标题、项目与 Agent 名；不同设备的导航继续独立。

手机设置分为三个入口：Steer 连接、Apple Watch、语音输入。配置与状态分开显示，语音配置保存只修改已有连接的语音选项；关闭自托管仍立即保存。详细 API Key 获取说明收进展开项。复制与朗读按钮移除 16pt 中间间隔，区域宽 40pt、高 44pt。

验证（2026-11-10）：

- Swift 核心测试 31 项通过，包含读取重试、取消、提交幂等，以及项目目录、项目分页与搜索参数编码。
- 后端 API／store 测试通过。隔离临时数据库的 Watch feed 集成检查通过，覆盖 53 个新增项目会话、超过 50 个会话后的分页、未绑定项目、无匹配项目、搜索分页、API Key 鉴权和工作空间隔离；测试库已删除。
- 最终 iPhone／Watch 签名构建通过，日志 `/tmp/steer-build25-build.log`，安装包 `apple/.cache/build25/SteerPhone.app`。
- 两项隔离 iOS 原生 UI 检查通过：项目 → 会话 → 对话导航与返回、项目内容隔离、复制反馈、复制／朗读图标中心间距不超过 41pt、设置首页不暴露密钥编辑框、连接编辑页与语音设置独立、语音保存反馈，以及 Watch 项目层级。结果 `/tmp/steer-build25-ui-verified.xcresult`，日志 `/tmp/steer-build25-ui-verified.log`。
- 原生截图为本目录的 `01-projects.png` 至 `06-speech-settings.png`。测试使用固定数据与内存配置，没有真实账户或任务提交。Watch 页面在隔离 iOS 宿主中检查导航，不能替代实体 Watch 的屏幕布局验收。
- 本地 Steer Server 已用两个 Compose 文件重新构建部署，健康检查通过，APNs 只读密钥挂载保留。

安装：iPhone Build 25 已安装并启动，记录 `/tmp/steer-build25-phone-install.json`、`/tmp/steer-build25-phone-launch.json`。Watch 两次安装均未成功，首次连接中断（NWError 49），重试建立隧道超时（RemotePairing 1001）；记录 `/tmp/steer-build25-watch-install.json`、`/tmp/steer-build25-watch-install-retry.json`。手机包已包含新版 Watch App，但尚未确认实体 Watch 已更新。
