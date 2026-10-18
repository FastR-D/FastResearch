# FastResearch SSO 接口

给新模块的交接步骤（密钥分发、/api/sso/launch、服务端兑换、FastNews / FastRead 两种会话）见 [module-handoff.md](module-handoff.md)。全量 Key 登录接口和示例见 [key-login.md](key-login.md)。本文只写 SSO 票据协议和 FastRead 落地要求。

浏览器生产路径是 Panel 打开 `GET /api/sso/launch?audience=&next=`，由 FastResearch 302 到 `{模块}?sso=`。`POST /api/sso/ticket` 只给已持有成员会话的联调脚本。个人 Key 前缀是 `fk_`，`keyId` 是 20 位 hex。CORS 回显允许的 Origin，并带 `Access-Control-Allow-Credentials: true`，不是 `*`。

对接模块：FastNews（已上线，服务端 consume + HttpOnly Cookie）、FastRead（已上线，服务端 consume）。直开 Read/News 端口会 302 到 Panel。

用户只在 FastResearch Panel 输入一次个人 Key。下游模块用一次性票据完成登录，不要再要 Key，也不要把 Key 放进 URL。

## 1. 环境

| 项 | 说明 |
|---|---|
| Base URL | `FASTRESEARCH_PUBLIC_URL`，默认 `http://127.0.0.1:8787`。必须是浏览器或对接服务能访问的 API 地址，**不要填 Vite `:5173`**。 |
| Content-Type | `application/json; charset=utf-8` |
| CORS | 回显允许的 `Origin`，并 `Access-Control-Allow-Credentials: true`。不是 `*`。允许头 `Content-Type, Authorization, X-FastInsight-Key`；允许方法 `GET, POST, PUT, DELETE, OPTIONS` |
| 缓存 | 全部接口 `Cache-Control: no-store` |
| 错误体 | `{ "error": "中文说明" }` |

成员会话：`Authorization: Bearer <session>`，有效期 8 小时。  
票据：有效期 **2 分钟**，**一次性**，audience 必须完全一致。

## 2. 身份字段

Panel 侧身份如下。下游应用请用 `accountId` 作为稳定账户主键，`keyId` 作为当前凭证记录，不要用姓名。

| 字段 | 类型 | 说明 |
|---|---|---|
| `keyId` | string | 个人 Key 的内部 ID，20 位 hex，当前凭证记录 |
| `accountId` | string | 稳定账户 ID，Key 轮换后保持不变 |
| `person` | string | 管理员填写的成员显示名，可能重名 |
| `session` | string | FastResearch 成员会话。FastNews 用来读写关注作者；FastRead **应忽略**，改发自己的登录态 |
| `expiresAt` | number | 成员会话过期时间，Unix 毫秒 |

原始 Key（`fk_…`）只在 Panel 校验。下游禁止接收、存储、转发原始 Key。

## 3. 登录流程

```text
成员在 Panel 输入个人 Key
        │
        ▼
POST /api/content/unlock          → 成员会话（8h）
        │
        ▼
点击 FastNews / FastRead
        │
        ▼
GET /api/sso/launch?audience=fast-news|fast-read|fast-task&next={模块入口}
  Cookie: fr_session=<成员 JWT>
        │
        ▼
FastResearch 302
  FastNews: {NEWS}?sso={ticket}   （serve.py 兑换后 302 到干净 URL，写入 HttpOnly Cookie）
  FastRead: {READ}?sso={ticket}   （后端兑换后写 fastread_session）
        │
        ▼
下游兑换
  POST {FastResearch}/api/sso/consume
  body: { "ticket": "<sso>", "audience": "<与申请时相同>" }
        │
        ▼
按 keyId 验证当前成员并返回 accountId，供下游映射账户；从地址栏删除 sso
```

未解锁就点需要 SSO 的入口时，Panel 先弹出 Key 框，解锁成功后再申请票据并跳转。

## 4. 接口

### 4.1 申请票据

下游模块不调用本接口。Panel 点击入口时走的是 `GET /api/sso/launch`，不是本接口。本接口留给已经持有成员 Bearer 的联调脚本。

```http
POST /api/sso/ticket
Authorization: Bearer <成员会话>
Content-Type: application/json

{ "audience": "fast-read" }
```

**请求**

