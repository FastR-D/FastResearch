# FastTask 任务接入 FastResearch 流水线方案

> 状态：设计方案，尚未实施。
> 编写日期：2026-09-25。
> 依据：FastResearch 与相邻 FastTask 仓库当前工作区的源码阅读，包含已有未提交改动；未启动服务进行联调。
> 本文约定：标为“现有”的内容来自代码核对；新增对象、接口、字段和状态均为建议设计，不代表已经可用。

## 1. 目标与推荐方案

建立以下业务闭环：

**FastTask 发布任务包 → FastResearch 接收并展示流水线 → 用户进入各模块执行 → 提交工序成果 → FastTask 记录推进或完成任务。**

第一阶段围绕人工推进的科研工作台实施。FastTask 管理业务任务、每日计划、发布记录和完成规则；FastResearch 管理下发后的工序列表、当前执行阶段和成果提交；FastRead、FastWrite、FastLab 等模块提供实际工作空间与产物。

采用 FastTask 服务端主动推送、双方持久化待发送记录、失败重试和定期对账。后台自动执行、执行租约和工具作业调度放到后续自动化阶段。

## 2. 已核实的现状

| 范围 | 现有能力 | 接入缺口 |
|---|---|---|
| FastTask 业务模型 | Goal、Task、DailyPlan、DailyPlanItem、ProgressEvent，具有版本控制 | 发布业务入口、任务与执行模块的关联、下发记录 |
| FastTask 摘要 | GET /api/v1/panel/summary 提供当日计划摘要 | 不包含完整工序、输入材料和下发协议 |
| FastTask 外部作业回调 | Agent Job Callback 校验 attempt、lease 和 run token | 人工工序需要独立结果接收入口 |
| FastTask 集成投递 | 已有 OutboxEvent 和 Scheduler | 当前通用 Outbox 维护仅将 pending 标记为 processed，未实际向 FastResearch 发送 |
| FastResearch 接收 | POST /api/workflow/publish 可下发成员工作流 | 稳定关联、幂等、版本保护、实际接收回执 |
| FastResearch 执行 | 顺序展示工序，人工完成当前工序后进入下一模块 | 完成说明、产物引用、远端状态同步 |
| FastResearch 存储 | 工作流保存在 access.json；账号与身份关联已有 SQLite | 工作流接收和结果回传需要事务性持久化 |
| 账号与认证 | 两边均有 FastCAS 接入代码 | 跨系统账号映射和双向服务令牌校验需要明确接线 |

### 2.1 FastResearch 当前发布行为

现有发布入口会覆盖接收成员的 workflow。normalizeWorkflow 将所有工序的 completedAt 设为 null，重复发布会重置完成记录。

保存到接收成员时，会重新生成 workflow ID；接口响应却使用生成前的 workflow 对象。对接后必须返回每个接收对象实际保存的 ID。

当前工作流只保存工序 ID、模块、标题、说明和完成时间，不保存 FastTask 来源任务、来源版本、完成证据或同步状态。列表还会截取前 50 项，因此新协议应明确数量限制并拒绝超限请求，避免静默截断。

### 2.2 FastTask 的完成规则

完成 DailyPlanItem 与完成 Task 是两个独立业务动作。完成每日计划项不会自动完成底层 Task。

**Task 完成接口即使接收 type=step，也会把整个 Task 更新为 completed。** 中间工序完成不能直接映射成一次 Task completion。

时间类计划项完成需要校验真实 WorkSession 记录。仅提交工序用时或前端填写的分钟数不能代替这一校验。

### 2.3 当前认证边界

FastResearch 服务发布入口支持 FastCAS 服务 Bearer Token，检查 workflow:publish、receiver_ref 和服务接收账号白名单。receiver_ref 指向稳定的本地 accountId。

旧 X-FastInsight-Key 入口按 person 匹配成员，空 person 会匹配全部活跃成员。新集成应使用明确账号寻址。

FastTask 现有服务接口使用自身签发的 Panel JWT，校验自身 issuer、audience 和 scope。两边支持 FastCAS 登录，不代表服务令牌已经互通。

## 3. 业务模型与职责

### 3.1 引入任务下发单 Dispatch

建议建立以下关联：

