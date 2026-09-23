# Fast 产品线 HTTP 接口总览

本文汇总当前**已挂载、可调用**的 HTTP 接口，覆盖 FastResearch、FastNews、FastRead、FastInsight。  
Key 体系与 curl / Python / JS 示例见 [key-login.md](key-login.md)；SSO 票据时序与 FastRead 落地约束见 [sso.md](sso.md)。

本文不收录密钥明文。管理员默认口令只在本地首次启动时有效，生产环境必须用环境变量覆盖。

---

## 1. 服务拓扑

| 服务 | 默认地址 | 入口进程 | 说明 |
|---|---|---|---|
| FastResearch Panel | `http://127.0.0.1:5173` | `npm run dev` | 唯一收集个人 Key 的页面 |
| FastResearch API | `http://127.0.0.1:8787` | `npm run server`（`server/index.mjs`） | 身份、SSO、作者、Insight 信箱 |
| FastNews | `http://127.0.0.1:4173` | `python serve.py` | SSO 门禁 + 静态报告 + 本地 related-work + 反代 `/api/*` |
| FastRead 工作台 | `http://127.0.0.1:3015` | Vite / `run.bat` | 须经 Panel 进入；直开无会话会 302 到 Panel |
| FastRead API | `http://127.0.0.1:8483` | `backend/main.py` → `create_web_app()` | 当前主线 Web API |
| FastInsight | 无 HTTP 服务 | skill / 脚本 | 只出站调用 FastResearch 发布接口 |

```text
成员 ──Key──▶ FastResearch Panel :5173
                 │
                 │  POST /api/content/unlock
                 ▼
           成员会话 Cookie fr_session（JWT，8h）
                 │
     ┌───────────┴───────────┐
     ▼                       ▼
GET /api/sso/launch      GET /api/sso/launch
audience=fast-news       audience=fast-read
     │                       │
     ▼                       ▼
FastNews :4173           FastRead :3015 / :8483
serve.py consume         后端 consume → fastread_session
Cookie fr_session        工作区按 keyId 隔离
```

FastWrite / FastPPT / FastLab 目前只是工作流里的跳转地址，本仓库没有它们的 HTTP 服务。任务列表由 FastResearch 维护。

---

## 2. 鉴权一览

| 凭证 | 谁发 | 有效期 | 用法 |
|---|---|---|---|
| 管理员会话 | `POST /api/admin/login` | 8 小时，**内存**，重启失效 | `Authorization: Bearer <session>` |
| 成员会话 `fr_session` | unlock / consume / launch | 8 小时 JWT | Cookie 或 Bearer；Panel 与 FastNews 共用 |
| SSO 票据 `?sso=` | `/api/sso/ticket` 或 `/api/sso/launch` | **2 分钟、一次性** | 下游服务端 `POST /api/sso/consume` |
| FastRead `fastread_session` | FastRead 兑换票据后签发 | 7 天 | HttpOnly Cookie；写操作还要 `X-CSRF-Token` |
| `X-FastInsight-Key` | 环境变量 `FASTINSIGHT_INGEST_KEY` | 长期服务号密钥 | Insight / 最近阅读写入，**不是**个人 Key |

稳定主键是 `keyId`（20 位 hex），不要用姓名。原始个人 Key（`fk_…`）只允许在 Panel 输入，禁止放进 URL、Cookie、localStorage。

---

## 3. FastResearch API

Base URL：`http://127.0.0.1:8787`（`PORT` / `FASTRESEARCH_PUBLIC_URL`）。  
源码：`FastResearch/server/index.mjs`。

### 3.1 通用约定

| 项 | 值 |
|---|---|
| JSON | 请求 `application/json`；响应 `application/json; charset=utf-8` |
| CORS | 回显允许的 `Origin` + `Access-Control-Allow-Credentials: true`；允许头 `Content-Type, Authorization, X-FastInsight-Key`；允许方法 `GET, POST, PUT, DELETE, OPTIONS` |
| 预检 | `OPTIONS` → `204` `{}` |
| 缓存 | `Cache-Control: no-store` |
| 错误体 | `{ "error": "中文说明" }` |
| 请求体上限 | 1 MiB；非 JSON → 400「请求格式无效」 |
| 未知路径 | 404「接口不存在」 |
| 监听 | `127.0.0.1` |

### 3.2 接口清单

