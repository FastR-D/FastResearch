> 历史文档：Node 时代的实现和验收记录。旧实现与脚本已移除，源码仅保留在 Git 历史中。当前结构、认证政策与启动方式以 [README](../README.md) 和 [Go 迁移说明](go-migration.md) 为准。

# 可选 FastCAS 接入（联调阶段）

原 Key 登录、管理员开户及 Research SSO 保留。登录页增加 FastCAS 登录，成员账号设置增加认证、待完成关系重试与解绑。绑定/解绑要求有效当前项目会话及原 Key；不按姓名或邮箱关联账号。CAS 登录仅进入已有有效绑定，沿用稳定 accountId 和个人内容。

四项配置必须一起提供：`FASTRESEARCH_FASTCAS_ISSUER`、`FASTRESEARCH_FASTCAS_CLIENT_ID`、`FASTRESEARCH_FASTCAS_CLIENT_SECRET`、`FASTRESEARCH_FASTCAS_REDIRECT_URI`。回调为本实例 `/api/auth/fastcas/callback`；scope 为 `openid profile email`；事件端点为 `/api/auth/fastcas/events`。开发环回 HTTP 可设置 `FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP=true`。未配置时不导入 SDK，不访问 FastCAS。

SDK 使用正式发行包 `@fastrd/fastcas@0.1.2`，由根 package.json 与 package-lock.json 精确锁定。从本仓根目录执行 `npm ci --no-audit --no-fund`，随后 `npm run build`（TypeScript + Vite）；安装与生产构建均不需要相邻 FastCAS checkout 或预构建 SDK。

FastCAS 认证操作要求页面 Origin 与回调 Origin 完全一致；部署采用前端/API 同源。回调仅接收发起浏览器的 HttpOnly 绑定 Cookie 和原项目会话 Cookie，使用 SDK 的 state/nonce/PKCE 验证。登录结果通过 HttpOnly 项目会话返回，前端经既有 `/api/content/me` 恢复项目会话，不接收上游 token。

绑定关系和一次性事务持久化。撤销事件只接受最大 64 KiB `application/jwt`，先 SDK 验签，再原子更新映射、会话和去重记录。CAS 会话每五分钟复核绑定；无法确认时拒绝该来源，本地 Key 入口仍可用。解除认证只撤销该绑定的 CAS 来源会话。本地 Key 撤销不会直接删除账号或 CAS 身份。

API 前缀 `/api/auth/fastcas`：GET `available/login/callback/status`；POST `link/reconcile/revoke/events`。link/revoke 的 JSON body 为 `{key}`。

容器仅使用本仓上下文：`docker build -t fastresearch .`。Dockerfile 的 `npm ci` 安装同一 registry 锁，运行层直接复制已安装的 node_modules；不再需要 SDK named context。Compose 同样只用 `context: .`：部署前准备 `.env.production` 后执行 `docker compose build fastresearch`。镜像实构结果与宿主 Docker daemon 阻碍见根实施记录；不能用宿主 npm 构建成功代替镜像验收。

验证现状：`node --test server/*.test.mjs` 7 项通过，涵盖原服务真实 HTTP 生命周期、关闭 CAS 的接口、迁移和服务层。完整前端类型检查及生产构建通过；真实 Go/PostgreSQL 提供方 → Node SDK → FastResearch HTTP 服务联调已通过。新增真实 Chrome 移动端契约：项目页面 Key 登录、显式绑定、原生 FastCAS 授权确认和回调、独立浏览器 FastCAS 登录均回到同一账号及研究笔记；浏览器解绑后 CAS 会话失效而 Key 会话与内容可用，同时修复登录后页头横向溢出。FastCAS 登录页的 CSP 现允许本次已登记的精确回调源，浏览器跨端口自动跳转在 race 模式连续三次通过；生产域名流程仍待验收。全局退出和身份停用的标准退出通知已通过真实跨进程投递。


真实联调命令（FastCAS 根目录）：`FASTCAS_PROJECT_CONTRACT=1 go test ./internal/httpapi -run '^TestFastResearchAgainstProvider$' -count=1 -v`。需要测试 PostgreSQL、已安装 npm 依赖、Node 22 和带 HTTPX 的 Python。测试创建隔离 Research 数据目录与临时端口，退出时清理子进程；覆盖同名不合并、错误 Origin/Key 拒绝、绑定保留原会话、CAS 登录保留 accountId/内容、回调重放、旧 Key SSO、解绑来源隔离。

