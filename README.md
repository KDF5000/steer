# Steer

Steer 是一个围绕人的注意力、判断和成果设计的 Agent 协作工作台，也是 Relay 的独立产品验证项目。

它不以 Agent、Todo 或 Run 作为主要信息架构，而是把 Agent 的后台执行压缩为少量可判断的事项，并将输出沉淀为有版本、有状态、有依据的成果。

当前仓库包含第一版交互原型和中文产品设计：

- [产品设计](docs/product-design.md)
- Attention、Workstreams、Artifacts、Activity 四个交互页面
- 决策选择、采用方案、要求调整和证据预览
- 桌面、平板和移动端响应式布局

## 本地运行

```bash
npm install
npm run dev
```

打开 <http://localhost:3000/>。

## 构建

```bash
npm run build
```

这一阶段仅验证产品模型与交互，不连接真实 Relay Server，也不承诺数据持久化。
