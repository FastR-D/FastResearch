# FastResearch 个人 Key 登录接口

本文给 **FastRead / FastNews / FastWrite / FastLab / FastPPT / FastInsight** 等下游模块对接用。Panel（FastResearch）是唯一收集个人 Key 的地方；其他模块通过一次性 SSO 票据获得同一身份。

完整 SSO 时序与 FastRead 落地注意见 [sso.md](sso.md)。本文覆盖 Key 体系、全部相关 HTTP 接口和可复制示例。

默认 Base URL：`http://127.0.0.1:8787`（环境变量 `FASTRESEARCH_PUBLIC_URL` / `PORT`）。不要填 Vite 开发地址 `:5173`。

---

## 1. 设计原则

1. **个人 Key 只在 Panel 输入一次。** 下游不要做 Key 输入框，不要把 `fk_…` 放进 URL、Cookie、localStorage。
2. **稳定主键是 `keyId`，不是姓名。** `person` 只用于显示，允许重名。
3. **成员会话和原始 Key 不是一回事。** 解锁后签发 HS256 JWT，写入 HttpOnly Cookie `fr_session`（8 小时）；JSON 里的 `session` 仍可作为 Bearer。服务端只存 Key 的 SHA-256，完整 Key 只在生成时返回一次。
4. **FastNews 和 FastRead 都走一次性 SSO 票据。** FastNews 由 `serve.py` 服务端兑换后写入 HttpOnly Cookie；不要把凭证放进 URL。
5. **有后端的模块必须在服务端兑换票据。** FastNews 兑换后用同源 `/api` 反代 + `credentials: include`；不要再把 `research_api` 拼进跳转地址，也不要直开静态站。
6. **服务号密钥 ≠ 个人 Key。** FastInsight / 最近阅读写入用请求头 `X-FastInsight-Key`，与成员 Key 无关。

---

## 2. 通用约定

| 项 | 值 |
|---|---|
| JSON | `Content-Type: application/json`；响应 `application/json; charset=utf-8` |
| 成员会话 | HttpOnly Cookie `fr_session`（JWT）或 `Authorization: Bearer <session>` |
| 管理员会话 | `Authorization: Bearer <session>` |
| CORS | 回显允许的 `Origin` + `Access-Control-Allow-Credentials: true`；允许头 `Content-Type, Authorization, X-FastInsight-Key`；允许方法 `GET, POST, PUT, DELETE, OPTIONS` |
| 缓存 | `Cache-Control: no-store` |
| 预检 | `OPTIONS` → `204` `{}` |
| 健康检查 | `GET /api/health` → `{ "ok": true }` |
| 错误体 | `{ "error": "中文说明" }` |
| 请求体上限 | 1 MiB，非 JSON 返回 400「请求格式无效」 |
| 未知路径 | 404「接口不存在」 |

### 2.1 两类会话

| 角色 | 如何获得 | 有效期 | 用途 |
|---|---|---|---|
| `admin` | `POST /api/admin/login` | 8 小时 | 生成 / 列出 / 删除个人 Key |
| `member` | `POST /api/content/unlock`、`GET /api/sso/launch` 或 `POST /api/sso/consume` | 8 小时 | 读自己的内容、改关注作者、登录 FastNews |

成员会话为 JWT，写入 Cookie 后可跨进程重启保持到过期；管理员会话仍在内存中，重启即失效。

### 2.2 身份对象

解锁和兑换成功时都会带上：

```json
{
  "session": "成员会话 token",
  "person": "张三",
  "keyId": "a1b2c3d4e5f6a7b8c9d0",
  "expiresAt": 1710028800000
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `session` | string | JWT。Panel 可作 Bearer；FastNews 优先用 Cookie，不要把它写进 URL。**FastRead 等有自己账号体系的模块应忽略，改发本模块登录态** |
| `person` | string | 管理员填写的显示名，最长 80 |
| `keyId` | string | 20 位 hex，撤销前稳定，下游用户主键 |
| `expiresAt` | number | 本条会话过期时间，Unix **毫秒** |

同一次成功响应还可能带内容字段（见 §6）：`recentArticles`、`insightItems`、`authors`、`customTags`。

### 2.3 个人 Key 形态

- 完整 Key：`fk_` + 32 字符 base64url，例如 `fk_0xK3v9....`
- 只在 `POST /api/admin/keys` 的响应里出现一次
- 列表接口只返回 `keyPreview`，形如 `fk_0xK3v9...ab12`
- 服务端存 SHA-256，无法反查完整 Key

---

## 3. 推荐对接方式（按模块）

```text
管理员 ──生成 Key──▶ 成员
                      │
                      ▼
              只在 Panel 输入 Key
                      │
          POST /api/content/unlock
                      │
                      ▼
              成员会话（8h）
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   FastNews      FastRead      FastWrite / FastTask
   audience      audience      预留 audience
   fast-news     fast-read     fast-write / fast-task
        │             │
        ▼             ▼
  Cookie + /me    服务端 consume
  读写 authors     按 keyId 建本模块用户