**FastTask Task／DailyPlanItem → Dispatch → FastResearch Workflow → Stage → 完成记录与产物引用。**

Dispatch 表示一次明确的发布意图，保存执行配置与来源快照。一个 Task 可以分多次下发，一个 Dispatch 可以包含多个模块工序。每个工序可关联具体子任务或每日计划项。

同一次发布的网络重试沿用 dispatch_id 和 dispatch_revision。修改既有下发内容增加发布版本；用户明确安排新一轮执行或返工时创建新的 dispatch_id，并记录与前一次下发的关系。

第一期建议每个账号最多一条 active 流水线，其他已接收流水线进入待开始列表。启动时检查是否已有 active 流水线，新任务不会自动覆盖当前工作。

### 3.2 事实归属

| 数据或决定 | 负责系统 |
|---|---|
| 原始目标、任务、每日计划及其版本 | FastTask |
| 发布内容、接收账号、来源引用和下发版本 | FastTask |
| 接收回执、工序执行记录、待同步成果 | FastResearch |
| 原始论文、写作项目、实验结果等产物 | 对应业务模块 |
| 每日计划是否满足、底层任务是否完成 | FastTask |
| 人工完成说明和确认动作 | 发生操作的界面负责采集，服务端负责校验和记录 |

### 3.3 模块与工序选择

FastTask 的 Task 目前没有执行模块字段。第一期将模块选择、排序和来源关联保存到 Dispatch 的执行配置中。

例如“阅读论文 → 复现实验 → 撰写实验分析”可配置为 FastRead → FastLab → FastWrite。现有五模块默认顺序保留为参考模板。

先由用户选择并确认工序；后续可由 Agent 生成建议，再通过用户确认发布。FastTask 当前未批准的任务树提案不应直接触发下发。

## 4. 发布契约

以下为建议字段，具体命名在实施前冻结为版本化契约。

| 层级 | 字段或信息 | 说明 |
|---|---|---|
| 协议 | schema_version、trace_id | 兼容升级及跨系统排查 |
| 下发 | dispatch_id、dispatch_revision | 稳定发布标识和内容版本 |
| 接收 | receiver_ref | FastResearch 本地 accountId，必须明确指定 |
| 来源 | goal_id、task_id、可选 plan_id 与 plan_item_id | 关联原始业务对象 |
| 来源快照 | task_revision、可选 plan_revision 与 plan_item_revision | 校验来源是否发生变更 |
| 流水线 | title、description | 总体研究目的与范围 |
| 工序 | stage_id、module、position、title、description | stage_id 在同一下发内保持稳定 |
| 完成要求 | success_criteria、minimum_action、允许的完成类型 | 从任务或计划项要求中明确派生 |
| 完成关联 | 工序级来源引用及 completion_target | 明确是仅记录工序进展，还是请求完成某个计划项 |
| 输入材料 | 论文链接、项目引用、实验引用、已有产物引用 | 保存必要信息和稳定引用 |
| 产物要求 | 预期产物类型、是否必填、必要说明 | 用于提交时校验 |

发布内容应保存快照。运行中不隐式读取被修改后的任务说明并改变既有执行要求。

接收回执应包含 dispatch_id、接收的发布版本、receiver_ref、实际保存的 workflow_id、接收时间和当前状态。网络超时后可按稳定标识查询是否接收成功。

## 5. 身份映射与服务权限

建立受验证的 FastTask user_id 与 FastResearch accountId 映射。可依据双方已验证且有效的 FastCAS issuer + subject 绑定关系，或经用户证明两个本地账号后建立明确映射。姓名和邮箱仅用于展示。

建议复用 FastResearch 现有 workflow:publish 和接收账号白名单。FastTask 服务调用的目标账号必须来自绑定记录，并检查该用户对来源任务有权限。

FastResearch 回传时，FastTask 根据 dispatch_id 找到原发布用户和目标账号，核对服务身份、接收账号及工序归属，不信任请求体任意指定的 user_id。

建议为新的回传入口接入 FastCAS 服务令牌验证，定义专用最小权限，例如 dispatch:events:write；查询对账另设只读权限。令牌发行、audience、scope 和有效期需要在双方及 FastCAS 配置中明确落实。上述新增权限和回传认证当前尚未实现。

