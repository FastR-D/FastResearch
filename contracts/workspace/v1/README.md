# 通用应用摘要协议 v1

Research 浏览器入口为 `GET /api/workspace/apps/{id}/activity`；所有接收应用的服务端接口为 `POST /api/integrations/fastresearch/workspace`，请求体只含 `{ "subject": "已验证 CAS subject" }`，使用 `workspace:read` 的 FastCAS 服务令牌。不得转发浏览器会话或按姓名、邮箱关联账号。

响应版本为 `fastresearch.workspace.v1`，包含 `appId`、`accountState`（active/missing/inactive）、`metrics` 和 `items`。声明任务能力的应用附加 `tasks`（date、timezone、received、items、progress），字段和样例见 [联动说明](../../../docs/integrations/workspace-activity.md)。应用目录的 capabilities 决定前端启用哪些面板；不存在单独的 Task API。

消费者验证 appId、版本、相对链接和数量上限，非 active 响应会清除全部个人数据。接收端验证服务 JWT、权限、中心当前状态，以及本地和中心的 CAS 绑定所有者、状态与版本。未关联和故障均不能伪装成空计划。

Research 的 Go 测试覆盖通用身份路由、摘要投影、团队投影和专用旧接口移除；FastTask 的 `TestGenericWorkspaceTasksUseVerifiedCASAccount` 覆盖签名服务身份、实际任务数据、旧账号映射缺失、scope、未绑定、撤销绑定及服务令牌失效。