```

| 模块 | 现状 | 应该怎么登录 | 不要做什么 |
|---|---|---|---|
| FastResearch Panel | 已实现 | `unlock` 收集 Key | 不要把原始 Key 写入 `localStorage` |
| FastNews | 已实现服务端票据登录 | Panel `unlock` → `/api/sso/launch` 302 到 `{NEWS}?sso=` → **serve.py consume** → HttpOnly Cookie | 不要 `python -m http.server`；不要把票据/JWT 放进 URL；不要再要 Key |
| FastRead | 已实现 | Panel `unlock` → `/api/sso/launch` 302 到 `{READ}?sso=` → **服务端** `consume` → 本模块 Cookie | 不要用邮箱密码替代 Key 身份；不要信 `research_api`；不要在 FastRead 做 Key 输入框 |
| FastWrite / FastTask | 预留 | 与 FastRead 相同，换 `audience` | 不要各自做 Key 表单 |
| FastPPT | 直接入口 | Panel 点击后跳转配置的 URL，无 SSO | 不要把 Key 放进 URL |
| FastLab | 直接入口 | Panel 点击后跳转配置的 URL，无 SSO | 不要把 Key 放进 URL |
| FastInsight | 发布通道 | 服务号 `X-FastInsight-Key` 写入该成员的 FastInsight 信箱 | 不要用个人 Key 当发布凭证 |

`audience` 必须是下面的精确字符串（大小写敏感）：

| audience | 跳转 | 谁兑换 | 状态 |
|---|---|---|---|
| `fast-news` | `{NEWS}?sso={ticket}`（经 `/api/sso/launch` 302） | FastNews `serve.py` | **已上线** |
| `fast-read` | `{READ}?sso={ticket}`（经 `/api/sso/launch` 302） | FastRead 后端 | **已上线** |
| `fast-write` | `{WRITE}?sso={ticket}` | FastWrite 后端 | 预留 |
| `fast-task` | `{TASK}?sso={ticket}` | FastTask 后端 | 预留 |

当前服务端白名单为 `fast-news` 和 `fast-read`。其他值申请票据会 `400 不支持的登录入口`。新模块对接前由 FastResearch 把对应 audience 加进白名单，并让 Panel 点击该卡片时走「先 Key 再出票」。

---

## 4. 管理员：签发与删除 Key

下游模块一般不调这些接口。运维/联调可以用。

### 4.1 登录

```http
POST /api/admin/login
Content-Type: application/json

{ "username": "admin", "password": "admin123456" }
```

成功 `200`：

```json
{
  "session": "管理员会话",
  "username": "admin",
  "expiresAt": 1710028800000
}
```

失败 `401`：`管理员账号或密码错误`。

默认账号来自 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（首次写入 `data/access.json`）。

### 4.2 生成个人 Key

```http
POST /api/admin/keys
Authorization: Bearer <管理员会话>
Content-Type: application/json

{ "person": "张三", "expiresAt": null }
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `person` | 否 | 显示名，空则「未命名成员」，最长 80 |
| `expiresAt` | 否 | 可被 `new Date()` 解析的时间；省略或空则永不过期 |

成功 `201`（**完整 `key` 只出现这一次**）：

```json
{
  "key": "fk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "record": {
    "id": "a1b2c3d4e5f6a7b8c9d0",
    "person": "张三",
    "keyPreview": "fk_xxxxxx...xxxx",
    "createdAt": "2026-09-08T12:00:00.000Z",
    "expiresAt": null,
    "active": true
  }
}
```

新 Key 的内容库为空：`recentArticles`、`insightItems`、`followedAuthors`、`customResearchTags` 均为 `[]`。

### 4.3 列出 Key

```http
GET /api/admin/keys
Authorization: Bearer <管理员会话>
```

成功 `200`：`{ "keys": [ { id, person, keyPreview, createdAt, expiresAt, active } ] }`。不含完整 Key。

### 4.4 删除 Key

