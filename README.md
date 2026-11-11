# FastResearch

科研工作流协调服务，统一管理 FastRead、FastWrite、FastNews 等模块的工作流程。

前端根地址默认进入 `/intro` 宣传页；研究工作台位于 `/workspace`。

## 功能特性

- **个人密钥工作区**: 为每个成员分配独立密钥，管理阅读脉络、关注作者、研究标签
- **FastInsight 收件箱**: 接收每日论文推送、研究信号，支持标记已读
- **SSO 单点登录**: 集成 FastCAS 统一身份，一次登录访问所有模块
- **工作流引擎**: 管理跨模块的研究流水线，顺序执行各环节任务
- **FastTask 集成**: 接收 FastTask 发布的任务流水线，自动追踪完成进度

## 快速开始

### 环境要求

- Node.js 22.13+（使用内置 SQLite 模块）
- npm 或 pnpm

### 安装与启动

```bash
# 克隆仓库
git clone <repo-url>
cd FastResearch

# 安装依赖
npm install

# 配置环境变量（可选）
cp .env.example .env

# 启动服务
npm run server

# 开发模式（前端 + 后端）
npm run dev
```

### 环境变量

在 `.env` 或 `.env.local` 中配置：

首次启动建立 SQLite 账号库；已有 `data/access.json` 将经过校验和备份后迁移。参见 [账号迁移与回滚](docs/account-migration.md)。默认管理员账号为 `admin`，默认密码为 `admin123456`。生产环境请通过 `ADMIN_USERNAME`、`ADMIN_PASSWORD` 和 `FASTINSIGHT_INGEST_KEY` 环境变量设置凭证。

```bash
# 服务端口
PORT=8787

# 数据目录
FASTRESEARCH_DATA_DIR=data

# FastInsight 自动分发名册
FASTINSIGHT_ROSTER=../fastinsight/assets/colleagues.yaml

# 公共访问地址
FASTRESEARCH_PUBLIC_URL=http://127.0.0.1:8787

# FastCAS 单点登录
FASTCAS_ISSUER=https://fastcas.example.com
FASTCAS_CLIENT_ID=fastresearch
FASTCAS_CLIENT_SECRET=your-client-secret

# 模块地址
FASTREAD_URL=http://127.0.0.1:3015
FASTNEWS_URL=http://127.0.0.1:4173

# Cookie 配置
# 成员登录态保存在 data/accounts.sqlite，由 HttpOnly Cookie 引用。
# 部署在 fastrd.io 时建议设为 .fastrd.io，保证裸域和 www 共用登录态；
# 留空时服务会按请求 Host 自动推断（www.fastrd.io -> .fastrd.io）。
FASTRESEARCH_COOKIE_NAME=fr_session
FASTRESEARCH_COOKIE_DOMAIN=
FASTRESEARCH_COOKIE_SAMESITE=Lax

# CORS 额外来源（逗号分隔）
FASTRESEARCH_CORS_ORIGINS=
```

## API 文档

### FastInsight 分发名册

- `GET /api/admin/fastinsight/roster` - 管理员读取 `colleagues.yaml`、版本号与文件名
- `PUT /api/admin/fastinsight/roster` - 校验并原子保存研究领域、关键词、分发人物和默认负责人；提交旧版本号会返回 `409`

### 成员认证

- `POST /api/auth/login-key` - 个人密钥登录
- `GET /api/fastcas/authorize` - 启动 FastCAS SSO 登录
- `GET /api/fastcas/callback` - FastCAS 回调处理
- `POST /api/auth/logout` - 登出

### 个人工作区

- `GET /api/member` - 获取成员信息（关注作者、研究标签、收件箱）
- `POST /api/inbox` - 标记收件箱已读
- `PUT /api/authors` - 更新关注作者
- `PUT /api/tags` - 更新研究标签
- `PUT /api/impression` - 更新研究印象

### 工作流（旧版，兼容保留）

- `GET /api/workflow` - 获取当前工作流
- `POST /api/workflow` - 创建/更新工作流
- `POST /api/workflow/complete` - 完成当前工序
- `GET /api/workflow/team` - 团队工作流视图

### 工作流（新版，FastTask 集成）

- `POST /api/workflow/publish` - 接收工作流发布（支持新旧协议）
- `GET /api/workflows` - 查询流水线列表（活跃、待开始、已完成）
- `GET /api/workflows/{id}` - 获取流水线详情
- `POST /api/workflows/{id}/start` - 启动流水线
- `POST /api/workflows/{id}/stages/{stage_id}/complete` - 完成工序

### 管理接口

