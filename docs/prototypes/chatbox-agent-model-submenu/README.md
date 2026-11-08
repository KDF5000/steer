# 智能体与模型二级菜单原型

外部入口统一显示 `智能体名称 · 模型名称`，模型使用次要文字颜色。

箭头对齐站内 `SelectTrigger` 与 `DropdownMenuSubTrigger`：外层使用 16px 向下 Chevron，展开后旋转；二级入口使用 16px 向右 Chevron，整行灰色高亮，箭头区域保持透明。弹层使用站内 12px 圆角、边框与阴影。

- 点击入口展开智能体列表；桌面端悬停智能体行或点击右侧箭头展开模型子菜单。
- 展开子菜单只预览，不改变当前 Agent 或模型。
- 点击智能体名称直接选择它；切换到不同智能体时使用该智能体的默认模型。
- 在二级菜单选择模型，同时确定目标智能体与会话模型覆盖；“跟随智能体默认”清除覆盖。
- 手机端用同一菜单位置逐级展示，模型页提供“返回智能体”。
- 模型列表与发送回复均为演示数据，未接后端。上一版独立模型入口保留在 `../chatbox-model-switch/`。

从项目根目录运行 `python3 -m http.server 3107 --bind 127.0.0.1`，打开：

http://127.0.0.1:3107/docs/prototypes/chatbox-agent-model-submenu/

也可直接在浏览器打开 `index.html`。`previews/` 包含桌面与手机截图。

`capture.mjs` 检查悬停预览、Agent/model 选择、恢复默认、搜索、键盘操作、手机返回以及模拟发送。可通过 `STEER_PLAYWRIGHT_MODULE` 指定本地 Playwright，通过 `STEER_CHROME_PATH` 指定浏览器。