```http
DELETE /api/admin/keys/{keyId}
Authorization: Bearer <管理员会话>
```

成功 `200`：`{ "ok": true }`。该 Key 标记撤销，账号及个人内容保留，管理员列表显示 inactive。之后 unlock / 出票 / consume 均失败。不存在则 `404 个人 Key 不存在`。

### 4.5 退出

```http
POST /api/admin/logout
Authorization: Bearer <任意会话>
```

成功 `200`：`{ "ok": true }`。无会话也返回 200。

管理员接口未带会话或拿着成员会话访问 → `401 管理员登录已失效`。

---

## 5. 成员登录

有两条路，结果都是成员会话。**下游模块只走 B。**

### 5.1 A. Panel：用个人 Key 解锁

```http
POST /api/content/unlock
Content-Type: application/json

{ "key": "fk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

成功 `200`：§2.2 身份字段 + §6 内容字段。

| 状态 | error |
|---|---|
| 400 | 个人 Key 不能为空 |
| 401 | 个人 Key 无效、已撤销或已过期 |

### 5.2 B. FastNews：服务端兑换票据

**解锁后跳转（Panel，需成员会话 / Cookie）：**

```http
GET /api/sso/launch?audience=fast-news&next=http://127.0.0.1:4173/
Cookie: fr_session=<JWT>
```

成功 `302` 到 `{NEWS}?sso={ticket}`。FastNews `serve.py` 在服务端 `consume`（audience=`fast-news`）后写入 HttpOnly `fr_session`，再 302 到干净 URL。浏览器随后用同源 `GET /api/content/me`（由 serve.py 反代到 FastResearch）。直开 `:4173` 且无会话会 302 到 Panel。

| 状态 | error |
|---|---|
| 401 | 成员登录已失效 |
| 400 | 不支持的登录入口 / FastNews 地址无效 |

### 5.3 C. 下游：SSO 票据（FastRead 等）

**申请（仅 Panel，需成员会话）：**

```http
POST /api/sso/ticket
Authorization: Bearer <成员会话>
Content-Type: application/json

{ "audience": "fast-news" }
```

成功 `200`：

```json
{
  "ticket": "一次性票据",
  "expiresAt": 1710000120000,
  "apiUrl": "http://127.0.0.1:8787"
}
```

`apiUrl` 仅作兼容字段。FastNews 已不再把它放进 URL；**有后端的模块忽略它，改用自己配置的 FastResearch 地址。**

| 状态 | error |
|---|---|
| 401 | 成员登录已失效 |
| 401 | 个人 Key 无效、已撤销或已过期 |
| 400 | 不支持的登录入口 |

**兑换（下游调用，无需 Authorization）：**

```http
POST /api/sso/consume
Content-Type: application/json

{ "ticket": "<URL 参数 sso>", "audience": "fast-read" }
```

`audience` 必须与出票时相同。成功 `200`：与 unlock 相同的身份 + 内容。

服务端先删除票据再校验，因此第二次一定失败。

| 状态 | error |
|---|---|
| 401 | 登录票据无效或已过期 |
| 401 | 个人 Key 无效、已撤销或已过期 |

### 5.3 拉当前成员内容

```http
GET /api/content/me
Authorization: Bearer <成员会话>
```

成功 `200`：`{ session, expiresAt, person, keyId, recentArticles, insightItems, authors, customTags }`。

---

## 6. 按 Key 隔离的数据

每个个人 Key 一份。成员接口只读写**当前 Key**，不能指定别人的 `keyId`。

### 6.1 内容字段（unlock / consume / me）

```json
{
  "recentArticles": [
    {
      "id": "…",
      "title": "…",
      "summary": "…",
      "url": "https://…",
      "source": "FastRead",
      "direction": "系统安全",
      "receivedAt": "2026-09-08T12:00:00.000Z"
    }
  ],
  "insightItems": [ ],
  "authors": [ ],
  "customTags": ["侧信道"]
}
```

`recentArticles` / `insightItems` 每类最多保留 100 条，新的在前。

### 6.2 关注作者

```http
GET /api/content/authors
Authorization: Bearer <成员会话>

PUT /api/content/authors
Authorization: Bearer <成员会话>
Content-Type: application/json

