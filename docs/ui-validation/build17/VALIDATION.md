# Build 17 验证记录

## 变更

用户已确认 `docs/prototypes/watch-native-flow-2026-11-09` 最新原型。首页设置放右上角，使用灰色系统圆形工具栏样式，移除应用标题、保留系统时间。任务与累计统计均两列排列；通过 ViewThatFits 优先正常一屏布局，再用紧凑一屏布局，文字较大或高度不足时无滚动条回退。ScrollView 与设置列表隐藏滚动条。

进行中分类移除最后的所有任务页和空状态入口，分页只包含运行任务，单任务无分页指示。所有任务从首页单独进入，移除刷新工具栏按钮，详情返回原列表。进行中和运行详情显示最新指令、Agent 与运行时间同行；已完成分组不重复完成标签。保留停止操作、通知跳转、结果朗读、语音续聊及不确定提交的幂等重试逻辑。

本轮不改识别服务、语音配置同步或通知注册。设置页沿用现有真实配置及诊断功能，没有照搬原型中的模拟开关。未修改手机聊天页面与后端。

## 构建与验证

- `swift test --package-path apple`：25 项核心测试通过，日志 `/tmp/steer-build17-core.log`。
- `xcodebuild -project apple/SteerApple.xcodeproj -scheme SteerPhone -destination 'generic/platform=iOS' -derivedDataPath /tmp/steer-build17 DEVELOPMENT_TEAM=4U87V5XYY4 STEER_BUNDLE_PREFIX=com.kongdefei.steer -allowProvisioningUpdates build`：签名构建通过，日志 `/tmp/steer-build17-build.log`。
- 手机及嵌入 Watch 的最终 Info.plist 均为 Build 17，Bundle ID 正确；ATS 仍仅有 NSAllowsArbitraryLoads，避免重新引入 Build 15 修复的配置冲突。
- 隔离 iOS 模拟器宿主直接编译当前 Watch 视图源，硬件不可用类型用桩代替。Release 配置下三项交互测试通过：
  - 首页设置 → 返回；零进行中 → 空状态，无所有任务或设置入口；返回首页进入所有任务，无设置或刷新工具栏；结果页朗读与底部语音可点击。
  - 语音立即打开、配对手机不可达时显示错误和重试，返回任务可再录音。
  - 两条运行任务横向切换，末尾继续滑动仍停在第二条，无所有任务页；返回首页才可进入所有任务；运行详情不显示语音继续，返回原列表。
- UI 结果：`/tmp/steer-build17-ui-release.xcresult`、`/tmp/steer-build17-pager.xcresult`；日志对应 `/tmp/steer-build17-ui-release.log`、`/tmp/steer-build17-pager.log`。
- 最初 Debug 宿主构建失败，因为其已有 LocalSpeech 桩缺少诊断方法；切换宿主原用 Release 配置后通过。正式 Debug 真机构建使用真实实现，一次通过。

## 安装

- 最终安装包：`apple/.cache/build17/SteerPhone.app`，含 `Watch/SteerWatch.app`。
- 实体 Watch `00008310-000B54311AA0E01E`：安装成功，启动成功。安装／启动记录 `/tmp/steer-build17-watch-install.json`、`/tmp/steer-build17-watch-launch.json`。
- iPhone `00008160-000970112E40000A`：设备状态 unavailable，安装请求返回 CoreDeviceError 4016，尚未安装 Build 17；包已准备好供重新连接后安装。

本机只有 iOS 26.5 模拟器运行时。iOS 宿主用于导航／交互回归，不作为 watchOS 小表型字体、安全区、工具栏外观或收音证明。实际 Watch 已启动，但用户仍需检查首页和实际语音体验；不宣称真机人声转写已复测。