服务凭据保存在服务端。浏览器沿用各自成员会话，不持有跨系统服务令牌。未完成账号绑定的发布返回明确错误，不退回姓名匹配或广播。

## 6. 交互流程与接口规划

### 6.1 正常流程

1. 用户在 FastTask 选定任务，配置接收账号、模块、顺序和完成要求。
2. FastTask 校验权限与来源版本，在同一事务中保存 Dispatch 和待投递记录。
3. 投递器调用 FastResearch 的版本化发布入口。
4. FastResearch 校验服务权限、接收账号和数据结构，去重并事务性保存流水线，返回实际回执。
5. 用户在 FastResearch 启动流水线，逐步进入各模块工作区。
6. 完成工序时采集完成类型、说明和产物引用，保存工序结果与待回传事件。
7. FastTask 接收事件，去重并校验发布版本、工序关联和来源业务状态。
8. FastTask 保存下发进展；符合明确完成规则时调用现有业务用例，返回权威处理结果。
9. FastResearch 更新同步状态。双方定期按下发单和事件 ID 对账。

### 6.2 接口建议

新增路径为建议命名，实施时应与两边的路由约定统一。

| 系统 | 接口 | 状态 | 用途 |
|---|---|---|---|
| FastTask | POST /api/v1/research-dispatches | 新增 | 用户创建下发单 |
| FastTask | GET /api/v1/research-dispatches/{dispatch_id} | 新增 | 查询发布、接收和执行摘要 |
| FastTask | POST /api/v1/research-dispatches/{dispatch_id}/events | 新增 | 接收受限服务身份提交的工序事件 |
| FastResearch | POST /api/workflow/publish | 现有，需扩展 | 识别新协议版本，幂等接收下发单 |
| FastResearch | GET /api/integrations/fasttask/dispatches/{dispatch_id} | 新增 | 供授权服务确认接收结果和对账 |
| FastResearch | GET /api/workflows | 新增 | 成员查询当前、待开始和历史流水线 |
| FastResearch | POST /api/workflows/{workflow_id}/start | 新增 | 激活已接收流水线，检查单 active 约束 |
| FastResearch | POST /api/workflow/complete | 现有，需扩展 | 带 workflow_id、stage_id、版本及操作 ID 提交成果 |

对已有旧协议调用保留明确的兼容分支。FastTask 新集成必须使用新契约；列表、完成、默认流载入等旧入口也需检查当前流程来源，避免覆盖或跳过 FastTask 下发流程。

发布修订和撤回也必须通过受控操作传播。第一期可先提供明确撤回：停止后续工序、保留已有成果、记录原因；内容修订按第 8 节冲突规则处理。

## 7. 完成语义与状态

### 7.1 完成映射

| FastResearch 行为 | FastTask 处理建议 |
|---|---|
| 打开工作区 | 记录启动或进入阶段，不标记业务完成 |
| 完成一个中间工序 | 保存下发进展、说明和产物引用 |
| 工序明确映射计划项且满足其允许类型及要求 | 调用 CompletePlanItem |
| 完成最小行动 | 按计划项允许的 minimum_action 类型提交，不自动完成 Task |
| 全部工序完成 | 下发单执行结束，展示整体任务完成确认入口 |
| 用户确认达到整个 Task 的验收标准 | 调用 CompleteTask |
| 时间类完成 | 使用符合归属和状态要求的 FastTask WorkSession 校验 |

默认 completion_target 为仅记录工序进展，完成计划项需要显式映射。整体 Task 完成建议第一期在 FastTask 界面确认。

新回传用例还要校验：每日计划是否有效、计划项是否属于当前计划版本、是否 superseded 或已关闭，以及预期版本是否匹配。不能只沿用工序发布时缓存的版本直接写入。

当前完成用例的 EvidenceJSON 写入空数组。若需要正式保存结构化产物证据，应扩展证据关联能力；第一期至少将产物保存在下发事件记录并关联业务对象，避免将其当成已有支持。

### 7.2 执行与同步状态分开

建议流水线执行状态为 queued、active、completed、cancelled；工序为 pending、active、completed、blocked。现有前端 done 展示可以通过适配映射保留。

