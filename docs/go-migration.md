# Go 后端迁移

本次重构将生产入口切换为 `cmd/fastresearch`，前端移至 `web/`，已删除旧 Node 实现、迁移工具和演示脚本；旧源码可从 Git 历史查阅。Go 后端自身负责兼容旧数据格式，旧 Node 测试不再作为验收依据。

## 数据

首次启动时，在 `FASTRESEARCH_ACCOUNT_DATABASE` 指定的数据库新增 `fr_*` 表，并通过 `fr_migrations` 记录一次性导入。兼容原 `accounts` / `accounts_main_legacy` / `legacy_accounts` 与 `credentials` 表，也兼容仅有 `access.json` 的安装。账号 ID、Key ID、内容 JSON、凭证版本和自定义字段保持；源文件和旧表不写回。

显式 FastCAS 绑定以原 issuer、client ID、subject 映射到原账号，登录时向中心验证其仍然 active。prepared 或 revoked 的旧绑定不会触发另建账号。只有没有历史绑定的已验证中心身份才建立新的资料账号；不会按邮箱或名称自动合并。

旧 Node 会话与旧 SSO 票据失效，升级后需用原 Key 或 FastCAS 重新登录。无中心绑定的旧资料由管理员核对后迁移，禁止通过同名或邮箱猜测所有权。回滚 Node 可继续读取其原有表；Go 运行后新增的资料不会自动回写旧表，回滚前需另行导出核对。

`session-vault.key` 是中心令牌的加密密钥，必须随数据库持久保存和备份。删除后需要所有用户重新登录。建议一个数据卷运行一个服务实例。

## 认证变化

没有本地密码管理员，也没有可开启的自行注册开关。已有中心身份首次登录只创建本地内容资料，无法调用 FastCAS 注册或创建身份 API。管理员角色仅接受中心 UserInfo 的 `role=admin`；签名 ID Token、PKCE、nonce、state、单次持久事务和浏览器 Cookie 绑定由 FastCAS Go SDK 验证。

普通会话中心验证缓存一分钟；管理操作每次重新读取 UserInfo，包含令牌刷新。签名状态通知和标准 backchannel logout 仅撤销匹配 issuer、subject / sid 的 FastCAS 会话，去重与撤销同事务。撤销中的会话不能被正在进行的刷新重建。

FastCAS 必须部署 `docs/integrations/fastcas-role-claim.patch` 对应变更，并允许 Research 客户端使用 profile 与 offline_access。中心不返回 role 时不会授予管理权限。

## 部署

Go 构建使用 CGO SQLite，需要 C 编译器。Docker 使用独立 Node 前端阶段与 Go 编译阶段，最终镜像只有程序、静态文件和运行库。

CI 用项目内 `deployments/fastdeploy-profile.json` 注入已固定版本的 FastDeploy 工具，产物根目录只允许 `bin` 和 `dist`，systemd 启动 Go 程序。避免复用旧 FastDeploy 中的 `node server/index.mjs` 配置。原来的 `scripts/deploy-local.sh` 使用 `npm run build` 构建 Go 和前端；systemd 必须先切换到新的 unit 示例。

旧 `/api/sso/ticket` 与 `/api/sso/consume` 返回 410；`/api/sso/launch` 只使用已配置的子应用 CAS 入口。原 `/read/*` 路径代理改为跳转到 FastRead 公开 URL，子应用自己的静态资源、Cookie 和认证由子应用处理。

## 需要环境验收的部分

本地测试使用签名 OIDC HTTP fixture，不代表已连接生产 FastCAS。管理员角色补丁另属 FastCAS 仓库，需要同步发布。FastTask 和 FastWrite 的保留写入接口可能仍未在目标项目实现，必须依据实际部署验证；服务认证失败不会回退共享 Key。历史 Node 的按姓名广播投递不再接受，调用方必须指定授权的 `receiver_ref`。
