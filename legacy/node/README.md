# 历史 Node 实现

此目录保留 Go 迁移前的服务、测试和维护脚本，生产入口已经是 `cmd/fastresearch`。

旧测试和脚本依赖原 Node 版本及额外的 `@fastrd/fastcas`、`yaml` 依赖，不属于当前 `npm test`。使用历史迁移工具前请在备份上核对其适用的数据格式。当前 Go 导入和认证政策见根 README 与 `docs/go-migration.md`。
