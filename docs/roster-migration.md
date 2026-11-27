# 旧论文分发配置迁移

升级设置页不会自动迁移旧文件。上线新 FastInsight 前，必须把实际运行中的 `colleagues.yaml`（部署中也可能命名为 `collegue.yml`）写入 Research 当前数据库，并验证服务读取成功。本地示例可能缺少线上 `receiver_ref`，不能直接替代生产文件。

可以使用 FastInsight 的 `scripts/import_roster.py` 通过管理员会话导入；拥有数据库运维权限时，可使用本仓库的一次性命令。运行中的应用不会读取 YAML。

## 运维命令

1. 在受限目录备份原 YAML，记录 SHA-256。使用 FastInsight 的 uv 环境将 YAML 转换为 JSON，例如：

   ```bash
   umask 077
   uv run --locked python -c 'import json,sys; from scripts.import_roster import read_legacy; json.dump(read_legacy(sys.argv[1]),sys.stdout,ensure_ascii=False)' /path/to/colleagues.yaml > /protected/roster.json
   ```

2. 在 FastResearch 仓库构建命令：

   ```bash
   go build -o /protected/fastresearch-roster ./cmd/fastresearch-roster
   ```

3. 使用 Research 实际运行环境的 `FASTRESEARCH_DATABASE_URL`（PostgreSQL）或 `FASTRESEARCH_ACCOUNT_DATABASE`（SQLite），先生成预览。命令要求显式数据库配置，不会猜测默认路径。不要把数据库凭据写入命令历史或报告。

   ```bash
   /protected/fastresearch-roster --input /protected/roster.json > /protected/preview.json
   ```

   预览包含数据库类型、输入哈希、节点及关系数量、迁移前快照 `before` 和规范化后的 `target`。该报告包含成员信息，应限制文件访问权限。首次访问会初始化空配置记录。

4. 核对预览后，用其中 `before.revision` 写入：

   ```bash
   /protected/fastresearch-roster --input /protected/roster.json --apply --expect-revision '<before.revision>' > /protected/applied.json
   /protected/fastresearch-roster --input /protected/roster.json > /protected/verified.json
   ```

   回读应为 `already_imported`，内容与 `target` 一致，版本与写入结果一致。保留原 YAML、预览、写入和回读报告。

迁移会生成稳定的成员、方向 ID，抽取去重的关键词和成员目录，保留方向关联及默认接收人。`receiver_ref` 必须精确匹配现有账号 ID；只有 ID 不存在时才尝试精确匹配旧 Key ID，并转换为账号 ID。缺失、无效或禁用的收件账号会阻止导入，不按姓名匹配。

相同配置重复导入不会修改版本；已有不同配置或预览后发生并发修改时拒绝写入。命令不覆盖已有配置，也不修改源文件。

## 上线验证

数据库回读成功后，仍需使用 FastInsight 的实际服务身份运行 `scripts/validate_roster.py`。配置读接口要求 `research-api` audience、`insight:publish` scope 和有效服务身份。Research 的实时令牌校验凭据必须具有 FastCAS 对该 audience 的 introspection 权限；登录客户端 `research` 的凭据不能因此自动校验 `research-api` 的服务令牌。401 不能通过关闭实时校验或回退 YAML 解决。

生产配置使用 `FASTRESEARCH_FASTCAS_RESOURCE_CLIENT_ID=research-api` 和独立的 `FASTRESEARCH_FASTCAS_RESOURCE_CLIENT_SECRET`，后者通过同名 GitHub Secret 部署。该客户端必须在 FastCAS 注册且启用。浏览器登录继续使用 `FASTRESEARCH_FASTCAS_CLIENT_ID=research` 及原有登录密钥。资源身份只用于在线检查令牌；签名、audience、scope、服务客户端和收件人授权仍分别校验。未单独配置资源凭据时沿用登录凭据，适用于登录客户端本身就是目标 audience 的部署。

只有服务接口读取验证通过，才能确认执行端切换完成。
