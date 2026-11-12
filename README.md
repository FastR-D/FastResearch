# FastResearch

FastRD 的科研工作台与应用入口。React 前端（独立 npm workspace）和 Go 后端独立组织；生产运行只需要 Go 编译后的程序与前端静态文件。

## 目录

```text
cmd/fastresearch/       服务入口、启动与退出、任务回传 worker
internal/
  config/              环境变量与配置验证
  identity/            FastCAS OIDC、加密令牌、角色复核、退出通知
  store/               SQLite 账号、资料、会话与旧数据导入
  workflow/            流水线、幂等操作、持久 outbox
  integrations/        FastRD 应用目录与服务身份客户端
  httpapi/             HTTP 路由、权限、静态文件与网关
web/
  src/app/             前端入口与页面路由
  src/pages/promo/     公开产品介绍与滚动交互
  src/features/        workspace、auth、admin、today、team、insight
  src/shared/          HTTP 客户端、领域类型、文案、组件、工具
  src/styles/          公共、宣传页和工作台样式
  public/              静态资源
contracts/             跨项目接口契约
scripts/               浏览器验收与本地部署
deployments/           systemd 与 FastDeploy Go 部署配置
```

宣传页和工作台按路由分别加载。前端各业务视图独立维护，统一通过 `shared/api/client.ts` 访问 API；认证恢复在 `features/auth/use-identity.ts`。参考 FastNews 的 Go 目录布局与 FastWrite 的 FastCAS 浏览器绑定、持久事务和注册政策隔离方式。

## 登录和权限

- 统一使用 FastCAS 已有账号登录。账号创建、邀请、注册政策和账号停用由 FastCAS 管理员负责。
- 本项目不提供自行注册、独立管理员密码或浏览器提交角色的入口。所有本地注册接口返回 `403`；普通用户不能创建账号。
- 已验证的 FastCAS 身份首次登录时建立本地科研资料，身份主键为 `issuer + client_id + subject`。这不会创建 FastCAS 账号，也不会按姓名或邮箱合并旧资料。
- FastCAS `role=admin` 对应本站管理员。每次管理 API 请求都读取中心 UserInfo，角色降级立即失去管理权限；中心不可用时管理操作拒绝执行。普通会话最多缓存一分钟的中心验证结果。
- 生产会话使用 `__Host-fr_session`：HTTPS、仅当前主机、Path=/，避免旧 `.fastrd.io` 同名 Cookie 遮蔽新会话。会话由 HttpOnly、SameSite=Lax Cookie 引用。浏览器不持久保存会话令牌；中心访问令牌和刷新令牌加密存储，密钥位于数据目录的 `session-vault.key`。
- 已有显式绑定与旧账号内容会迁移，迁移后需要重新登录。无绑定旧账号不会被同名新身份自动接管。
- 原成员 Key 登录默认保留，可用 `FASTRESEARCH_ALLOW_LEGACY_KEY_LOGIN=false` 显式关闭；Key 永远不能授予管理员权限。旧 SSO 票据停用，应用入口使用子应用自己的 FastCAS 登录。

**FastCAS 配套要求：** UserInfo 在 `profile` scope 下必须返回中心当前 `role`。本次已修改同级 FastCAS 的 `internal/core/tokens.go` 并增加测试；可分发补丁见 [fastcas-role-claim.patch](docs/integrations/fastcas-role-claim.patch)。先发布该改动，再发布本项目；缺少角色声明的身份按普通成员处理。

## 开发

需要 Go 1.26.8、C 编译器（SQLite 驱动使用 CGO）、Node 24 和 npm。Node 只用于前端构建与开发。

```bash
cp .env.example .env
# 在 .env 填入 FastCAS 的四项连接配置
npm ci
npm run build
npm run server
```

服务默认监听 `127.0.0.1:8787`，同时提供 `dist/` 与 `/api/*`。前端开发另开终端执行 `npm run dev`，访问 `http://127.0.0.1:5173`，API 代理到 `8787`。

在 FastCAS 登记保密客户端，允许 `authorization_code`，开放 `openid profile email`，精确回调地址为：