| 方法 | 路径 | 鉴权 | 成功 | 作用 |
|---|---|---|---|---|
| GET | `/api/health` | 无 | 200 `{ "ok": true }` | 健康检查 |
| POST | `/api/admin/login` | 无 | 200 | 管理员登录 |
| POST | `/api/admin/logout` | 任意（无会话也 200） | 200 `{ "ok": true }` | 清管理员会话 |
| GET | `/api/admin/keys` | 管理员 | 200 `{ "keys": [...] }` | 列出 Key（仅 preview） |
| POST | `/api/admin/keys` | 管理员 | 201 | 生成 Key，**完整 `key` 只出现一次** |
| DELETE | `/api/admin/keys/:id` | 管理员 | 200 `{ "ok": true }` | 撤销 Key，保留账号与个人内容 |
| POST | `/api/content/unlock` | 无 | 200 | 个人 Key → 成员会话 + 内容 |
| POST | `/api/content/logout` | 无（清 Cookie） | 200 `{ "ok": true }` | 清 `fr_session` |
| GET | `/api/content/me` | 成员 | 200 | 身份 + 作者 / 标签 / 研究印象 / 未读私信 |
| GET | `/api/content/authors` | 成员 | 200 | 关注作者 + 自定义标签 |
| PUT | `/api/content/authors` | 成员 | 200 | 覆盖保存作者与标签 |
| GET | `/api/content/impression` | 成员 | 200 | 研究印象 |
| PUT | `/api/content/impression` | 成员 | 200 | 保存研究印象 |
| GET | `/api/content/inbox` | 成员 | 200 | 私信列表 |
| PUT | `/api/content/inbox` | 成员 | 200 | 覆盖私信或标已读 |
| POST | `/api/sso/ticket` | 成员 | 200 | 申请一次性票据 |
| GET | `/api/sso/launch` | 成员 | 302 | 出票并跳到 `{target}?sso=ticket` |
| POST | `/api/sso/consume` | 无 | 200 | 兑换票据，Set-Cookie `fr_session` |
| POST | `/api/insight/publish` | `X-FastInsight-Key` | 201 | 写入 Insight 信箱 |
| POST | `/api/content/reading/publish` | 同上 | 201 | 写入最近阅读 |
| GET | `/api/workflow` | 成员 | 200 | 读取当前任务列表 |
| POST | `/api/workflow` | 成员 | 201 | 写入/覆盖自己的任务列表；`{ "default": true }` 加载默认研究流 |
| POST | `/api/workflow/complete` | 成员 | 200 | 完成当前任务并返回下一任务 |
| POST | `/api/workflow/publish` | `X-FastInsight-Key` | 201 | 向成员下发任务列表 |


### 3.2.1 工作流

FastResearch 按任务列表顺序展示功能，模块取值只能是 `fast-ppt` / `fast-write` / `fast-read` / `fast-news` / `fast-lab`（也接受 FastPPT、write、lab 等别名）。完成当前任务后，界面切换到下一功能。

**下发任务列表** `POST /api/workflow/publish`

请求头：`X-FastInsight-Key`。可选 `person` 定向投递；省略则发给全部有效 Key。新列表会覆盖该成员当前工作流并重置完成状态。

```json
{
  "person": "张三",
  "title": "课题 A 研究流",
  "tasks": [
    { "module": "FastPPT", "title": "整理开题幻灯片", "description": "把问题定义做成 8 页演示" },
    { "module": "FastWrite", "title": "写相关工作" },
    { "module": "FastRead", "title": "精读核心论文" },
    { "module": "FastNews", "title": "跟踪本周新文" },
    { "module": "FastLab", "title": "复现实验" }
  ]
}
```

成功 201：`{ "ok": true, "deliveredTo": ["张三"], "workflow": { ... } }`。  
失败：401 发布凭证无效；400 任务列表不能为空 / 功能无效；404 没有匹配的成员 Key。任务最多 50 条。

**读取** `GET /api/workflow`（成员）返回 `{ "workflow": ... | null }`。`GET /api/content/me` 也会带上同一份 `workflow`。

**自己写入** `POST /api/workflow`（成员）body 同 publish 的 `title` + `tasks`，或 `{ "default": true }` 加载默认顺序：FastPPT → FastWrite → FastRead → FastNews → FastLab。

**完成当前任务** `POST /api/workflow/complete`

```json
{ "taskId": "可选，默认当前任务" }
```

