# FastResearch

FastResearch 是一个面向科研阅读与知识工作的工作流控制台。它维护一条任务列表，并按任务顺序展示 FastPPT、FastWrite、FastRead、FastNews 和 FastLab；完成当前任务后进入下一功能。FastInsight 信箱仍接收飞书经 skill 回传的研究卡片。FastWrite、FastPPT、FastLab 可直接访问；FastRead、FastNews 和信箱由个人 Key 保护。FastRead 和 FastNews 都用一次性 SSO 票据进入，直开 :3015 / :4173 会 302 到 Panel。

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
VITE_FASTNEWS_URL=https://example.com/fast-news
VITE_FASTPPT_URL=https://example.com/fast-ppt
VITE_FASTLAB_URL=https://example.com/fast-lab
FASTRESEARCH_PUBLIC_URL=http://127.0.0.1:8787

```

未配置地址时，对应入口点击后不会跳转。FastPPT、FastLab 未填地址时会提示待配置。本地未填 `VITE_FASTNEWS_URL` 时，FastNews 默认跳到 `http://127.0.0.1:4173`；未填 `VITE_READ_URL` 时，FastRead 默认跳到 `http://127.0.0.1:3015`。FastPPT 直接跳转，不走 SSO。`FASTRESEARCH_PUBLIC_URL` 是浏览器访问 FastResearch API 的地址，默认 `http://127.0.0.1:8787`。不要填 Vite 开发服务器地址。

## 访问与个人 Key

FastWrite、FastPPT、FastLab 入口点击后直接跳转到配置的地址。FastRead 和 FastNews 需要先用个人 Key 解锁：`/api/sso/launch` 签发一次性票据并 302 到 `{READ|NEWS}?sso=ticket`，再由各模块服务端兑换。直开 FastRead `:3015` 或 FastNews `:4173` 会被送到 Panel。个人 Key 登录与各模块对接见 [docs/key-login.md](docs/key-login.md)，FastRead SSO 补充见 [docs/sso.md](docs/sso.md)。当前全部 HTTP 接口总览见 [docs/api.md](docs/api.md)。

1. 点击右上角管理员登录按钮，使用管理员账号密码进入个人 Key 管理后台。
2. 管理员按成员姓名生成 Key，可填写过期时间，也可以随时删除（删除后列表中不再显示该 Key）。
3. Key 只在生成成功时显示完整值一次；后端只保存 SHA-256 哈希和内容数据。
4. 成员点击 ACCESS KEY，输入个人 Key 后解锁 FastInsight 信箱，并建立成员会话。
5. 已解锁后点击 FastNews 或 FastRead，控制台走同一套 Key + `/api/sso/launch`：两者都带 `?sso=` 票据进入，由各模块服务端兑换后签发登录态（FastNews 用 HttpOnly `fr_session`，FastRead 用 `fastread_session`）。
6. 关注作者按 Key 保存在 FastResearch 服务端。FastNews 必须用 `python serve.py` 启动，直开静态文件或 `python -m http.server` 无法作为产品入口。
7. 管理员会话保存在当前浏览器的 `sessionStorage`；成员登录凭证是 HttpOnly Cookie `fr_session`（JWT，8 小时）。不要把原始 Key 长期存在浏览器里。

工作流下发接口为 `POST /api/workflow/publish`，请求头同样使用 `X-FastInsight-Key`：

```json
{
  "person": "张三",
  "title": "课题 A 研究流",
  "tasks": [
    { "module": "FastPPT", "title": "整理开题幻灯片" },
    { "module": "FastWrite", "title": "写相关工作" },
    { "module": "FastRead", "title": "精读核心论文" },
    { "module": "FastNews", "title": "跟踪本周新文" },
    { "module": "FastLab", "title": "复现实验" }
  ]
}
```

成员也可 `POST /api/workflow` 写入自己的任务列表，或发送 `{ "default": true }` 加载默认研究流。完成当前任务调用 `POST /api/workflow/complete`，界面会进入下一功能。

FastInsight 服务端发布接口为 `POST /api/insight/publish`，请求头使用 `X-FastInsight-Key`，请求体包含 `person` 和 `item`。阅读项目可使用 `POST /api/content/reading/publish` 写入“最近阅读”列表，同样使用服务端发布凭证。

个人 Key 解锁后，页面每 15 秒自动同步一次信箱，因此 FastInsight skill 发布后无需手动刷新浏览器。

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
  index.mjs     # 管理员登录、个人 Key、成员会话、FastNews/FastRead SSO 和 FastInsight 发布 API
docs/
  key-login.md  # 个人 Key 登录与各模块对接接口（含示例）
  sso.md        # FastRead SSO 对接补充
scripts/
  visual-check.mjs  # 浏览器视觉与交互验收脚本
```