{
  "authors": [
    {
      "id": "author-1",
      "name": "Alice",
      "homepage": "https://example.com/alice",
      "tags": ["Web 安全", "AI 安全"],
      "fetchState": "idle",
      "fetchMessage": "",
      "parsed": null
    }
  ],
  "customTags": ["侧信道"]
}
```

成功 `200`：`{ "authors": [规范化后的作者], "customTags": [规范化后的标签] }`。

规范化规则：

| 字段 | 限制 |
|---|---|
| 作者数量 | 最多 200，无 `name` 的丢弃 |
| `id` | 字符串，最长 80 |
| `name` | 最长 100 |
| `homepage` | 最长 1000 |
| `tags` | 最多 20 个，每个最长 40；会写入 `bio`（` / ` 拼接，最长 400） |
| `fetchState` | `pending` / `success` / `error` / `cancelled` / `idle` |
| `fetchMessage` | 最长 200 |
| `customTags` | 最多 40 个，每个最长 40，去重（大小写不敏感） |

无成员会话 → `401 成员登录已失效`。

### 6.3 服务端写入（FastInsight / 最近阅读）

这两条**不是**成员登录，用环境变量 `FASTINSIGHT_INGEST_KEY`。

```http
POST /api/insight/publish
POST /api/content/reading/publish
X-FastInsight-Key: <服务号密钥>
Content-Type: application/json

{
  "person": "张三",
  "item": {
    "title": "标题",
    "summary": "摘要",
    "url": "https://example.com/paper",
    "direction": "系统安全"
  }
}
```

| 字段 | 说明 |
|---|---|
| `person` | 可选。空则发给**所有有效 Key**；有值则按显示名大小写不敏感匹配 |
| `item` 或整份 body | 见下表 |

条目规范化：

| 字段 | 来源 | 限制 |
|---|---|---|
| `id` | `id` 或时间戳 | 字符串 |
| `title` | `title` / `headline`，默认「未命名内容」 | 300 |
| `summary` | `summary` / `abstract` / `trend_summary` | 1200 |
| `url` | `url` / `paper_url` | 1000，空则省略 |
| `source` | 显式 `source`，否则阅读接口为 `FastRead`、insight 为 `FastInsight` | 80 |
| `direction` | `direction` / `matched_direction` | 120 |
| `receivedAt` | `receivedAt` / `received_at`，默认现在 ISO 时间 | — |

成功 `201`：

```json
{ "ok": true, "deliveredTo": ["张三"] }
```

| 状态 | error |
|---|---|
| 401 | FastInsight 发布凭证无效 |
| 404 | 没有匹配的成员 Key |

---

## 7. 安全规则（所有模块必须遵守）

1. 禁止收集、转发、持久化原始个人 Key。
2. 禁止把 Key 或 ticket 打进访问日志。
3. ticket 用过即废，2 分钟过期，`audience` 必须一致。
4. 有后端的模块：浏览器只把 `sso` 交给**同源后端**；由后端请求 FastResearch `consume`。
5. FastResearch 地址来自服务端配置，不要信任 URL 里的 `research_api`。
6. 兑换成功后立刻从地址栏去掉 `sso`（及 `research_api`）。
7. 用 `keyId` 隔离数据；不要用 `person` 当用户主键。
8. 撤销后的 Key 不能 unlock、不能出票；未使用的旧票 consume 也会 401。

---

## 8. 示例

以下假设：

```bash
export FR=http://127.0.0.1:8787
```

Windows PowerShell 可把 `$FR` 换成 `'http://127.0.0.1:8787'`，把 `export VAR=...` 换成 `$VAR = '...'`。

### 8.1 管理员签发 Key

```bash
curl -s -X POST "$FR/api/admin/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"admin123456"}'
# → { "session": "ADMIN_SESSION", "username": "admin", "expiresAt": ... }

curl -s -X POST "$FR/api/admin/keys" \
  -H "Authorization: Bearer ADMIN_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"person":"张三"}'
# → { "key": "fk_....", "record": { "id": "KEY_ID", ... } }

curl -s "$FR/api/admin/keys" \
  -H "Authorization: Bearer ADMIN_SESSION"
```

### 8.2 Panel 解锁（仅 Panel 使用）

```bash
curl -s -X POST "$FR/api/content/unlock" \
  -H "Content-Type: application/json" \
  -d '{"key":"fk_...."}'
# → { "session": "MEMBER_SESSION", "person": "张三", "keyId": "KEY_ID", ... }
```

空 Key：

```bash
curl -s -o /dev/stderr -w "%{http_code}" -X POST "$FR/api/content/unlock" \
  -H "Content-Type: application/json" \
  -d '{"key":""}'
# 400 { "error": "个人 Key 不能为空" }
```

错误 Key：

```bash
curl -s -X POST "$FR/api/content/unlock" \
  -H "Content-Type: application/json" \
  -d '{"key":"fk_invalid"}'
