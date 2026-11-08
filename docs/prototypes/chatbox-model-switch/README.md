# Chatbox 模型切换原型

复用 Steer 当前聊天界面的生产样式快照，在 Agent 与项目之间增加模型选择器。

- 默认跟随 Agent 设置中的模型；模型菜单可覆盖当前会话，并可恢复跟随默认。
- 手动指定的模型在切换 Agent 时保留；跟随默认时，切换 Agent 会更新模型。
- 切换模型后展示下一轮使用的模型；模拟发送后，回复标示 Agent 和实际模型。
- 菜单支持搜索、方向键、Escape 关闭与点击外部关闭。
- 模型和回复均为演示数据，未接入后端或实际 runtime。

从项目根目录运行 `python3 -m http.server 3107 --bind 127.0.0.1`，打开：

http://127.0.0.1:3107/docs/prototypes/chatbox-model-switch/

`previews/` 包含桌面、菜单、切换后和手机端截图。`capture.mjs` 可通过已安装的 Playwright 重新生成，并检查关键交互。需要外部安装时传入 `STEER_PLAYWRIGHT_MODULE`，需要指定浏览器时传入 `STEER_CHROME_PATH`。
