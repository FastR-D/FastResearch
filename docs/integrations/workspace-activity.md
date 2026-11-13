# Read / News / Write 个人动态

工作台按当前已认证账号读取 `GET /api/workspace/apps/{fast-read|fast-news|fast-write}/activity`，前端不能指定收件人。CAS 登录使用会话 subject；Key 登录仅使用已存在且经中心确认的 Research 绑定，没有绑定时提示使用关联 CAS 账号。不会按邮箱、姓名匹配账号。

| 应用 | 指标 | 动态 |
| --- | --- | --- |
| Read | 所属工作区未归档论文、报告版本、笔记、本人待处理任务 | 最近入库论文、生成报告、笔记更新、失败或待处理任务 |
| News | 本人未读订阅、已收录论文、研究简报 | 本人未读订阅、按日期排序的新收录论文、最新简报 |
| Write | 本人未读评论、未读提及、实际参与项目 | 当前仍有文件读取权限的评论/提及、最近项目更新 |

News 的语料收录数不是个人未读论文数；Read 的入库时间不是阅读记录。Write 不因平台管理员身份枚举其他人的项目。每次读取最多八个指标、八条动态，不返回正文、笔记内容、评论内容、邮箱、凭证；不改变已读状态、不创建账号。

## 子应用接口

Read、News、Write、Task 后端均提供 `POST /api/integrations/fastresearch/workspace`，请求 JSON 仅接受 `{"subject":"CAS subject"}`。仅供服务端调用。需要 FastCAS 签名服务 access token，`sub=client_id=fastresearch`、`service=true`、scope `workspace:read`、aud 包含接收应用配置的 CAS client ID。还会进行中心 introspection、校验 issuer/client/subject 的本地绑定和中心绑定 ID、状态、版本；停用账号、撤销绑定不会返回个人动态。

成功响应示例：

```json
{"schemaVersion":"fastresearch.workspace.v1","appId":"fast-write","accountState":"active","updatedAt":"2026-11-12T00:00:00Z","metrics":[{"id":"comments","label":"未读评论","value":2}],"items":[{"id":"notification-id","kind":"comment","title":"论文讨论有更新","description":"项目有新评论","path":"/projects/project-id","occurredAt":"2026-11-12T00:00:00Z"}]}
```

`missing` 表示没有此 issuer/client/subject 绑定，`inactive` 表示账号或绑定已停用，均不含指标和动态。验证失败返回 401/403，中心或数据源不可用返回 503。Research 聚合层将故障显示为 `unavailable`，不显示注册按钮；只有确实 `missing` 才展示注册/开通入口。应用没有配置服务身份时为 `not_configured`，Key 无映射时为 `requires_cas`。

子应用只返回以 `/` 开头的相对链接；Research 校验协议和大小后转为配置的应用公开地址，浏览器不会收到服务令牌。聚合及子应用响应均禁止缓存。工作台仅拉取当前选中应用，页面可见时每分钟刷新，切换账号或应用会取消旧请求。

## 部署配置

Research 使用 `FASTNEWS_URL`、`FASTREAD_URL`、`FASTWRITE_URL` 访问后端；`FASTNEWS_PUBLIC_URL`、`FASTREAD_PUBLIC_URL`、`FASTWRITE_PUBLIC_URL` 配置浏览器入口，内外地址可不同。可选 `FASTNEWS_REGISTER_URL`、`FASTREAD_REGISTER_URL`、`FASTWRITE_REGISTER_URL` 覆盖开通入口。Read 默认 `/?auth=register`、News 默认 `/login?mode=register`，保留邀请码要求；Write 默认通过 FastCAS 登录开通，遵守 Write 自身策略。Research 不提供自行注册。

独立配置服务凭证（需三项同时填写）：

```dotenv
FASTRESEARCH_WORKSPACE_SERVICE_ISSUER=https://cas.fastrd.io
FASTRESEARCH_WORKSPACE_SERVICE_CLIENT_ID=fastresearch
FASTRESEARCH_WORKSPACE_SERVICE_CLIENT_SECRET=<通过部署 secret 注入>
FASTRESEARCH_WORKSPACE_SERVICE_ALLOW_LOOPBACK_HTTP=false
```