# 401 { "error": "个人 Key 无效、已撤销或已过期" }
```

### 8.3 下游 SSO（各模块都走这条）

Panel 出票：

```bash
curl -s -X POST "$FR/api/sso/ticket" \
  -H "Authorization: Bearer MEMBER_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"audience":"fast-news"}'
# → { "ticket": "TICKET", "expiresAt": ..., "apiUrl": "http://127.0.0.1:8787" }
```

浏览器跳转示例：

```text
FastNews:  https://news.example/
FastRead:  https://read.example/?sso=TICKET
```

下游兑换：

```bash
curl -s -X POST "$FR/api/sso/consume" \
  -H "Content-Type: application/json" \
  -d '{"ticket":"TICKET","audience":"fast-news"}'
# → 与 unlock 相同的 JSON
```

票只能用一次：

```bash
curl -s -X POST "$FR/api/sso/consume" \
  -H "Content-Type: application/json" \
  -d '{"ticket":"TICKET","audience":"fast-news"}'
# 401 { "error": "登录票据无效或已过期" }
```

audience 不一致（用 FastNews 的票去兑 FastRead）：

```bash
curl -s -X POST "$FR/api/sso/consume" \
  -H "Content-Type: application/json" \
  -d '{"ticket":"TICKET","audience":"fast-read"}'
# 401 { "error": "登录票据无效或已过期" }
```

当前未开放的 audience：

```bash
curl -s -X POST "$FR/api/sso/ticket" \
  -H "Authorization: Bearer MEMBER_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"audience":"fast-read"}'
# 400 { "error": "不支持的登录入口" }
```

### 8.4 FastNews：读写关注作者

```bash
curl -s "$FR/api/content/authors" \
  -H "Authorization: Bearer MEMBER_SESSION"

curl -s -X PUT "$FR/api/content/authors" \
  -H "Authorization: Bearer MEMBER_SESSION" \
  -H "Content-Type: application/json" \
  -d '{
    "authors": [
      {
        "id": "alice",
        "name": "Alice",
        "homepage": "https://example.com/alice",
        "tags": ["Web 安全"]
      }
    ],
    "customTags": ["侧信道"]
  }'
```

浏览器兑换示例（仅静态站；有后端不要这样写）：

```javascript
const params = new URLSearchParams(location.search);
const ticket = params.get("sso");
const apiBase = "http://127.0.0.1:8787"; // 有后端时不要用 research_api

const payload = await fetch(`${apiBase}/api/sso/consume`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ ticket, audience: "fast-news" }),
}).then((r) => r.json());

// payload.session / payload.keyId / payload.person
```

### 8.5 FastRead / FastWrite / FastTask：服务端兑换

Python 示例（FastRead 后端）：

```python
import os, httpx

FASTRESEARCH = os.environ["FASTRESEARCH_API_URL"].rstrip("/")
AUDIENCE = "fast-read"  # FastWrite→fast-write，FastTask→fast-task

def login_from_panel(ticket: str) -> dict:
    r = httpx.post(
        f"{FASTRESEARCH}/api/sso/consume",
        json={"ticket": ticket, "audience": AUDIENCE},
        timeout=5,
    )
    data = r.json()
    if r.status_code != 200:
        raise PermissionError(data.get("error", "登录票据无效或已过期"))
    return {"key_id": data["keyId"], "person": data["person"]}
    # 随后按 key_id upsert 本模块用户，签发本模块 session cookie
```

对应前端只把 ticket 交给自己的后端：

```javascript
const ticket = new URLSearchParams(location.search).get("sso");
if (ticket) {
  await fetch("/api/auth/research", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticket }),
  });
  history.replaceState({}, "", location.pathname);
}
```

### 8.6 FastInsight 写入某成员

```bash
curl -s -X POST "$FR/api/insight/publish" \
  -H "X-FastInsight-Key: $FASTINSIGHT_INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "person": "张三",
    "item": {
      "title": "本周方向摘要",
      "summary": "…",
      "url": "https://example.com/insight",
      "direction": "系统安全",
      "authors": "Alice, Bob",
      "venue": "ICML 2026",
      "source": "FastInsight"
    }
  }'
# 201 { "ok": true, "deliveredTo": ["张三"] }
```

最近阅读（通常由 FastRead 服务端写）：

```bash
curl -s -X POST "$FR/api/content/reading/publish" \
  -H "X-FastInsight-Key: $FASTINSIGHT_INGEST_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "person": "张三",
    "item": {
      "title": "论文标题",
      "summary": "一句话",
      "url": "https://arxiv.org/abs/xxxx",
      "paper_url": "https://arxiv.org/pdf/xxxx"
    }
  }'