独立记录投递或回传状态：pending、sending、synced、retrying、conflict、failed。流水线 completed 仅表示工序执行结束，不表示底层 Task 已完成，也不表示所有回传已经确认。

网络中断时界面可以显示“工序已完成，等待同步”。如果某一步必须经过 FastTask 接受才能解锁后续步骤，应在工序配置中明确这一依赖；本地已采集的成果始终保留。

## 8. 幂等、冲突与恢复

| 场景 | 建议规则 |
|---|---|
| 相同下发版本重复发送相同内容 | 返回已有回执，保持 workflow ID 与工序进度 |
| 相同下发版本发送不同内容 | 返回冲突，不覆盖 |
| 较旧发布版本迟到 | 拒绝旧版本，并返回当前版本信息 |
| 修改尚未开始的下发单 | 校验预期版本后更新，保留修订记录 |
| 修改正在执行的工序及其验收要求 | 返回冲突或要求显式确认；不重置已完成工序 |
| 用户安排返工 | 创建新下发单并关联前一次执行 |
| 发布请求超时 | 用相同幂等标识重试或查询，不创建新发布意图 |
| 用户重复点击完成 | 同一个操作 ID 返回同一完成记录 |
| 完成事件重复回传 | 使用 event_id 去重，业务变更和接收记录同事务提交 |
| 事件乱序 | 校验发布版本和事件序号；缺失必要前序时等待补齐或对账 |
| 执行结束但回传失败 | 只重试回传，保留执行成果 |
| 原任务修改、计划重规划或账号绑定失效 | 标记 conflict 或权限失败，保留结果等待处理 |
| 撤回与完成同时发生 | FastTask 在下发单版本检查下原子裁决，保存双方事件 |
| 服务重启 | 从持久化待投递、待回传记录恢复 |

重试采用有限次数和退避，超过自动重试上限后保留失败记录并提供人工重试入口。认证失败和业务冲突应明确分类，避免无限重放。

## 9. 存储与后台投递

### 9.1 FastTask

建议新增下发单、工序配置、集成投递记录和接收事件记录。创建下发单与创建投递记录必须在同一事务中提交。

通过已有 Scheduler 扩展点注册专用投递任务，记录请求摘要、尝试次数、下次执行时间、回执和错误。收到接收方持久化成功的响应后才能标记成功。

第一期优先使用专用集成投递表，避免被当前通用 Outbox 的 pending → processed 维护逻辑提前消费。若决定扩展通用 Outbox，必须同时调整该维护逻辑和投递确认机制。

### 9.2 FastResearch

建议将新接入的工作流、工序、接收回执、完成事件和待回传记录存入 SQLite，以 accountId 关联稳定账号。

接收下发时，去重记录与流水线在同一事务中写入；完成工序时，工序结果与待回传记录在同一事务中写入。

现有 access.json 工作流采用一次迁移或明确的兼容读取策略。迁移后应确立唯一写入来源，避免 JSON 与 SQLite 两边同时修改同一流水线。账号下单 active 流水线通过存储约束及事务校验保证。

## 10. 界面与模块衔接

FastTask 任务或计划项详情增加“发布到 FastResearch”，提供接收账号、工序排序、完成要求与材料引用配置。发布后显示投递状态、执行阶段和成果入口。

FastResearch 保留现有顺序流水线布局，补充来源任务入口、当前与待开始列表、验收要求、完成说明、产物引用和同步提示。团队进度按授权范围展示；现有活跃成员列表逻辑不能直接推定为完整团队授权模型。

进入模块时需要保留 dispatch_id、workflow_id、stage_id 与业务材料引用。当前 openEntry 主要打开模块配置地址，具体任务上下文的传递和模块接收处理尚需增加。

第一期允许用户进入模块后手动定位材料，并返回提交稳定产物引用；后续为已具备对应能力的模块增加上下文交接。认证票据与任务上下文分别校验，URL 中不放服务凭据或敏感完整任务内容。

## 11. 分阶段实施