```text
http://127.0.0.1:8787/api/auth/fastcas/callback
```

默认不申请 `offline_access`，兼容仅开放标准登录权限的现有客户端。只有中心客户端同时允许 `offline_access` 与 `refresh_token` 后，才设置 `FASTRESEARCH_FASTCAS_OFFLINE_ACCESS=true` 启用长期刷新。未取得刷新令牌时，本站 CAS 会话有效期不超过中心访问令牌；到期后重新走 CAS 登录。

本地 HTTP 开发需显式配置 `FASTRESEARCH_FASTCAS_ALLOW_LOOPBACK_HTTP=true`；生产使用 HTTPS。`.env` 按 `.env.production`、`.env`、`.env.local` 顺序补充未设置变量，进程环境优先。

## 验证

```bash
npm test
npm run lint
npm run build
go test -race ./cmd/... ./internal/...
```

Go 测试使用本地签名 OIDC 提供方覆盖登录回调、浏览器绑定、回调重放、管理员同步与降级、禁止注册、跨站请求、会话退出、稳定身份迁移、工序顺序和幂等 outbox。

启动构建后的服务后，可执行：

```bash
FASTRESEARCH_CHECK_URL=http://127.0.0.1:8787 npm run test:fastui
PROMO_CHECK_URL=http://127.0.0.1:8787/ npm run test:promo
PROMO_CHECK_URL=http://127.0.0.1:8787/ npm run test:journey
```

浏览器脚本默认使用 `/usr/bin/google-chrome`，可通过 `EDGE_PATH` 指定 Chromium。

## 部署

```bash
npm ci
npm run build
cp .env.production.example .env.production
# 填入中心客户端密钥、公开 URL 和服务身份配置
npm start
```

或使用 `docker compose up --build -d`。容器通过 `.env.production` 读取运行配置；前端公开地址由 Compose build args 提供。systemd 示例在 [deployments/fastresearch.service](deployments/fastresearch.service)。

CI 构建并打包 `bin/fastresearch` 和 `dist/`，使用 [Go FastDeploy 配置](deployments/fastdeploy-profile.json) 替换旧 Node 启动配置。保留原有 tag 触发部署与回滚流程；推送版本 tag 将触发生产部署流水线。

升级前备份整个数据目录，包含 `accounts.sqlite`、`workflows.sqlite`、WAL 文件和 `session-vault.key`。迁移只在现有 SQLite 中新增 `fr_*` 表，不修改旧表或 `access.json`。参见 [Go 迁移说明](docs/go-migration.md)。

## FastRD 互通

应用启动 URL 来自服务端配置，用户参数不能选择任意跳转源，也不会携带 Research 会话。已保留 FastNews、FastRead、FastWrite、FastTask、FastPPT 和 FastLab 的入口配置。

FastTask 今日计划使用独立服务身份和 `integrations:fastresearch` scope。服务投递必须校验签名、受众、scope、中心 active 状态和明确收件账号白名单。工作流仍使用原 `workflows.sqlite`，完成工序与待回传事件同事务提交。

FastTask 写入、进度回传和 FastWrite 项目 API 的可用性取决于目标项目实现及服务权限配置；目标服务未提供接口时返回错误，不假报成功。真实生产 FastCAS / FastTask / FastWrite 联调仍需在部署环境验收。若要让受保护的预览子域共用 Research 管理会话，需显式配置 `FASTRESEARCH_COOKIE_DOMAIN=.fastrd.io`；默认 Cookie 只属于主站。旧协议与历史联调记录位于 `docs/`，旧 Node 实现已删除，相关源码可在 Git 历史查阅。

Read / News / Write 个人动态、服务权限与开通入口配置见 [workspace-activity.md](docs/integrations/workspace-activity.md)。原 Key 登录默认保留；没有已验证 CAS 绑定的 Key 不会按姓名或邮箱查找子应用账号。

`npm run test:activity` 会启动隔离的临时 Go 服务，验证真实 Key 登录，并模拟三种子应用动态状态；需先完成 `npm run build`。