未配置时复用已配置的 Write、其次 Task 的 OAuth 服务身份；请求失败不回退个人 Key 或共享 API Key。专用凭证仍须属于 `fastresearch`。

## FastCAS 权限

由中心管理员在“应用权限”中修改服务身份 `fastresearch` 的 capabilities，保留已有 scope 和 resources，新增 scope `workspace:read`，新增资源受众 **子应用实际配置的 CAS client ID**（当前示例 `fastread`、`news`、`fastwrite`、`fasttask`；Task 还需满足其 `FASTCAS_SERVICE_AUDIENCE` 配置）。不要写成 `*-api`：接收应用的 introspection 要求自身 client ID 在令牌 aud 中。服务身份仍只允许 `client_credentials`，不可增加交互登录权限。

对应 API 为 `POST /api/v1/admin/applications/fastresearch/capabilities`，要求近期 MFA、同源与 CSRF。请求字段是 `grant_types`、`scopes`、`resources`，应提交原值与新增值的并集。不要重新登记或轮换现有客户端来覆盖权限。部署代码不会自动扩大中心授权，也不含中心数据库或管理员凭证。

完成授权后，以服务身份请求 `/oauth/token` 的 `workspace:read` scope，逐个调用各应用摘要端点：已有绑定返回 active，未绑定返回 missing，撤销服务令牌返回 401/403。再在实际工作台检查三张个人动态面板。缺少中心权限时，工作台会明确显示不可用，不伪造动态。

## 通用任务能力

`GET /api/workspace/apps` 的每项含 `capabilities`，动态应用声明 `activity`，提供今日计划的应用再声明 `tasks`。工作台按能力选择应用，不维护 FastTask 专用读取、创建或票据登录接口。任务详情也从同一个 `/api/workspace/apps/{id}/activity` 响应取得。

统一摘要协议保持 `fastresearch.workspace.v1`，活动应用可附加通用 `tasks` 字段：

```json
{"schemaVersion":"fastresearch.workspace.v1","appId":"fast-task","accountState":"active","metrics":[{"id":"total","label":"今日任务","value":1}],"items":[],"tasks":{"received":true,"date":"2026-11-13","timezone":"Asia/Shanghai","items":[{"id":"task-1","title":"阅读证据","status":"planned","minimumAction":"打开摘要","targetMinutes":20}],"progress":{"total":1,"completed":0,"inProgress":0,"planned":1,"skipped":0}}}
```

摘要只接受当前登录会话的已验证 CAS subject；浏览器传入的 subject、user_id 或 receiver_ref 均不能选择他人账号。接收端必须通过服务 JWT、中心 introspection 与当前本地/中心 CAS 绑定版本验证。未关联返回 `missing`，失效返回 `inactive`，故障返回错误，不能伪装成空任务。非 active 响应中的指标、动态和任务会被 Research 清除。单次最多八个指标、八条动态、五十条任务，进度总数必须一致。

FastTask 本次配套实现与其他应用相同的 `/api/integrations/fastresearch/workspace`，以 CAS 绑定读取真实今日计划，完全不依赖旧 `fastresearch_accounts` 映射。部署时需同步发布 FastTask，并在中心已授权服务身份上保留原权限、增加 `workspace:read` 和 Task 实际 client ID / 服务 audience；不自动扩大权限或回退共享 Key。旧 Task 接收端的历史 today 接口仅留给其旧调用方，Research 已不使用。

服务身份按 `<应用前缀>_SERVICE_*` 配置（例如 `FASTTASK_SERVICE_*`），未单独设置时复用 `FASTRESEARCH_WORKSPACE_SERVICE_*`，其次已有 Write/其他应用服务身份；显式设置 `<应用前缀>_SERVICE_ENABLED=false` 则关闭该联动。请求被拒绝时不换身份重试。服务地址优先 `<前缀>_URL`，其次 `<前缀>_PUBLIC_URL` 和应用目录公开地址。少数应用可用 `<前缀>_WORKSPACE_PATH` 覆盖已登记的相对摘要路径，默认统一路径不变。

团队 API 只复用任务摘要，不向其他成员公开文档或评论动态。请求最多处理 200 个成员，最多四个并发，总超时五秒。入口仍统一使用 `/api/workspace/apps/{id}/launch`，子应用自行完成 CAS 登录。