- `GET /api/admin/stats` - 系统统计信息
- `POST /api/admin/migrate-key` - 密钥迁移
- `POST /api/admin/rotate-key` - 密钥轮换

### 服务集成

FastTask 可使用 `FASTTASK_INGEST_KEY` 配置专用 `X-FastTask-Key` 发布凭证；该凭证只用于工作流发布，不影响 FastInsight 的 `FASTINSIGHT_INGEST_KEY`。

Research 已预留工序完成证据的 outbox 和 `/api/v1/integrations/fastresearch/progress` 客户端，使用稳定 `event_id` 重试；当前 Task 接收端仅有 `/today`，尚未实现 progress/tasks/accounts。部署时不能把这些预留调用视为已可用的跨产品能力，today 的独立服务身份也不授权这些写操作。

- `POST /api/content/reading/publish` - FastRead 推送阅读记录
- `POST /api/insight/publish` - FastInsight 推送研究信号
- `POST /api/fastinsight/case` - FastInsight 一键到达：发布论文名称与论文地址

详细 API 文档见 [docs/api.md](docs/api.md)

## FastTask 集成

FastResearch 实现了与 FastTask 的任务流水线集成，支持接收 FastTask 发布的研究任务，追踪工序完成进度，并回传完成事件。

### 集成架构

```
FastTask                    FastResearch                各业务模块
   │                             │                          │
   │  发布任务流水线              │                          │
   ├──────────────────────────────>                         │
   │  (dispatch payload)          │                          │
   │                              │                          │
   │  返回接收回执                 │                          │
   <──────────────────────────────┤                          │
   │                              │                          │
   │                              │  用户启动流水线           │
   │                              ├─────────────────────────>│
   │                              │                          │
   │                              │  用户完成工序             │
   │                              <─────────────────────────┤
   │                              │                          │
   │  接收完成事件                 │                          │
   <──────────────────────────────┤                          │
   │  (stage completion)          │                          │
```

### 发布协议

FastTask 使用 `fasttask-dispatch-v1` 协议版本发布任务：

```json
{
  "schema_version": "fasttask-dispatch-v1",
  "dispatch_id": "dispatch-001",
  "dispatch_revision": 1,
  "receiver_ref": "account-123",
  "title": "研究任务标题",
  "description": "任务描述",
  "task_id": "task-001",
  "task_revision": 1,
  "stages": [
    {
      "stage_id": "stage-1",
      "module": "fast-read",
      "title": "阅读论文",
      "description": "阅读相关文献",
      "success_criteria": "完成精读并标注",
      "completion_target": "record_progress"
    }
  ]
}
```

### 支持的模块

- `fast-read` - FastRead 阅读与检索
- `fast-write` - FastWrite 写作工作区
- `fast-news` - FastNews 资讯跟踪

### FastTask Key 登录

个人 Key 是 FastResearch 与 FastTask 之间唯一的用户凭证。已登录成员点击页面上的「打开 FastTask」会经 `/api/fasttask/login` 跳转到 FastTask 登录入口；FastTask 校验 `state` 后把浏览器送回 FastResearch，FastResearch 再出一次性票据（`audience=fast-task`）并 302 到 FastTask 回调。FastTask 服务端用共享密钥兑换票据，按稳定的 `accountId` 创建或复用本模块用户，原始个人 Key 不会离开 FastResearch。

需要在两边配置：

| 变量 | 配置位置 | 说明 |
|---|---|---|
| `FASTTASK_PUBLIC_URL` | FastResearch | 浏览器访问 FastTask 的公开地址 |
| `FASTRESEARCH_FASTTASK_SSO_SECRET` | FastResearch | 至少 32 字符，与 FastTask 侧一致 |
| `FASTTASK_FASTRESEARCH_LOGIN_ENABLED` | FastTask | 设为 `true` 启用 Key 登录 |
| `FASTTASK_FASTRESEARCH_URL` | FastTask | FastTask 服务端访问 FastResearch 的地址 |
| `FASTTASK_FASTRESEARCH_PUBLIC_URL` | FastTask | 浏览器访问 FastResearch 的公开地址 |
| `FASTTASK_FASTRESEARCH_SSO_SECRET` | FastTask | 与 FastResearch 侧一致 |