```

### 8.7 删除后再登录

```bash
curl -s -X DELETE "$FR/api/admin/keys/KEY_ID" \
  -H "Authorization: Bearer ADMIN_SESSION"

curl -s -X POST "$FR/api/content/unlock" \
  -H "Content-Type: application/json" \
  -d '{"key":"fk_...."}'
# 401 { "error": "个人 Key 无效、已撤销或已过期" }
```

---

## 9. 错误码一览

| 状态 | error | 何时 |
|---|---|---|
| 400 | 个人 Key 不能为空 | unlock 没带 key |
| 400 | 不支持的登录入口 | ticket 的 audience 未开放 |
| 400 | 请求格式无效 | body 不是 JSON |
| 400 | 请求内容过大 | body > 1 MiB |
| 401 | 管理员账号或密码错误 | admin login |
| 401 | 管理员登录已失效 | 管理员接口无/错会话 |
| 401 | 成员登录已失效 | 成员接口无/错会话 |
| 401 | 个人 Key 无效、已撤销或已过期 | unlock / 持有失效 Key 的会话 / consume 时 Key 已撤 |
| 401 | 登录票据无效或已过期 | consume 失败 |
| 401 | FastInsight 发布凭证无效 | 缺少或错 `X-FastInsight-Key` |
| 404 | 个人 Key 不存在 | 删除了不存在的 id |
| 404 | 没有匹配的成员 Key | 发布时 person 对不上 |
| 404 | 接口不存在 | 路径错误 |

---

## 10. 联调清单

1. 管理员登录 → 为「张三」生成 Key，完整 Key 只出现一次。
2. `unlock` 该 Key → 得到 `keyId` + `session`。
3. 用该 `session` 申请 `audience=fast-news` 票据 → 跳转 FastNews → consume 一次成功、第二次 401。
4. FastNews `PUT /api/content/authors` 后，再用同一 Key unlock，作者仍在。
5. 换另一把 Key → 作者列表为空（隔离）。
6. 票据 audience 与 consume 不一致 → 401。
7. 未开放 audience（如 `fast-write`）申请票据 → 400。
8. 删除 Key 后 unlock / 出票 / 未使用旧票 consume 均 401。
9. 有后端的模块：浏览器不直连 `/api/sso/consume`，地址栏兑换后无 `sso`。
10. FastInsight 带 `person=张三` 发布 → 只有张三的 `insightItems` 增加；错误 ingest key → 401。

---

## 11. 环境变量

| 变量 | 谁用 | 说明 |
|---|---|---|
| `PORT` | FastResearch | API 端口，默认 8787 |
| `FASTRESEARCH_PUBLIC_URL` | FastResearch | 写入 ticket 响应的 `apiUrl` |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | FastResearch | 管理员账号 |
| `FASTINSIGHT_INGEST_KEY` | FastResearch + 发布方 | 服务号写内容 |
| `FASTRESEARCH_API_URL` | FastRead 等有后端的模块 | **模块自己配置**的 FastResearch 地址，不要用查询参数 |
| `VITE_FASTPPT_URL` | Panel 前端 | FastPPT 入口，直接跳转，无 SSO |
| `VITE_FASTLAB_URL` | Panel 前端 | FastLab 入口，直接跳转，无 SSO |
| `VITE_READ_URL` / `FASTREAD_URL` | Panel / FastResearch | FastRead 入口；launch 未传 `next` 时的回退地址 |
| `FASTRESEARCH_PANEL_URL` | FastRead | 登录页「打开 FastResearch」链接 |
| `VITE_WRITE_URL` 等 | Panel 前端 | 其余模块入口 URL |

### Key 轮换

`POST /api/admin/keys/{keyId}/rotate` 使用管理员 Bearer 会话，返回一次性完整新 Key、原 keyId 和稳定 accountId。轮换提升凭证版本，使旧 Key、旧成员会话和未消费旧票据失效；个人资料不变。新 Key 清除原失效/撤销状态。成员退出现在在数据库撤销会话，不能再重用该令牌。

FastCAS 登录来源不会转换为 Key 凭证：其 `/api/sso/ticket` 返回 409，`/api/sso/launch` 仅打开已校验的目标地址，交由目标项目登录。Key 来源的旧票据链路保持兼容。