| 字段 | 必填 | 说明 |
|---|---|---|
| `audience` | 是 | 见 [§5](#5-audience) |

**成功 200**

```json
{
  "ticket": "随机 base64url，约 32 字符",
  "expiresAt": 1710000120000,
  "apiUrl": "http://127.0.0.1:8787"
}
```

| 字段 | 说明 |
|---|---|
| `ticket` | 一次性登录票据，2 分钟内有效 |
| `expiresAt` | 票据过期时间，Unix 毫秒 |
| `apiUrl` | 浏览器可访问的 FastResearch API。FastNews / FastRead **都不要用这个值**，应使用自己配置的 `FASTRESEARCH_API_URL` |

**失败**

| 状态 | error | 原因 |
|---|---|---|
| 401 | 成员登录已失效 | 未带会话、过期或不是成员 |
| 401 | 个人 Key 无效、已撤销或已过期 | Key 已被撤 |
| 400 | 不支持的登录入口 | audience 不在白名单 |
| 400 | 请求格式无效 | JSON 无法解析 |

### 4.2 兑换票据

下游模块调用。FastRead 必须在**自己的服务端**调用，不要在浏览器直连 FastResearch。

```http
POST /api/sso/consume
Content-Type: application/json

{ "ticket": "<从 URL 的 sso 取出>", "audience": "fast-read" }
```

不需要 `Authorization`。

**请求**

| 字段 | 必填 | 说明 |
|---|---|---|
| `ticket` | 是 | URL 参数 `sso` 的值 |
| `audience` | 是 | 必须与申请票据时相同 |

**成功 200**

```json
{
  "session": "FastResearch成员会话",
  "person": "张三",
  "keyId": "a1b2c3d4e5f6a7b8c9d0",
  "accountId": "7f4c2a1e9b8d6c5f0011223344556677",
  "expiresAt": 1710028800000,
  "recentArticles": [],
  "insightItems": [],
  "authors": [],
  "customTags": []
}
```

FastRead 使用 `accountId`、`keyId` 和 `person` 建立本模块登录；其余字段是 Panel / FastNews 的内容，可忽略。
`session` 是 FastResearch 会话，不是 FastRead 会话；FastRead 应签发自己的 `fastread_session` Cookie。

**失败**

| 状态 | error | 原因 |
|---|---|---|
| 401 | 登录票据无效或已过期 | 票不存在、用过、过期、audience 不一致 |
| 401 | 个人 Key 无效、已撤销或已过期 | 出票后 Key 被撤 |
| 400 | 请求格式无效 | JSON 无法解析 |

实现细节：服务端读到 ticket 后立即删除，再校验是否过期、audience 是否匹配。同一张票第二次兑换一定失败。

### 4.3 相关但不属于 SSO 的接口

| 接口 | 谁用 | FastRead 是否需要 |
|---|---|---|
| `POST /api/content/unlock` `{ "key" }` | Panel | 否 |
| `GET /api/content/me` | Panel | 否 |
| `GET/PUT /api/content/authors` | FastNews | 否 |
| `POST /api/admin/login`、`/api/admin/keys` | Panel 管理员 | 否 |

## 5. audience

| 值 | 跳转 | 谁兑换 | 状态 |
|---|---|---|---|
| `fast-news` | `{VITE_FASTNEWS_URL}?sso={ticket}`（`/api/sso/launch` 302） | FastNews **serve.py** | 已上线 |
| `fast-read` | `{VITE_READ_URL}?sso={ticket}`（经 `/api/sso/launch` 302） | FastRead **后端** | 已上线 |
| `fast-task` | `{FASTTASK_PUBLIC_URL}/api/v1/auth/fastresearch/callback?state=…&sso={ticket}`（经 `/api/sso/launch` 302） | FastTask **后端**（需 `X-FastTask-SSO-Secret`） | 已上线 |

`fast-task` 兑换必须带请求头 `X-FastTask-SSO-Secret`，其值与 FastResearch 的 `FASTRESEARCH_FASTTASK_SSO_SECRET`、FastTask 的 `FASTTASK_FASTRESEARCH_SSO_SECRET` 一致，至少 32 字符。FastTask 按 `accountId` 映射本模块用户；个人 Key 不进入 FastTask。

audience 是精确字符串，不要用 `FastRead`、`read`、`fastread`。

## 6. 跳转 URL

Panel 跳转 FastRead 时只带票据：

```text
https://fastread.example/?sso=TICKET
```

| 参数 | 必填 | 说明 |
|---|---|---|
| `sso` | 是 | `/api/sso/ticket` 返回的 `ticket` |

不要带原始 Key。FastNews 和 FastRead 都只带 `sso` 票据，由各自服务端兑换后去掉查询参数。不要再把 `research_api` 放进 URL。

兑换成功后用 `history.replaceState`（或服务端 302 到无查询参数的页面）去掉 `sso`，避免票据留在历史记录和分享链接里。

## 7. FastRead 对接要求

1. 配置 `FASTRESEARCH_API_URL`（服务端环境变量），不要信任页面上的 `research_api`。
2. 前端若发现 `?sso=`，把 ticket 交给 FastRead 自己的接口（例如 `POST /api/auth/research`），不要在浏览器请求 FastResearch。
3. FastRead 后端调用 `POST {FASTRESEARCH_API_URL}/api/sso/consume`，body 为 `{ "ticket", "audience": "fast-read" }`。
4. 优先用返回的稳定 `accountId` 查找或创建本地用户与工作区；旧 ticket 没有 `accountId` 时回退到 `keyId`，`person` 仅作显示名 / 工作区名。
5. 签发 FastRead 自己的登录 Cookie（现有 `fastread_session` + csrf），不要保存 FastResearch 的 `session` 或原始 Key。
6. 同一 `accountId` 必须进入同一工作区；不同 `accountId` 必须隔离。旧 ticket 或旧数据没有 `accountId` 时按 `keyId` 兼容。
7. 无 `sso`、无 FastRead 会话时，文档请求 302 到 `FASTRESEARCH_PANEL_URL`。不要把 FastRead 当登录页，不要增加「输入个人 Key」，也不再提供邮箱密码登录。票据失败时停留在页上提示从 Panel 重新进入。
8. 票据失败时停留在登录页，提示：「Panel 登录已过期，请从 FastResearch 重新进入」。

建议的本地用户映射：

```text
users.research_account_id UNIQUE ← consume 返回的 accountId
users.research_key_id     UNIQUE ← 旧数据 / 兼容回退的 keyId
users.display_name             ← person
占位邮箱（不可密码登录）        ← key-{keyId}@sso.fastresearch.local
工作区名                       ← person
```

## 8. 安全约束

- 票据 2 分钟、一次性、绑定 audience。
- 禁止把原始 Key 放入 URL、Cookie、localStorage、日志。
- FastRead 必须服务端兑换；浏览器只把 `sso` 交给同源后端。
- FastRead 的 FastResearch 地址必须来自服务端配置，不能来自查询参数。
- 不要打印完整 ticket。
- 已撤销的 Key 不能再出票；若出票后、兑换前被撤销，`consume` 返回 401。

## 9. 示例

申请票据（Panel）：

```bash
curl -s -X POST "$FASTRESEARCH/api/sso/ticket" \
  -H "Authorization: Bearer $MEMBER_SESSION" \
  -H "Content-Type: application/json" \
  -d '{"audience":"fast-read"}'
```

兑换票据（FastRead 服务端）：

```bash
curl -s -X POST "$FASTRESEARCH/api/sso/consume" \
  -H "Content-Type: application/json" \
  -d '{"ticket":"REPLACE","audience":"fast-read"}'
```

错误响应示例：

```json
{ "error": "登录票据无效或已过期" }
```

## 10. 联调清单

1. 有效成员会话 + `audience=fast-read` → 200，得到 ticket。
2. 立刻 consume，audience 相同 → 200，得到同一 `accountId` / `keyId` / `person`。
3. 同一 ticket 再 consume → 401。
4. audience 写成 `fast-news` 去兑 FastRead 票 → 401。
5. 超过 2 分钟再兑 → 401。
6. 撤销 Key 后无法再出票；已发出未使用的票 consume 也是 401。
7. 无会话申请 ticket → 401。
8. FastRead 兑换成功后地址栏不再包含 `sso`。
9. 同一账户（`accountId`）使用当前或轮换后的 Key 进入 FastRead → 同一工作区。
10. 直开 FastRead / FastNews（无 sso / 无会话）→ 302 到 FastResearch Panel，不展示产品内容。
