> 历史文档：Node 时代的实现和验收记录。当前结构、认证政策与启动方式以 [README](../README.md) 和 [Go 迁移说明](go-migration.md) 为准。

# FastWrite / FastRead / FastTask 使用时长统计方案（网关侧、非侵入式）

> 状态：方案设计  
> 适用范围：FastResearch 及其工作台入口的 FastWrite、FastRead、FastTask  
> 目标：在不修改三个项目源码的前提下，统计每个成员在各个应用中的真实使用时长

---

## 1. 结论

方案可行，但前提是**网关必须位于用户与三个应用之间的流量路径上**。

当前架构中，FastResearch 只负责签发和消费 SSO 票据。用户点击入口后，浏览器会直接打开 FastWrite / FastRead / FastTask 的地址，后续请求不再经过 FastResearch：

- 入口打开逻辑：`src/App2.tsx:328-372`
  - FastRead / FastNews：`/api/sso/launch` 签发票据后打开模块地址
  - FastWrite：服务端返回带登录凭证的 URL 后直接打开
  - FastTask：`/api/sso/launch` 后跳转模块
- 票据消费：`server/index.mjs:1410-1436`
- 各模块地址来自 `FASTWRITE_URL`、`FASTREAD_URL`、`FASTTASK_URL` / `VITE_*_URL`

因此，仅在 FastResearch 页面埋点或记录 SSO 票据，只能得到“入口点击”和“会话有效期”，无法得到真实使用时长。

推荐做法：

1. 将三个应用放到统一网关后面（子域名反向代理）；
2. 网关记录已认证请求；
3. 网关向 HTML 注入轻量心跳脚本，统计前台活跃时间；
4. 后端做会话化和日聚合；
5. 通过管理端报表和 CSV 输出。

---

## 2. “使用时长”的口径

必须先明确统计口径，否则不同系统算出的数字无法对账。

| 口径 | 定义 | 用途 | 特点 |
|---|---|---|---|
| 打开时长 | 标签页从打开到关闭的墙钟时间 | 粗略了解 | 易被挂机、通宵标签页放大 |
| 请求活跃时长 | 相邻请求间隔不超过空闲阈值的时间 | 兜底统计 | FastRead 纯阅读会低估 |
| **前台活跃时长（推荐）** | 页面可见、且心跳/请求间隔不超过阈值的时间 | 正式统计 | 能区分后台标签页和空闲 |
| 交互时长 | 有键鼠/触摸操作的时间 | 深度分析 | 采集更重，非必须 |

**推荐对外口径：前台活跃时长**，同时保留“打开时长”作为辅助指标。

建议默认参数：

| 参数 | 默认值 | 说明 |
|---|---|---|
| 心跳间隔 | 30 秒 | 页面可见时发送 |
| 空闲阈值 | 5 分钟 | 超过则结束当前活跃段 |
| 单次会话上限 | 4 小时 | 防止挂机导致异常长会话 |
| 单步最大计入 | 5 分钟 | 单次事件间隔最多计入的量 |
| 原始事件保留 | 90 天 | 之后只保留日聚合 |

---

## 3. 方案对比

| 方案 | 是否修改项目源码 | 精度 | 部署成本 | 结论 |
|---|---|---|---|---|
| A. 反向代理 + 访问日志会话化 | 否 | 中 | 低 | 可作为兜底 |
| B. 反向代理 + 注入心跳脚本 | 否（仅网关改写 HTML） | 高 | 中 | **推荐** |
| C. 仅记录 SSO 票据 / 入口点击 | 否 | 低 | 低 | 不可作为时长依据 |
| D. iframe 包裹或嵌入前端 SDK | 需改代码，受 `X-Frame-Options` / CSP 限制 | 高 | 高 | 不符合非侵入式 |
| E. 浏览器插件 / 网络抓包 | 否 | 高 | 很高 | 隐私和运维风险大，不建议 |

推荐采用 **A + B**：

- B 为主，负责前台活跃时长；
- A 为兜底，心跳被拦截或注入失败时仍能统计请求活跃；
- 两条数据都标记来源，便于对账和置信度评估。

---

## 4. 总体架构

