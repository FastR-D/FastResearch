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
npm run server
```

另开一个终端启动前端：

```bash
npm run dev
```

启动后访问：`http://127.0.0.1:5173`

后端 API 默认监听：`http://127.0.0.1:8787`

首次启动会创建 `data/tokens.json`。默认管理员账号为 `admin`，默认密码为 `admin123456`。生产环境请通过 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 环境变量设置管理员账号密码。

## 配置工具地址

复制 `.env.example` 为 `.env.local`，填写对应工具的入口地址：

```env
VITE_READ_URL=https://example.com/read
VITE_WRITE_URL=https://example.com/write
VITE_FASTTASK_URL=https://example.com/fast-task
VITE_FASTNEWS_URL=https://example.com/fast-news

```

未配置地址时，对应入口点击后不会跳转。FastTask 和 FastNews 卡片会显示“待配置”。

## Token 登录机制

Read、Write、FastTask 和 FastNews 分别使用自己的 Token，Token 不会在入口之间共用。

1. 点击右上角管理员登录按钮，使用管理员账号密码进入 Token 管理后台。
2. 管理员可以为四个入口分别生成 Token，可填写备注和过期时间，也可以随时撤销。
3. Token 只在生成成功时显示完整值一次；后端只保存 SHA-256 哈希和 Token 元数据。
4. 游客点击功能入口后输入管理员分发的 Token，后端校验通过后，Token 会作为 `token` 查询参数传给对应工具。
5. 管理员会话保存在当前浏览器会话的 `sessionStorage` 中，服务端会话默认 8 小时有效。

例如：

```text
https://example.com/fast-task?token=fr_xxxxxxxxxxxxxxxxxxxxxxxxx
```

## 可用命令

```bash
npm run server       # 启动 Token 管理 API
npm run dev          # 启动前端开发服务器
npm run build        # 执行 TypeScript 检查并构建生产版本
npm run lint         # 执行 ESLint 检查
npm run preview      # 预览生产构建
npm run test:visual  # 使用 Edge 验证桌面端、移动端和 Token 交互
```

`npm run test:visual` 默认使用 Windows Edge。也可以通过 `EDGE_PATH` 指定浏览器路径，并通过 `VISUAL_CHECK_URL` 指定待检查的服务地址。

## 目录说明

```text
src/
  App.tsx       # 应用壳、游客 Token 登录和管理员后台
  index.css     # Tailwind 入口和 FastRead 全局样式
  main.tsx      # React 启动文件
server/
  index.mjs     # 管理员登录、Token 分发、撤销和游客校验 API
scripts/
  visual-check.mjs  # 浏览器视觉与交互验收脚本
```