| 阶段 | 范围 | 验收结果 |
|---|---|---|
| 第一阶段：接收闭环 | 账号映射、发布配置、Dispatch、专用投递、幂等接收、当前与待开始列表 | 正确成员能收到完整流水线；重试不覆盖进度 |
| 第二阶段：完成闭环 | 完成说明、产物引用、事件回传、业务校验、补传与对账 | FastTask 正确记录推进，重复事件不重复记账 |
| 第三阶段：工作上下文 | 论文、写作项目、实验等上下文交接 | 从工序进入对应模块后可定位实际工作对象 |
| 第四阶段：自动执行 | 针对具备执行 API 的模块新增适配器、作业状态和取消恢复 | 自动执行成果可追溯，并通过同一完成规则回传 |

最小可用闭环应至少覆盖前两个阶段。用一个真实阅读任务验收：FastTask 发布阅读要求，FastResearch 展示，用户进入 FastRead，返回提交阅读结论和报告引用，FastTask 记录当日推进。

### 11.1 验收清单

- 发布给指定账号后，其他账号不能读取或操作该下发单。
- 未绑定账号或超出服务接收白名单的请求明确失败。
- 重复发布、超时重试返回同一接收记录，不重置完成进度。
- 新下发单进入待开始列表，不能覆盖正在执行的流水线。
- 完成请求必须准确指定流水线与工序，旧页面不能完成新工序。
- 回传断网后成果仍然可见，服务重启后能补传。
- 重复完成事件只产生一次业务变更。
- 来源任务版本变化、计划项过期或被替换时进入明确冲突处理。
- 中间工序完成不会误将整个 Task 标记为完成。
- 时间类完成继续遵守 FastTask WorkSession 校验。
- 撤回后停止后续执行，既有成果和回传记录仍可追溯。
- FastTask 能通过下发记录找到成果，FastResearch 能追溯来源任务及版本。

## 12. 实施前需冻结的契约

本文给出推荐默认值，进入开发前将以下内容整理成双方共用的接口契约与状态迁移表：

1. 发布来源支持单个 Task、每日计划项或任务组合的范围；建议先支持单个 Task，可关联一个计划项。
2. 服务调用使用的 FastCAS audience、scope、账号映射和授权检查方式。
3. 发布修订、撤回以及冲突处理的版本规则。
4. 每个工序的完成目标，尤其是仅记录进展与请求完成计划项的区别。
5. 产物引用格式、访问权限、保存期限与失效提示。
6. 老工作流迁移方式及旧接口兼容范围。

## 13. 源码依据

下列链接以 FastTask 与 FastResearch 位于同一父目录为前提。代码位置以函数或类型定位，避免后续插入代码导致行号失效。

| 依据 | 关键位置 |
|---|---|
| [FastResearch 工作流接口与存储](../server/index.mjs) | normalizeWorkflow、workflowView、persist、serviceCredential、/api/workflow/publish、/api/workflow/complete |
| [FastResearch 接收账号校验](../server/service-ingest.mjs) | assessService、serviceWorkflowTargets、legacyPersonTargets |
| [FastResearch 账号存储](../server/account-store.mjs) | openAccountStore、账号与身份关联 |
| [FastResearch FastCAS 说明](fastcas-integration.md) | receiver_ref、服务 scope、允许接收账号配置 |
| [FastResearch 实际前端](../src/App2.tsx) | WorkflowTask、Workflow、openEntry、completeTask、15 秒同步 |
| [FastTask 业务模型](../../FastTask/internal/persistence/models.go) | Task、DailyPlanItem、ProgressEvent、OutboxEvent |
| [FastTask 业务完成规则](../../FastTask/internal/application/app.go) | CompleteTask、CompletePlanItem、createOutbox |
| [FastTask HTTP 契约](../../FastTask/internal/httpapi/server.go) | 任务和计划项 completion、panel-summary、agent-job-callback |
| [FastTask 服务鉴权](../../FastTask/internal/platform/auth/auth.go) | AuthenticateServicePrincipal、IssueServiceTokenForClient |
| [FastTask FastCAS 绑定](../../FastTask/internal/platform/auth/fastcas.go) | FastCASLinks、绑定与本地用户关联 |
| [FastTask 调度器](../../FastTask/internal/scheduler/scheduler.go) | Sweeper、maintain、Outbox pending → processed |
| [FastTask 集成设计资料](../../FastTask/doc/integration/README.md) | 工具边界与已有集成说明；实现状态仍以对应源码为准 |