```
                    ┌─────────────────────────────────────────────┐
                    │              API Gateway                    │
Browser ──HTTPS──▶  │  TLS / 认证 / 反代 / 日志 / 心跳注入         │
                    │                                             │
                    │  /__usage/ping        ──▶  usage collector  │
                    │  /__usage/beacon.js   ──▶  静态脚本          │
                    └───────────────┬─────────────────────────────┘
                                    │
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
        FastWrite              FastRead              FastTask
     fastwrite.example.com  fastread.example.com  fasttask.example.com

                                    │
                                    ▼
                         usage_events / usage_sessions
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
                  管理端报表 / CSV        Grafana / Metabase
```

---

## 5. 流量接入设计

### 5.1 使用子域名，不使用子路径

推荐：

- `fastwrite.example.com` → FastWrite
- `fastread.example.com` → FastRead
- `fasttask.example.com` → FastTask

原因：

- 子路径会破坏前端对根路径 `/` 的假设，需要改构建配置；
- 子域名只需 DNS 和证书，网关按 `Host` 路由，最接近“零侵入”；
- 各模块仍然以为自己部署在根路径。

### 5.2 保证流量无法绕过网关

- 三个模块的原端口只允许网关访问（防火墙 / 安全组）；
- 对外只暴露网关域名；
- 如果模块必须保留外部直连地址，则该部分流量无法统计，需要在报表中标注覆盖率。

### 5.3 认证与身份

- 网关复用 FastCAS / FastResearch 会话；
- 建议将会话 Cookie 域设置为 `.example.com`，例如现有配置：
  - `FASTRESEARCH_COOKIE_NAME=fr_session`
  - `FASTRESEARCH_COOKIE_DOMAIN=.example.com`
- 网关自行解析会话，得到 `accountId / keyId / person`；
- 只把身份写入统计日志，不要求上游模块信任任何新增请求头；
- 客户端传入的 `X-User`、`X-Account-Id` 等头一律丢弃。

> 注意：不要把原始 Cookie 或 Token 写进日志。日志中只记录内部用户 ID。

---

## 6. 请求采样设计

网关对每个已认证请求记录一条事件：

```json
{
  "ts": "2026-11-04T09:31:22.315Z",
  "user_id": "acct_123",
  "app": "fastread",
  "method": "GET",
  "path": "/api/papers",
  "status": 200,
  "duration_ms": 82,
  "source": "request"
}
```

规则：

- 只记录已认证请求；
- 排除健康检查、静态资源、`/favicon.ico`；
- 排除管理员/自动化流量（可通过 UA、角色、请求特征）；
- `path` 需要脱敏：去掉查询参数中的 Token、Key、邮箱等；
- 日志异步写入，不阻塞代理转发。

---

## 7. 心跳脚本设计

### 7.1 注入方式

网关对满足条件的响应注入脚本：

- `Content-Type: text/html`
- 状态码 200
- 仅文档请求，不注入 `/api`、静态资源、WebSocket
- 注入位置：`</body>` 前
- 脚本必须同源，由网关提供 `/__usage/beacon.js`

示例（Nginx）：

```nginx
# 对 HTML 关闭上游压缩，避免 sub_filter 无法处理
proxy_set_header Accept-Encoding "";

sub_filter '</body>' '<script src="/__usage/beacon.js" defer></script></body>';
sub_filter_once on;
sub_filter_types text/html;
```

### 7.2 心跳脚本

```js
(() => {
  const endpoint = '/__usage/ping';
  const app = document.documentElement.dataset.fastApp || location.hostname;
  const tabId = sessionStorage.getItem('__usage_tab') ||
    (crypto.randomUUID?.() ?? String(Date.now() + Math.random()))
  sessionStorage.setItem('__usage_tab', tabId)
  let seq = 0
  let lastVisible = document.visibilityState === 'visible'

  const send = (type) => {
    const payload = JSON.stringify({
      app,
      tab_id: tabId,
      seq: ++seq,
      type,
      visible: document.visibilityState === 'visible',
      ts: Date.now(),
      path: location.pathname,
    })
    const blob = new Blob([payload], { type: 'application/json' })
    if (!navigator.sendBeacon(endpoint, blob)) {
      fetch(endpoint, { method: 'POST', body: payload, keepalive: true })
    }
  }

  send('start')

  setInterval(() => {
    if (document.visibilityState === 'visible') send('heartbeat')
  }, 30000)

  document.addEventListener('visibilitychange', () => {
    const visible = document.visibilityState === 'visible'
    if (visible !== lastVisible) {
      lastVisible = visible
      send(visible ? 'visible' : 'hidden')
    }
  })

  addEventListener('pagehide', () => send('end'))
})()
```

