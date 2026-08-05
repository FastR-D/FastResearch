# FastResearch

FastResearch 是一个面向科研阅读与知识工作的工具入口控制台。当前提供 Read、Write、FastTask 和 FastNews 四个独立入口，具体功能由对应项目接入。

## 技术栈

- React 19
- TypeScript
- Vite
- Tailwind CSS
- lucide-react

## 快速开始

需要 Node.js 18 或更高版本。

```bash
npm install
npm run dev
```

启动后访问：`http://127.0.0.1:5173`

## 配置工具地址

复制 `.env.example` 为 `.env.local`，填写对应工具的入口地址：

```env
VITE_READ_URL=https://example.com/read
VITE_WRITE_URL=https://example.com/write
VITE_FASTTASK_URL=https://example.com/fast-task
VITE_FASTNEWS_URL=https://example.com/fast-news
```

未配置地址时，对应入口点击后不会跳转。FastTask 和 FastNews 卡片会显示“待配置”。

## Token 机制

Read、Write、FastTask 和 FastNews 分别使用自己的 Token，凭证不会在入口之间共用。

1. 点击右上角凭证按钮，分别连接四个入口的 Token；也可以直接点击入口后连接对应 Token。
2. Token 默认保存在当前浏览器会话中。
3. 勾选“在此浏览器中保持连接”后，对应 Token 会保存到浏览器本地存储。
4. 点击入口时，该入口自己的 Token 会作为 `token` 查询参数附加到目标地址。

例如：

```text
https://example.com/fast-task?token=your-token
```

## 可用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 执行 TypeScript 检查并构建生产版本
npm run lint         # 执行 ESLint 检查
npm run preview      # 预览生产构建
npm run test:visual  # 使用 Edge 验证桌面端、移动端和 Token 交互
```

`npm run test:visual` 默认使用 Windows Edge。也可以通过 `EDGE_PATH` 指定浏览器路径，并通过 `VISUAL_CHECK_URL` 指定待检查的服务地址。

## 目录说明

```text
src/
  App.tsx       # 应用壳、四个入口和独立 Token 管理
  index.css     # Tailwind 入口和 FastRead 全局样式
  main.tsx      # React 启动文件
scripts/
  visual-check.mjs  # 浏览器视觉与交互验收脚本
```
