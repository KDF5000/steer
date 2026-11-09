# Build 22：话筒按钮底部居中

仅调整结果页小圆形话筒的位置：overlay 对齐从 bottomTrailing 改为 bottom，移除右侧偏移。保留 36pt 可见圆形、44pt 点击区域、底部 4pt 间距以及正文末尾 48pt 留白。待确认请求的上箭头入口也使用同一居中位置。语音资格、录音、重试和关闭逻辑未改动。

iPhone / Watch 签名构建通过，日志 `/tmp/steer-build22-build.log`。安装包 `apple/.cache/build22/SteerPhone.app`。本轮为低影响位置修改，不新增或重复实现测试；已有语音入口与长结果回归见 Build 21。

iPhone Build 22 安装成功，记录 `/tmp/steer-build22-phone-install.json`。Watch Build 22 已安装并启动成功，记录 `/tmp/steer-build22-watch-install.json`、`/tmp/steer-build22-watch-launch.json`。两端均已更新。真实表型居中位置仍需用户检查。