说明：

- 只在页面可见时发心跳；
- 切到后台立即上报 `hidden`，切回前台上报 `visible`；
- 关闭/刷新页面时 `pagehide` 上报 `end`；
- `sendBeacon` 失败时降级 `fetch(..., keepalive: true)`；
- 脚本体积控制在 1 KB 左右，不引入依赖。

### 7.3 心跳接口

```http
POST /__usage/ping
Content-Type: application/json
Cookie: fr_session=...
```

```json
{
  "app": "fastread",
  "tab_id": "8f2c...",
  "seq": 12,
  "type": "heartbeat",
  "visible": true,
  "ts": 1793809900615,
  "path": "/paper/123"
}
```

服务端校验：

- 同源 / 允许的 Origin；
- 会话有效；
- 时间戳偏差在允许范围内（例如 ±5 分钟）；
- 按 `user_id + app` 限流（例如 2 次/分钟）；
- 只保留必要字段。

---

## 8. 会话化算法

### 8.1 单个标签页

```
按 user_id + app 分组，事件按时间排序：

if 距上一条事件 > IDLE_GAP:
    结束当前会话，开启新会话
else:
    当前会话活跃时长 += min(事件间隔, MAX_STEP)
    更新 last_seen_at
```

### 8.2 多标签页去重

同一用户可能同时打开多个标签页。**不能把多个标签的时长相加**，应按活跃区间取并集：

```
1. 将每个标签页的活跃区间拆成 [start, end]
2. 按 user_id + app 合并重叠/相邻区间
3. 合并后的区间长度之和即该用户该应用当天的活跃时长
```

### 8.3 边界规则

| 场景 | 处理 |
|---|---|
| 后台标签页 | `visible=false` 后不计入；切回时开启新活跃段 |
| 通宵挂机 | 单会话上限 4 小时，超出强制结束 |
| 网络中断 | 恢复后间隔超过空闲阈值则开新会话 |
| 多设备 | 按用户+应用合并区间，不重复计算 |
| 时钟漂移 | 以服务端接收时间为准，客户端时间只做参考 |
| 心跳丢失 | 请求日志兜底；两条数据都缺失时置信度标低 |

### 8.4 伪代码

```js
function sessionize(events, { idleGap = 5 * 60e3, maxStep = 5 * 60e3, maxSession = 4 * 3600e3 } = {}) {
  const sessions = []
  let current = null
  let last = null

  for (const event of events) {
    if (!current || event.ts - last.ts > idleGap || event.ts - current.startedAt > maxSession) {
      current = { startedAt: event.ts, endedAt: event.ts, activeMs: 0 }
      sessions.push(current)
    } else {
      current.activeMs += Math.min(event.ts - last.ts, maxStep)
      current.endedAt = event.ts
    }
    last = event
  }

  return sessions
}
```

---

## 9. 数据模型

### 9.1 原始事件

```sql
CREATE TABLE usage_event (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       TEXT NOT NULL,
  app           TEXT NOT NULL CHECK (app IN ('fastwrite', 'fastread', 'fasttask')),
  ts            INTEGER NOT NULL,              -- 服务端毫秒时间戳
  kind          TEXT NOT NULL,                 -- request | start | heartbeat | visible | hidden | end
  source        TEXT NOT NULL,                 -- request | beacon
  visible       INTEGER,                       -- 0/1，仅心跳事件
  tab_id        TEXT,
  path          TEXT,
  client_ts     INTEGER,
  created_at    INTEGER NOT NULL
);

CREATE INDEX idx_usage_event_user_app_ts ON usage_event(user_id, app, ts);
```

### 9.2 会话与日聚合

```sql
CREATE TABLE usage_session (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        TEXT NOT NULL,
  app            TEXT NOT NULL,
  started_at     INTEGER NOT NULL,
  ended_at       INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL,
  source         TEXT NOT NULL,                -- beacon | request | mixed
  confidence     REAL NOT NULL DEFAULT 1.0,    -- 0~1
  created_at     INTEGER NOT NULL
);

CREATE TABLE usage_daily (
  user_id        TEXT NOT NULL,
  app            TEXT NOT NULL,
  day            TEXT NOT NULL,                -- YYYY-MM-DD
  active_seconds INTEGER NOT NULL,
  session_count  INTEGER NOT NULL,
  first_seen_at  INTEGER NOT NULL,
  last_seen_at   INTEGER NOT NULL,
  confidence     REAL NOT NULL,
  PRIMARY KEY (user_id, app, day)
);
```