成功 200：`{ "workflow", "nextTask" }`。`nextTask` 为 `null` 表示全部完成。  
失败：404 尚未收到任务列表；400 已全部完成；409 未按顺序完成。

`workflow` 形状：

```json
{
  "id": "…",
  "title": "课题 A 研究流",
  "source": "api",
  "receivedAt": "2026-09-18T12:00:00.000Z",
  "currentIndex": 1,
  "doneCount": 1,
  "total": 5,
  "completed": false,
  "currentTask": { "id": "…", "module": "fast-write", "title": "写相关工作", "status": "active" },
  "tasks": [
    { "id": "…", "module": "fast-ppt", "title": "整理开题幻灯片", "description": "…", "status": "done", "completedAt": "…" }
  ]
}
```

### 3.3 管理员

**登录** `POST /api/admin/login`

```json
{ "username": "admin", "password": "••••" }
```

成功：`{ "session", "username", "expiresAt" }`（`expiresAt` 为 Unix **毫秒**）。  
失败：`401 管理员账号或密码错误`。  
默认账号来自首次写入 `data/access.json` 的 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（未配置时为 `admin` / `admin123456`）。

**生成 Key** `POST /api/admin/keys`  
Body：`{ "person": "张三", "expiresAt": null }`。`person` 最长 80，空则「未命名成员」。

成功 201：

```json
{
  "key": "fk_…",
  "record": { "id", "person", "keyPreview", "createdAt", "expiresAt", "active": true }
}
```

**列出** 只返回 `id / person / keyPreview / createdAt / expiresAt / active`，不含完整 Key。  
**删除** 不存在则 `404 个人 Key 不存在`。删除后 unlock / 出票 / consume 均失败。

### 3.4 成员会话与内容

解锁、consume、`/me` 成功时的身份字段：

```json
{
  "session": "JWT",
  "person": "张三",
  "keyId": "20位hex",
  "expiresAt": 1710028800000,
  "recentArticles": [],
  "insightItems": [],
  "authors": [],
  "customTags": [],
  "impression": { "text": "", "updatedAt": "" },
  "inboxUnread": 0
}
```

`recentArticles` / `insightItems` 每类最多 100 条，新的在前。条目字段：`id, title, summary, url, source, direction, authors, venue, receivedAt`。`impression.text` 最长 4000，保留换行。`inboxUnread` 是未读私信条数。

**关注作者** `PUT /api/content/authors`

```json
{
  "authors": [
    {
      "id": "author-1",
      "name": "Alice",
      "homepage": "https://example.com/alice",
      "tags": ["Web 安全"],
      "fetchState": "idle",
      "fetchMessage": "",
      "parsed": null
    }
  ],
  "customTags": ["侧信道"]
}
```

规范化：作者最多 200；`name` 100；`homepage` 1000；`tags` 最多 20×40；`customTags` 最多 40×40。无 `name` 的作者丢弃。

**研究印象** `GET / PUT /api/content/impression`

```json
{
  "impression": {
    "text": "我关注 LLM 越狱、TEE 侧信道，以及可复现的系统安全论文。",
    "updatedAt": "2026-09-18T04:00:00.000Z"
  }
}
```

PUT 请求体 `{ "text": "..." }`（也接受 `{ "impression": { "text": "..." } }`）。最长 4000 字，保留换行；`updatedAt` 由服务端写入。FastNews 的领域导读、顶会 related work 和每日私信都会读这份印象。

**私信** `GET / PUT /api/content/inbox`

```json
{
  "items": [
    {
      "id": "daily-2026-09-18-p-jailbreak",
      "date": "2026-09-18",
      "kind": "daily-paper",
      "paperId": "p-jailbreak",
      "title": "TwinBreak",
      "title_zh": "TwinBreak：越狱攻防",
      "summary": "……",
      "reason": "与你的研究方向重叠。",
      "url": "https://example.com/paper",
      "venue": "NDSS",
      "year": "2026",
      "authors": "Alice",
      "category": "ML/AI Security",
      "source": "top-conf",
      "read": false,
      "receivedAt": "2026-09-18T10:00:00+08:00"
    }
  ],
  "unread": 1
}
```

PUT 可传 `items` 全量覆盖，和/或 `readIds` 把对应条目标为已读。条目最多 180；`date` 必须是 `YYYY-MM-DD`。FastNews `GET /api/content/inbox` 会在上海日历日尚无 `daily-paper` 时生成一篇再写回这里。