FastResearch 工作台通过 `GET /api/fasttask/today` 展示当前成员在 FastTask 的当天任务，`GET /api/workflow/team` 同时返回每位成员当天的 FastTask 任务进度。服务端配置 `FASTTASK_URL` 及 `FASTTASK_SERVICE_ISSUER`、`FASTTASK_SERVICE_CLIENT_ID`、`FASTTASK_SERVICE_CLIENT_SECRET`，通过已发行 FastCAS SDK 获取 scope 为 `integrations:fastresearch` 的服务 token。该身份独立于浏览器登录，FastCAS 注册须签发 Task audience（默认 `fasttask-api`）；Task 侧还须允许此 client 和对应 accountId 的 receiver refs。仅本地 HTTP issuer 需要 `FASTTASK_SERVICE_ALLOW_LOOPBACK_HTTP=true`。现有 `FASTTASK_API_KEY`（或 `FASTTASK_PROVISION_KEY`）部署仍可查询，但要求 Task 显式启用 `FASTTASK_FASTRESEARCH_LEGACY_INGEST_KEY_ENABLED` 且共享 Key 一致；服务身份配置不全或获取 token 失败不会降级到 Key。没有收到任务时，工作台显示「未接受到任务」。接收合同见 `contracts/fastresearch-today/v1/`；Task 当前未实现 tasks/progress/accounts 接收端。

本机以 `FASTTASK_ENV=production` 运行且公开地址为回环 HTTP 时，FastTask 还需设置 `FASTTASK_FASTRESEARCH_LOOPBACK_HTTP=true`。完整接口与安全规则见 [docs/key-login.md](docs/key-login.md)。

### 使用示例

详细集成说明和示例代码见：

- [FastTask 集成方案](docs/fasttask-integration.md) - 完整设计文档
- [集成使用示例](docs/fasttask-integration-example.md) - API 调用示例

## 数据存储

### SQLite 数据库

- `data/accounts.sqlite` - 账号、身份链接、FastCAS 会话
- `data/workflows.sqlite` - 工作流、工序、完成记录、待回传事件

### JSON 文件

- `data/access.json` - 个人密钥、关注作者、研究标签、收件箱（旧格式，兼容保留）

## 开发

### 项目结构

```
FastResearch/
├── server/                    # 服务端代码
│   ├── index.mjs             # 主服务器
│   ├── account-store.mjs     # 账号存储
│   ├── workflow-store.mjs    # 工作流存储
│   ├── fasttask-dispatch.mjs # FastTask 集成逻辑
│   ├── fastcas-http.mjs      # FastCAS 认证
│   └── service-ingest.mjs    # 服务接收校验
├── src/                       # 前端代码
│   ├── App2.tsx              # 主应用组件
│   ├── index.css             # 样式
│   └── i18n.ts               # 国际化
├── docs/                      # 文档
│   ├── api.md                # API 文档
│   ├── sso.md                # SSO 集成说明
│   ├── fasttask-integration.md      # FastTask 集成方案
│   └── fasttask-integration-example.md  # 使用示例
└── package.json
```

### 运行测试

```bash
# 运行所有测试
npm test

# 运行 FastTask 集成测试
npm run test:fasttask
```

### 代码风格

- 使用 ESM 模块
- 服务端使用 Node.js 内置模块优先
- 前端使用 React + TypeScript
- 遵循项目现有代码风格

## 部署

### 本地部署

```bash
# 构建前端
npm run build

# 启动生产服务
npm run server
```

## 生产部署与自动发布

本仓库 `main` 推送后由 GitHub Actions 工作流 `CD FastResearch` 构建前端；若仓库 Secrets 配好了 SSH，会自动在服务器执行 `scripts/deploy-local.sh`。

服务器本机也有 systemd 定时拉取 `origin/main` 并热更新，不依赖 GitHub Secrets。

生产进程：

```bash
npm run build
npm start   # node --env-file=.env.production server/index.mjs
```

`server/index.mjs` 会同时提供 `/api/*` 与 `dist/` 静态资源。监听地址由 `HOST`/`PORT` 控制，默认 `127.0.0.1:8787`，前面用 nginx 反代 80 端口。

需要的 GitHub Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`，可选 `DEPLOY_KNOWN_HOSTS`。

### Docker 部署

```bash
# 构建镜像
docker build -t fastresearch .

# 运行容器
docker run -d \
  -p 8787:8787 \
  -v $(pwd)/data:/app/data \
  -e FASTCAS_ISSUER=https://fastcas.example.com \
  fastresearch
```

### Vercel 部署

前端可以单独部署到 Vercel：

```bash
npm run build
vercel deploy
```

后端需要部署到支持 Node.js 的服务器。

## 许可证

[MIT License](LICENSE)

## 相关项目

- [FastRead](https://github.com/example/FastRead) - 论文阅读与检索
- [FastWrite](https://github.com/example/FastWrite) - 学术写作工作区
- [FastNews](https://github.com/example/FastNews) - 学术资讯聚合
- [FastTask](https://github.com/example/FastTask) - 任务与计划管理