认证来源边界：Key 登录继续出票和消费旧 SSO 票据。CAS 登录不能经旧票据转换成独立 Key 会话，`/api/sso/ticket` 对 CAS 来源返回 409；门户 `/api/sso/launch` 直接打开目标项目，不附旧票据，由目标项目发起可选 CAS 登录。门户当前 CAS 会话保持原来源。这避免绕过撤销，也避免下游将 CAS 登录误认为原 Key 的近期证明。

FastInsight 可选服务令牌投递另用三项配置：`FASTRESEARCH_FASTCAS_INGEST_ISSUER`、`FASTRESEARCH_FASTCAS_INGEST_CLIENT_ID`、`FASTRESEARCH_FASTCAS_INGEST_ALLOWED_ACCOUNT_IDS`。三项须同时存在；最后一项是允许接收的本地稳定 account ID 列表。`/api/insight/publish` 收到 Bearer 时要求 FastCAS 签名令牌、`research-api` audience、`insight:publish` scope、服务客户端身份及 body 中明确的 `receiver_ref`，只投递给唯一匹配的本地账号；不会按同名广播。服务投递的内容记录 `publisherClientId`，由服务端填入，便于追溯客户端。原 `X-FastInsight-Key` 路径仍独立可用，两种凭证同请求会拒绝。FastInsight 令牌有效期内，停用客户端需等短期令牌过期；收件人白名单可随 Research 重启立即收紧。真实提供方联调命令：`FASTCAS_PROJECT_CONTRACT=1 go test ./internal/httpapi -run '^TestFastInsightAgainstProvider$' -count=1 -v`。

FastCAS 应用登记还需设置 `backchannel_logout_uri` 为 `/api/auth/fastcas/backchannel-logout`。接收端验证标准签名 `logout_token`，按身份及可选 sid 原子去重，只撤销 FastCAS 来源会话；项目本地登录、账号、内容和权限保持独立。

`events_uri` 同时接收签名 `identity.status_changed` 通知。中心停用只终止对应 FastCAS 来源会话，重新启用不恢复旧会话；Research Key 登录及原有内容不受影响。真实提供方到 FastResearch 接收端的状态事件契约已通过。

FastNews 可选跨项目读取使用 `GET /api/connectors/news/profile`。该端点只接受 FastCAS 签名且 audience 为 `research-api`、scope 为 `research:read`、`act.sub` 与 `client_id` 均为 `news` 的用户委托令牌；同时向中心 introspection 确认未撤销，并复核 Research 本地绑定。只返回关注作者、研究印象、收件箱，不能写入或获得 Research 会话。Key 登录与原 SSO 路径保持独立。三进程真实联调命令：`FASTCAS_PROJECT_CONTRACT=1 go test ./internal/httpapi -run '^TestFastNewsResearchDelegationAgainstProvider$' -count=1 -v`。

## 独立启停开关（2026-11-11）

四项连接配置完整时默认启用，未配置时保留原有入口且不访问中心。可显式设置：

| 环境变量 | 默认 | 行为 |
| --- | --- | --- |
| `FASTRESEARCH_FASTCAS_ENABLED` | `true`（仍需完整连接配置） | `false` 时完全关闭可选 FastCAS provider，允许保留未填完的配置 |
| `FASTRESEARCH_FASTCAS_LOGIN_ENABLED` | `true` | `false` 时隐藏并拒绝新的 FastCAS 登录，阻断已发起登录的回调签发会话 |
| `FASTRESEARCH_FASTCAS_LINK_ENABLED` | `true` | `false` 时拒绝新的已有账号绑定及 pending 激活，仍允许查询和撤销已有关系 |

使用字面量 `false` 关闭。两个分项开关不会阻断签名事件、来源会话撤销或原本地登录，也不改变账号和业务数据；全局关闭时 CAS 来源会话在项目原有有效性检查边界失效。保留独立的本地恢复方式后再关闭中心登录。

发布依赖基线更新为 FastCAS SDK **0.1.2**：使用正式 npm/PyPI 包或 Go 模块标签，不再依赖同级 FastCAS 源码目录。开发者修改 SDK 时可自行使用本地 override；生产锁文件固定已验收版本。

构建后运行 `node scripts/fastcas-mode-browser.mjs /path/to/chromium /path/to/evidence`，可验证真实发布 SDK → 临时协议 issuer → Research HTTP/SQLite → 浏览器的登录、绑定、撤销和独立模式。该场景校验 Basic 客户端凭证、PKCE、签名 ID token、userinfo 与 account-link endpoint，覆盖 pending 关系在 link 关闭时拒绝激活，以及 Key 会话和内容保留；结果清单写入 evidence 目录。临时 issuer 是外部协议 fixture，本次运行不等同于真实 Go/PostgreSQL 中心验收。合并验证的实际命令与环境限制见工作区根 `INTEGRATION-fast-research.md`。