### 3.5 SSO

开放 audience：**`fast-news`**、**`fast-read`**（精确字符串）。

| 接口 | 调用方 | 要点 |
|---|---|---|
| `POST /api/sso/ticket` `{ "audience" }` | 仅 Panel | 返回 `{ ticket, expiresAt, apiUrl }`。下游**不要用 `apiUrl`**，用自己配置的 `FASTRESEARCH_API_URL` |
| `GET /api/sso/launch?audience=&next=` | 仅 Panel | 302 到目标并带 `?sso=`；同时刷新成员 Cookie |
| `POST /api/sso/consume` `{ "ticket", "audience" }` | 下游**服务端** | 无需 Authorization；读到即删。audience 不一致 / 过期 / 已用 / Key 已删 → 401 |

launch 默认回退地址：

| audience | 环境变量 | 本地回退 |
|---|---|---|
| `fast-news` | `FASTNEWS_URL` / `VITE_FASTNEWS_URL` | `http://127.0.0.1:4173` |
| `fast-read` | `FASTREAD_URL` / `VITE_READ_URL` | `http://127.0.0.1:3015` |

### 3.6 服务号写入

```http
POST /api/insight/publish
POST /api/content/reading/publish
X-FastInsight-Key: <FASTINSIGHT_INGEST_KEY>
```

```json
{
  "person": "张三",
  "item": {
    "id": "可选",
    "title": "标题",
    "summary": "摘要",
    "url": "https://…",
    "direction": "系统安全",
    "authors": "Alice, Bob",
    "venue": "USENIX 2026",
    "source": "FastInsight"
  }
}
```

| 字段 | 说明 |
|---|---|
| `person` | 可选。空则发给**所有有效 Key**；有值则按显示名大小写不敏感匹配 |
| 默认 `source` | insight → `FastInsight`；reading → `FastRead` |

成功 201：`{ "ok": true, "deliveredTo": ["张三"] }`。  
无匹配 Key → `404 没有匹配的成员 Key`。凭证错 → `401 FastInsight 发布凭证无效`。

### 3.7 错误码

| 状态 | error |
|---|---|
| 400 | 个人 Key 不能为空 / 不支持的登录入口 / FastNews 或 FastRead 地址无效 / 请求格式无效 / 请求内容过大 / 缺少个人 Key |
| 401 | 管理员账号或密码错误 / 管理员登录已失效 / 成员登录已失效 / 个人 Key 无效、已撤销或已过期 / 登录票据无效或已过期 / FastInsight 发布凭证无效 |
| 404 | 个人 Key 不存在 / 没有匹配的成员 Key / 接口不存在 |

---

## 4. FastNews

源码：`FastNews/serve.py`。必须用该进程作为产品入口，不要用 `python -m http.server`。  
本地由 `serve.py` 处理 `POST /api/related-work`、`POST /api/field-briefing` 和 `GET /api/content/inbox`（补今日推送）；其余 `/api/*` 反代到 FastResearch。

### 4.1 页面门禁（非 JSON API）

| 条件 | 行为 |
|---|---|
| `GET/HEAD {path}?sso=ticket` | 服务端 `POST {FASTRESEARCH}/api/sso/consume`，audience=`fast-news`；成功则 Set-Cookie `fr_session`，302 到去掉 `sso` 的同一路径 |
| 无 Cookie 或会话无效 | 302 到 `FASTRESEARCH_PANEL_URL`（默认 `:5173`） |
| 有有效会话 | 返回静态文件（html/css/js/json/pdf 等白名单后缀） |
| 其它方法打静态路径 | 405 |

会话校验：带 Cookie 调 FastResearch `GET /api/content/me`，结果缓存 30 秒。

### 4.2 `POST /api/related-work`（本地实现，不反代）

按研究方向从候选论文里做 LLM 排序。路径命中后**不再走 SSO 校验**（当前实现如此）。

**请求**

```json
{
  "topic": "研究方向，最长 120",
  "keywords": "关键词，最长 200",
  "impression": "研究印象，可选，最长 4000",
  "candidates": [
    {
      "id": "候选 id，最长 180",
      "title": "标题，必填，最长 300",
      "category": "最长 80",
      "conference": "最长 80",
      "year": "最长 8",
      "summary": "最长 240"
    }
  ]
}
```