### 9.3 会话与日期归属

- 会话按开始时间归属日期；
- 跨天会话在 00:00 切分（可选，建议实现）；
- 时区固定为团队所在时区（例如 `Asia/Shanghai`），不要使用服务器本地时区。

---

## 10. 指标与报表

### 10.1 核心指标

| 指标 | 定义 |
|---|---|
| 日活跃时长 | 当天前台活跃秒数 |
| 日活跃用户数 | 当天活跃时长 > 0 的用户数 |
| 人均活跃时长 | 活跃时长 / 活跃用户数 |
| 会话数 | 合并后的活跃会话数量 |
| 平均会话时长 | 活跃时长 / 会话数 |
| 置信度 | beacon 覆盖比例，低于阈值标黄 |

### 10.2 报表维度

- 按成员：每天/每周各应用活跃时长
- 按应用：FastWrite / FastRead / FastTask 使用分布
- 按团队：成员对比、趋势
- 导出：CSV / Excel

### 10.3 置信度

```text
confidence = beacon_seconds / (beacon_seconds + request_only_seconds)
```

- `>= 0.8`：高
- `0.5 ~ 0.8`：中
- `< 0.5`：低，报表中标注“仅请求估算”

---

## 11. 实现选型

### 11.1 方案对比

| 方案 | 优点 | 缺点 | 适用 |
|---|---|---|---|
| Nginx / OpenResty | 成熟、性能好、`sub_filter` 简单 | 会话化需外部服务；Lua 维护成本 | 已有 Nginx 运维体系 |
| APISIX | 插件丰富、JWT/限流/日志开箱即用 | 需要学习插件模型 | 多服务、需要治理能力 |
| Envoy / Istio | 云原生、可观测性强 | 配置复杂、资源占用高 | K8s 环境 |
| Node 自研网关 | 与 FastResearch 技术栈一致，可直接复用账号库和 FastCAS 会话 | 需要自己处理转发、超时、WebSocket、流式响应 | 团队规模小、快速落地 |

### 11.2 对本仓库的建议

优先做 **Node 最小网关**，原因：

- 可直接复用 `server/account-store.mjs`、FastCAS 会话和 `data/accounts.sqlite`；
- 统计逻辑与 FastResearch 账号体系天然对齐；
- 先以单进程反代 + SQLite 验证口径，再迁移到 Nginx/APISIX。

网关职责：

1. 按 `Host` 反代到三个模块；
2. 校验 FastResearch / FastCAS 会话；
3. 记录请求事件；
4. 对 HTML 注入心跳脚本；
5. 接收 `/__usage/ping`；
6. 定时会话化、日聚合；
7. 提供管理端查询接口。

---

## 12. 非侵入式注入的工程约束

| 问题 | 处理 |
|---|---|
| gzip / brotli | 对 HTML 请求设置 `Accept-Encoding: ""`，或解压后再注入 |
| Content-Length | 注入后必须重算，或改用 chunked |
| CSP | 允许同源脚本；严格 CSP 需网关补 nonce，否则降级为请求日志 |
| SRI | 只注入外链同源脚本，不修改模块已有资源 |
| 缓存 | HTML 不缓存或按用户区分；静态资源照常缓存 |
| 流式响应 | 只处理完整 HTML 文档；SSE/下载流不注入 |
| 注入失败 | try/catch 包裹，失败时原样返回，不影响业务 |
| WebSocket | 正常代理，不注入；用心跳判断活跃 |
| 移动端 | `visibilitychange` + `pagehide` + `sendBeacon` |

---

## 13. 准确性校验与对账

### 13.1 三套口径对比

| 数据源 | 含义 |
|---|---|
| beacon 活跃时长 | 前台可见时间 |
| request 活跃时长 | 有请求的时间 |
| SSO 会话时长 | 票据有效期 / 登录时长 |

同一天同一用户：

- beacon 应 ≤ 打开时长；
- beacon 通常 ≥ request（尤其 FastRead）；
- SSO 会话时长通常最大，不能直接当使用时长。

### 13.2 灰度验证

