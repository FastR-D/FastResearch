# FastResearch

FastResearch 是一个面向科研阅读与知识工作的工具入口控制台。当前提供 FastRead、FastWrite、FastTask 和 FastNews 四个独立入口，入口可直接访问；最近阅读整合和 FastInsight 分发信息由个人 Key 保护。

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

首次启动会创建 `data/access.json`。默认管理员账号为 `admin`，默认密码为 `admin123456`。生产环境请通过 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `FASTINSIGHT_INGEST_KEY` 环境变量设置凭证。

## 配置工具地址

复制 `.env.example` 为 `.env.local`，填写对应工具的入口地址：

```env
VITE_READ_URL=https://example.com/read
VITE_WRITE_URL=https://example.com/write
VITE_FASTTASK_URL=https://example.com/fast-task
VITE_FASTNEWS_URL=https://example.com/fast-news

```

未配置地址时，对应入口点击后不会跳转。FastTask 和 FastNews 卡片会显示“待配置”。

## 访问与个人 Key

FastRead、FastWrite、FastTask 和 FastNews 入口不再需要 Token，点击后直接跳转到配置的地址。只有右侧的“最近阅读的文章整合”和“接收 FastInsight 传递过来的信息”需要个人 Key。

1. 点击右上角管理员登录按钮，使用管理员账号密码进入个人 Key 管理后台。
2. 管理员按成员姓名生成 Key，可填写过期时间，也可以随时撤销。
3. Key 只在生成成功时显示完整值一次；后端只保存 SHA-256 哈希和内容数据。
4. 成员点击右侧加密面板，输入个人 Key 后查看自己的阅读整合与 FastInsight 信息。
5. 管理员会话和个人 Key 仅保存在当前浏览器会话的 `sessionStorage` 中，服务端会话默认 8 小时有效。

例如：

```text
https://example.com/fast-task
```

FastInsight 服务端发布接口为 `POST /api/insight/publish`，请求头使用 `X-FastInsight-Key`，请求体包含 `person` 和 `item`。阅读项目可使用 `POST /api/content/reading/publish` 写入“最近阅读”列表，同样使用服务端发布凭证。

个人 Key 解锁后，页面每 15 秒自动同步一次内容，因此 FastInsight 发布后无需手动刷新浏览器。

## 可用命令

```bash
npm run server       # 启动个人 Key 管理 API
npm run dev          # 启动前端开发服务器
npm run build        # 执行 TypeScript 检查并构建生产版本
npm run lint         # 执行 ESLint 检查
npm run preview      # 预览生产构建
npm run test:visual  # 使用 Edge 验证桌面端、移动端和 Key 交互
```

`npm run test:visual` 默认使用 Windows Edge。也可以通过 `EDGE_PATH` 指定浏览器路径，并通过 `VISUAL_CHECK_URL` 指定待检查的服务地址。

## 目录说明

```text
src/
  App2.tsx      # 按布局图实现的应用壳、内容解锁和管理员后台
  index.css     # Tailwind 入口和 FastRead 全局样式
  main.tsx      # React 启动文件
server/
  index.mjs     # 管理员登录、个人 Key、内容解锁和 FastInsight 发布 API
scripts/
  visual-check.mjs  # 浏览器视觉与交互验收脚本
```