`topic`、`keywords`、`impression` 至少有一个；若前两者都空，则用印象截断后的前 120 字当 `topic`。`candidates` 最多取 40 条（去重 id）。

**成功 200**

```json
{
  "items": [
    { "id": "候选 id", "score": 0.87, "reason": "一句中文，说明方法/威胁模型/问题重叠" }
  ],
  "source": "llm"
}
```

最多 12 条，按模型给出的分数降序；`score` 被夹到 `[0, 1]`。

**失败**

| 状态 | error |
|---|---|
| 400 | `topic or keywords required` / `candidates required` |
| 405 | `Method not allowed`（非 POST） |
| 502 | `upstream llm error` / `related-work failed` / `empty ranking` |
| 503 | `OPENAI_API_KEY is not configured` |
| 204 | `OPTIONS` 预检，无 body |

环境变量：`OPENAI_API_KEY`（必填）、`OPENAI_BASE_URL`（默认 `https://api.openai.com/v1`）、`LLM_MODEL`（默认 `gemini-3-flash-preview`）。本地超时 60s，`max_tokens=2500`；Vercel 函数超时约 18s，`max_tokens=1200`。

前端失败时会回退到本地相关度排序（页面提示「推荐服务暂不可用，已用本地相关度排序」）。顶会页在研究方向和关键词都空时，会用研究印象继续检索。

### 4.3 `POST /api/field-briefing`（本地实现，不反代）

按研究方向检索顶会中文摘要与近期 arXiv，再生成领域导读。路径命中后不再走 SSO 校验。

**请求**

```json
{
  "query": "研究方向，最长 120；也接受 topic / q",
  "impression": "研究印象，可选，最长 4000",
  "category": "FastNews 类别，可选",
  "source": "all | top-conf | arxiv",
  "arxiv_days": 90
}
```

`query` 可空：若有 `impression`，用其前 120 字当查询。检索时会把印象前 200 字拼进 query。无命中时仍 200，`papers` 为空。LLM 失败则回退到词面排序。

### 4.4 `GET /api/content/inbox`（本地补今日推送）

需要成员 Cookie / Bearer。`serve.py` 先向 FastResearch 拉私信；若上海日历日还没有 `kind=daily-paper`，则按研究印象 → 关注作者 tags → 通用安全方向检索一篇，写回 FastResearch 后再返回。

成功 200：`{ "items": [...], "unread": 0, "generatedToday": true|false }`。  
无会话 401。`PUT /api/content/inbox` 仍反代到 FastResearch，用于覆盖列表或 `{ "readIds": ["..."] }` 标已读。

查询优先级：印象文本 → 关注作者 / 自定义标签 → `computer security 系统安全 网络安全`。已推过的 `paperId` / `url` 会跳过。一天一篇。

### 4.5 其它 `/api/*`：反代到 FastResearch

`serve.py` 把 **除** `/api/related-work`、`/api/field-briefing`、`GET /api/content/inbox` **以外** 的 `/api/*` 原样转发到 `FASTRESEARCH_API_URL`（默认 `http://127.0.0.1:8787`）。

转发请求头：`Authorization`、`Content-Type`、`Accept`、`Cookie`。  
上游不可达 → `502 { "error": "无法连接 FastResearch" }`。

页面实际使用：

| 方法 | 路径 | 用途 |
|---|---|---|
| GET | `/api/content/me` | `gate.js` / `authors-nav.js` 校验成员，拉作者、印象和未读数 |
| GET / PUT | `/api/content/authors` | 维护关注作者 |
| GET / PUT | `/api/content/impression` | 读写研究印象 |
| GET / PUT | `/api/content/inbox` | 私信；GET 由 FastNews 拦截以生成今日推送 |

浏览器应对这些请求使用 `credentials: "include"`，走同源 Cookie，不要把 FastResearch 地址拼进前端。总览栏折叠状态只存在浏览器 `localStorage fastnews.sidebarCollapsed`。

---

## 5. FastRead Web API

当前入口是 **Web 应用**，不是桌面端路由。

- 进程：`backend/main.py` → `app.web.api.create_web_app()`
- 源码：`FastRead/backend/app/web/api.py`、`auth.py`
- 前端：`fastread-frontend/src/web/App.tsx`（`main.tsx` 挂的是这一套）
- 工作台：`http://127.0.0.1:3015`（Vite 把 `/api` 代理到 `:8483`）

