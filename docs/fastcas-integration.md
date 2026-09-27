# FastResearch 与 FastCAS

FastResearch 继续接受个人 Key，首次启动会为每条 Key 创建稳定 `accountId`，旧 Key ID 保存在 `legacy_key_id` 语义中。Key 轮换只替换凭证，不改变账号或内容。

配置 `FASTRESEARCH_FASTCAS_ISSUER`、`FASTRESEARCH_FASTCAS_CLIENT_ID`、`FASTRESEARCH_FASTCAS_CLIENT_SECRET` 和 `FASTRESEARCH_FASTCAS_REDIRECT_URI` 后，工作台会显示 FastCAS 登录与绑定入口。CAS 身份必须先和现有 Key 账号完成双端绑定；姓名和邮箱不会触发自动合并。

服务投递使用 `receiver_ref` 指向本地 `accountId`，并按 `insight:publish`、`reading:publish` 或 `workflow:publish` 校验 scope。工作流还要在 `FASTRESEARCH_FASTCAS_ALLOWED_TARGETS` 中为服务 client 配置允许的账号列表。Bearer 失败时不会回退到旧 ingest key。