1. 先只代理 FastWrite，开启 beacon；
2. 同时保留请求日志，比较两套口径；
3. 一周后检查：
   - 差异是否主要来自 FastRead 类纯阅读场景；
   - 是否存在异常长会话（> 4 小时）；
   - 多标签页是否被正确合并；
4. 通过后再接入 FastRead、FastTask。

### 13.3 抽检

- 随机抽取 10 名成员，与其本人确认某天使用情况；
- 对比网关数据与模块自身日志（如有）；
- 记录误差范围，写入报表说明。

---

## 14. 隐私、安全与合规

- 只采集“谁、哪个应用、何时活跃”，不采集页面内容、请求体、论文内容；
- 不记录原始 Cookie、Token、个人 Key；
- 用户 ID 可使用内部 `accountId`，报表展示姓名；
- 原始事件保留 90 天，之后仅保留日聚合；
- 报表访问按角色控制（管理员 / 团队负责人）；
- 对成员做使用说明，明确统计目的和范围；
- 若用于考核，需有明确的制度依据和申诉渠道；
- 遵循最小必要原则，避免采集与统计无关的行为数据。

---

## 15. 分阶段落地计划

### 阶段一：流量接入（1~2 天）

- DNS / 证书 / 子域名配置；
- 网关反代三个应用；
- 禁止直连原端口；
- 验证登录、Cookie、静态资源、WebSocket 正常。

### 阶段二：请求日志（2~3 天）

- 已认证请求写入 `usage_event`；
- 实现按 `user + app` 的会话化；
- 输出基础日聚合；
- 与 SSO 会话数据对比。

### 阶段三：心跳注入（2~3 天）

- 注入 `/__usage/beacon.js`；
- 接收 `/__usage/ping`；
- 处理前台/后台、多标签、异常时间戳；
- 计算置信度。

### 阶段四：报表与验收（2~3 天）

- 管理端按人/应用/日期查询；
- CSV 导出；
- 数据保留策略；
- 灰度对比与误差评估。

### 阶段五：生产化（按需）

- 迁移到 Nginx / APISIX；
- 日志进入 ClickHouse / Prometheus；
- 告警：心跳丢失率、代理 5xx、认证失败率；
- 容量评估与压测。

---

## 16. 风险与应对

| 风险 | 影响 | 应对 |
|---|---|---|
| 用户绕过网关直连模块 | 数据缺失 | 防火墙限制原端口；报表标注覆盖率 |
| 强 CSP 导致脚本被拦截 | 心跳失效 | 网关补 nonce / 同源脚本；降级请求日志 |
| 注入破坏页面 | 业务不可用 | 注入失败原样返回；灰度发布；可一键关闭 |
| 多标签重复计算 | 时长虚高 | 区间并集，不按标签求和 |
| 挂机 / 通宵 | 时长虚高 | 空闲阈值 + 单会话上限 |
| 心跳丢失 | 时长偏低 | 请求日志兜底；置信度标记 |
| 身份映射错误 | 数据归属错误 | 网关统一认证；禁止信任客户端头 |
| 隐私争议 | 合规风险 | 最小化采集、告知、权限、保留策略 |

---

## 17. 验收标准

- [ ] 三个应用均可通过网关正常访问，登录态、静态资源、WebSocket 无异常；
- [ ] 未认证请求不计入统计；
- [ ] 前台/后台切换后，活跃时长不包含后台时间；
- [ ] 多标签页时长按并集计算；
- [ ] 单会话不超过配置上限；
- [ ] beacon 与请求日志的差异可解释，置信度可展示；
- [ ] 320 / 390 / 桌面端均能正常发送心跳；
- [ ] 管理端可按人、应用、日期查询并导出 CSV；
- [ ] 关闭注入后业务无影响，统计自动降级为请求口径；
- [ ] 原始事件按保留策略自动清理。

---

## 18. 待确认问题

1. 三个应用目前是否已经部署在统一域名 / 同一台机器上？
2. 是否允许使用子域名（`fastwrite.example.com` 等）？
3. 各模块是否有严格 CSP 或 SRI？是否允许网关注入同源脚本？
4. “使用时长”是否用于考核？如果是，口径和告知方式需要先确定。
5. 数据保留多久？是否需要导出到现有 BI / 数据仓库？
6. 是否需要区分“阅读 / 编辑 / 任务处理”等子场景？如需区分，可在心跳中增加 `path` 维度，但仍不采集内容。