`backend/app/routers/*.py`（含 `/api/sys_check`、evidence hub、`/api/v1/interactions` 等）**当前未挂载**，见 [§7](#7-未挂载的桌面端路由)。

### 5.1 通用约定

| 项 | 值 |
|---|---|
| 前缀 | `/api` |
| 成员 Cookie | HttpOnly `fastread_session`，`SameSite=Lax`，7 天；`FASTREAD_COOKIE_SECURE` 默认 `true` |
| CSRF | 除 GET/HEAD/OPTIONS 外必须带 `X-CSRF-Token`（值来自 `/api/auth/me` 或 `/api/auth/research`） |
| 幂等 | 导入、报告、问答、索引、近邻等写任务需要请求头 `Idempotency-Key`（1–160 字符） |
| 错误体 | FastAPI `{ "detail": "…" }`（字符串或校验数组） |
| 缓存 | `/api/*` 响应 `Cache-Control: no-store` |
| 跨站 | 非 GET/HEAD/OPTIONS 若带 `Origin`，必须在允许列表内，否则 403「不允许跨站请求」 |
| 未登录 HTML | 文档 GET 无会话且无 `sso` → 302 `FASTRESEARCH_PANEL_URL` |
| `?sso=` | 中间件在服务端兑换后 302 到干净路径并 Set-Cookie；Vite 开发服务器也会先 `POST /api/auth/research` |

允许 Origin：当前站点、`FASTREAD_PUBLIC_ORIGIN`、`FASTREAD_FRONTEND_ORIGIN`、Panel、`http://127.0.0.1:{前端端口}`。

后台任务 `state`：`queued / running / succeeded / failed / needs_attention / cancelled`。  
任务 `kind`：`import_url / import_pdf / report / chat / index / neighbors`。

任务对象：

```json
{
  "id": "…",
  "kind": "report",
  "resource_id": "paper_id 或 conversation_id",
  "version_id": "…",
  "state": "queued",
  "attempts": 0,
  "error_code": null,
  "error": null,
  "created": 1710000000.0,
  "updated": 1710000000.0,
  "result": null
}
```

限流类 `ValueError`：`daily_model_limit` / `workspace_queue_full` → **429**；其它 `ValueError` → 409；记录不存在 → 404 `{ "detail": "记录不存在" }`。

### 5.2 鉴权

| 方法 | 路径 | 登录 | 说明 |
|---|---|---|---|
| GET | `/api/health` | 否 | `{ "status": "healthy", "schema": 1 }` |
| GET | `/api/auth/login-info` | 否 | `{ "mode": "fastresearch-key", "panel_url" }` |
| POST | `/api/auth/research` | 否 | body `{ "ticket" }`；兑换 FastResearch 票据，Set-Cookie，返回 `{ "csrf" }` |
| GET | `/api/auth/me` | 是 | 当前用户 / 工作区 / `csrf` / `research_key_id` |
| POST | `/api/auth/logout` | 是 | 删会话并清 Cookie，`{ "ok": true }` |

`POST /api/auth/research` 会调用 FastResearch `POST /api/sso/consume`，`audience=fast-read`，按返回的 `keyId` upsert 本地用户与工作区，占位邮箱为 `key-{keyId}@sso.fastresearch.local`。同一 `keyId` 始终进入同一工作区。票据失败：`401 Panel 登录已过期，请从 FastResearch 重新进入`；未配置或连不上 FastResearch：`503`。

`/api/auth/me` 示例：

```json
{
  "email": "key-…@sso.fastresearch.local",
  "display_name": "张三",
  "research_key_id": "…",
  "workspace_id": "…",
  "role": "owner",
  "csrf": "…",
  "workspace": { "name": "张三", "daily_limit": … }
}
```

以下接口均需已登录成员（`require_user`）。写操作还要 CSRF；标注「任务」的还需 `Idempotency-Key`。

### 5.3 论文与导入

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| GET | `/api/papers` | 200 | 列表。Query：`limit`(1–100, 默认 20)、`offset`、`q`、`archived` |
| GET | `/api/papers/{paper_id}` | 200 | 详情 + `metadata` + `versions` |
| DELETE | `/api/papers/{paper_id}` | 200 | 归档 `{ "archived": true }`；有排队/运行中任务则 409 |
| POST | `/api/papers/{paper_id}/restore` | 200 | 取消归档 |
| GET | `/api/papers/{paper_id}/pages/{number}` | 200 | 单页原文 `{ number, text, version_id }`。Query：`version` |
| GET | `/api/papers/{paper_id}/file` | 200 | 原 PDF 流。Query：`version` |
| POST | `/api/imports/url` | 202 | JSON `{ url, provider_id?, model? }` → 导入任务 |
| POST | `/api/imports/pdf` | 202 | `multipart/form-data`：`file` + 可选 `provider_id` / `model` |
| POST | `/api/search` | 200 | `{ "query", "limit"? }` → `{ "papers", "sources" }`（arxiv / crossref / openalex，不入库） |

列表项会展开 `authors`、`year`、`page_count`。`url` 必须是公开 http(s)，不能带用户名密码。

### 5.4 报告、总结、对话、近邻

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| GET | `/api/jobs` | 200 | `{ "items": [任务…] }`。Query：`limit`、`offset` |
| GET | `/api/jobs/{job_id}` | 200 | 单个任务 |
| POST | `/api/papers/{paper_id}/reports` | 202 | body `{ provider_id, model }` → 生成阅读报告任务 |
| GET | `/api/papers/{paper_id}/reports` | 200 | `{ items: [{id,version_id,created}], active_version }` |
| GET | `/api/papers/{paper_id}/reports/{report_id}` | 200 | 报告正文；`stale` 表示是否旧版本 |
| PUT | `/api/papers/{paper_id}/summary` | 200 | `{ "content": "个人总结，最长 10000" }` |
| GET | `/api/papers/{paper_id}/export` | 200 | Markdown 阅读报告附件 |
| GET | `/api/papers/{paper_id}/conversations` | 200 | 对话列表 |
| POST | `/api/papers/{paper_id}/conversations` | 201 | 取或建当前版本对话 |
| GET | `/api/conversations/{cid}/messages` | 200 | `{ items }`。Query：`limit`、`offset` |
| POST | `/api/conversations/{cid}/messages` | 202 | `{ content, provider_id, model }` → 问答任务；同对话有进行中任务则 409 |
| POST | `/api/papers/{paper_id}/index` | 202 | 重建索引任务 |
| POST | `/api/papers/{paper_id}/neighbors` | 202 | 近邻论文任务 |

报告 `content` 常见段：`key_questions`、`process`、`contributions`、`limitations`；证据带页码与逐字引文。

### 5.5 供应商与专题

| 方法 | 路径 | 状态 | 说明 |
|---|---|---|---|
| GET | `/api/providers` | 200 | `{ items: [{ id, name, base_url, models }] }`，不含 api_key |
| POST | `/api/providers` | 201 | **仅 owner**。`{ name, base_url, api_key, models[] }`；`base_url` 必须是无 query/fragment 的 HTTPS |
| GET | `/api/topics` | 200 | `{ items: [{ id, question, scope }] }` |
| GET | `/api/topics/{topic_id}` | 200 | 专题 + `evidence` + `hypotheses` |

未配置供应商/模型就发起计费任务 → `400 请先配置工作区供应商与模型`。

### 5.6 浏览器调用注意

前端 `fetch('/api' + path, { credentials: 'same-origin' })`，写操作带 `X-CSRF-Token` 与（任务类）`Idempotency-Key`。  
开发时若地址栏有 `?sso=`，Vite 插件会先兑换再放行；前端还会再调一次 `/api/auth/research`（同一 ticket 服务端第二次会失败，前端用本地变量去重）。生产静态站由 FastAPI 中间件兑换。

---

## 6. FastInsight

FastInsight **没有**对外 HTTP 服务。飞书长连接在本地跑流水线，发布走 FastResearch：

```http
POST {FASTRESEARCH_URL}/api/insight/publish
X-FastInsight-Key: {FASTINSIGHT_INGEST_KEY}
```

脚本：`FastInsight/scripts/publish_to_research.py`。

```bash
python scripts/publish_to_research.py --paper paper.json --trends trends.json \
  --person "成员名" --direction "方向名"
```

环境变量：`FASTRESEARCH_URL`（默认 `http://127.0.0.1:8787`）、`FASTINSIGHT_INGEST_KEY`。  
成功响应必须是 `{ "ok": true, "deliveredTo": [...] }`。学术检索（Semantic Scholar / arXiv / Crossref）是脚本出站调用，不是本产品线接口。

---

## 7. 未挂载的桌面端路由

`FastRead/backend/app/__init__.py` 仍能组合下列路由器，但 **`backend/main.py` 明确不再挂载**：

| 前缀 | 文件 | 代表路径 |
|---|---|---|
| `/api` | `routers/note.py` | `/tasks`、`/papers/search`、`/papers/{id}/related-work`、`/reading_reports`、`/papers/upload` |
| `/api` | `routers/provider.py` | `/add_provider`、`/get_all_providers`、`/connect_test` |
| `/api` | `routers/model.py` | `/model_list`、`/models` |
| `/api` | `routers/config.py` | `/sys_health`、`/sys_check`、`/deploy_status` |
| `/api` | `routers/chat.py` | `/chat/index`、`/chat/ask` |
| `/api` | `routers/evidence_hub.py` | 批注、FastNews/FastInsight 导入、研究专题、FastWrite handoff |
| `/api` | `routers/search_config.py` | `/paper_search_config` |
| `/api/v1/interactions` | `routers/interactions.py` | `/push`、`/get`、`/metadata-migrations` |

这些接口历史上要求本机回环访问（`require_local_request`）。前端旧版 `src/App.tsx` + `src/services/*` 仍可能引用它们，但 `main.tsx` 已改为 `src/web/App.tsx`。联调请以本文 §5 为准。

FastResearch 旧版 `App.tsx` 中的 `/api/guest/verify` 等同样未使用（`main.tsx` 用的是 App2）。

---

## 8. 环境变量（与接口相关）

### FastResearch

| 变量 | 默认 | 作用 |
|---|---|---|
| `PORT` | `8787` | API 端口 |
| `FASTRESEARCH_PUBLIC_URL` | `http://127.0.0.1:8787` | ticket 响应里的 `apiUrl` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | `admin` / `admin123456` | 首次写入 `data/access.json` |
| `FASTINSIGHT_INGEST_KEY` | （必填才允许发布） | 服务号写入 |
| `FASTRESEARCH_JWT_SECRET` | 数据文件内随机值 | 成员 JWT |
| `VITE_FASTNEWS_URL` / `VITE_READ_URL` | `:4173` / `:3015` | launch 回退目标 |

### FastNews

| 变量 | 默认 | 作用 |
|---|---|---|
| `FASTRESEARCH_API_URL` | `http://127.0.0.1:8787` | consume / 反代 / `/me` |
| `FASTRESEARCH_PANEL_URL` | `http://127.0.0.1:5173` | 未登录回跳 |
| `FASTNEWS_HOST` / `FASTNEWS_PORT` | `127.0.0.1` / `4173` | 监听 |
| `OPENAI_API_KEY` / `OPENAI_BASE_URL` / `LLM_MODEL` | 见 §4.2 | related-work |

### FastRead

| 变量 | 默认 | 作用 |
|---|---|---|
| `BACKEND_HOST` / `BACKEND_PORT` | `127.0.0.1` / `8483` | API 监听 |
| `FASTRESEARCH_API_URL` | `http://127.0.0.1:8787` | 服务端 consume |
| `FASTRESEARCH_PANEL_URL` | `http://127.0.0.1:5173` | 未登录回跳 |
| `FASTREAD_COOKIE_SECURE` | `true` | Cookie `Secure` 标志 |
| `VITE_FRONTEND_PORT` | `3015` | 工作台 |

---

## 9. 联调最短路径

1. 启动 FastResearch API `:8787` + Panel `:5173`。`GET /api/health` → `{ "ok": true }`。
2. 管理员登录 → 生成个人 Key → Panel `unlock`。
3. 启动 FastNews `python serve.py`。从 Panel 点 FastNews，地址栏应无 `sso`，`GET /api/content/me` 成功。
4. `POST /api/related-work` 在配置了 LLM Key 时应返回 `source: "llm"`；否则前端走本地排序。
5. 启动 FastRead 后端 `:8483` + 前端 `:3015`。`GET /api/health` → `{ "status": "healthy" }`。从 Panel 点 FastRead，`GET /api/auth/me` 带 `research_key_id`。
6. FastInsight：`publish_to_research.py` 后，该成员 `insightItems` 增加；Panel 每 15 秒同步信箱。

账号存储已升级为 SQLite，迁移/回滚、稳定 accountId、Key 轮换和持久会话说明见 [账号迁移](account-migration.md)。已有 `access.json` 首次升级后保留为原始快照，不再实时写入。
