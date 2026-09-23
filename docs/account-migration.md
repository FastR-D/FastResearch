# 独立账号、SQLite 迁移与回滚

服务现在使用 `accounts.sqlite`，默认位于 `FASTRESEARCH_DATA_DIR`；可用 `FASTRESEARCH_ACCOUNT_DATABASE` 指定已有数据库。Node 最低版本 22.13，本地验证版本 22.22.2。Docker 基础镜像已调整到 Node 22，容器构建尚未验证。

启动时优先使用已有数据库；没有数据库时校验旧 `access.json`，保留逐字节 `.pre-accounts.json` 后迁移。非法 JSON、重复 Key ID 或损坏凭证会停止启动，不会重置为默认空库。无旧文件的新实例会先初始化管理员与签名配置，再建立数据库。迁移后不再更新旧 JSON。

升级前停止旧实例写入，可先只读预览：

```sh
node scripts/migrate-accounts.mjs data/access.json data/accounts.sqlite
```

也可在启动前显式应用：

```sh
node scripts/migrate-accounts.mjs data/access.json data/accounts.sqlite --apply
```

每个旧 Key ID 对应独立稳定 account ID，同名账号不合并。accounts 保存业务内容，credentials 保存 Key 摘要、版本及失效状态；旧 keyId 字段继续支持 Read/News SSO，新增 accountId 字段用于稳定归属。未知字段保留。迁移事务内重建旧快照并比对全部内容，报告不包含凭证或个人内容。数据库和备份权限为 0600，已有目标/备份不覆盖。

运行时内容写入采用 SQLite 事务及版本检查，另一个进程写入会触发冲突并要求重试，不静默覆盖。请求体在进入本进程写入队列前读取。管理员和成员会话、一次性票据均持久化，数据库只存 bearer 摘要。出票与消费保留原接口；退出登录持久撤销，票据原子单次消费。Key 撤销保留账号和数据；`POST /api/admin/keys/{keyId}/rotate` 轮换 Key 而不改账号，旧 Key/会话/未消费票据失效。

## 回滚

停止所有写入后导出当前内容到新文件，不能直接恢复旧快照覆盖新增资料：

```sh
node scripts/export-accounts.mjs data/accounts.sqlite data/access-rollback.json
```

导出保留当前个人内容和凭证，生成新的内置 JWT 签名 secret，避免旧服务器复活已退出会话。若部署显式配置了 `FASTRESEARCH_JWT_SECRET`，回滚时也必须更换此环境变量，因为它会覆盖文件值。将导出文件作为旧版本 `access.json` 使用，保留 SQLite 供核对；不要同时运行两套写入主库。导出不包含持久会话/票据，用户重新登录。

## 验证范围

`node --test server/account-migration.test.mjs server/account-store.test.mjs server/runtime.test.mjs`：5 项测试通过。覆盖只读预览、不泄露凭证、完整迁移、写入冲突、拒绝删除账号，以及真实 HTTP 进程的 Key 轮换、旧会话/票据失效、SSO 返回字段、内容和身份保持、重启会话/票据持久化、退出撤销和并发消费。

所有验证使用临时数据目录，未迁移实际用户数据。FastCAS provider/账号设置界面已加入，真实提供方联调已通过，参见 [接入说明](FASTCAS.md)；CAS 身份禁用与全局退出尚待上游支持。生产迁移和备份恢复演练仍待完成。

## FastCAS 存储适配进度

新增 `server/fastcas-store.mjs`：提供 TypeScript SDK 所需的持久化 `put/take`、稳定 account ID 绑定记录、活跃账号/subject 唯一约束和签名事件验签后的事务处理。事件去重、版本更新和对应 FastCAS 会话删除同事务提交；本地 Key 会话不受影响，旧绑定事件不会撤销新绑定。此适配器现已连接登录路由和前端，验证范围见 [接入说明](FASTCAS.md)。

`node --test server/fastcas-store.test.mjs` 已通过跨数据库实例消费、故障回滚、重试去重、旧版本防恢复和会话来源隔离测试。

新增 `server/fastcas-service.mjs` 服务层：原 Key 证明、已有绑定账号登录、准备/激活对账、解绑恢复和 CAS 会话定期复核。SDK 仅在启用后延迟加载，配置关闭不会触发 discovery；认证不按邮箱或姓名合并账号。服务测试覆盖 Key 证明失败、稳定 account ID、撤销响应丢失重试、旧激活响应拒绝和本地会话保留。HTTP 路由/界面现已连接，真实提供方契约已通过。
