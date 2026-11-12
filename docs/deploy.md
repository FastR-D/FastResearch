> 历史文档：Node 时代的实现和验收记录。当前结构、认证政策与启动方式以 [README](../README.md) 和 [Go 迁移说明](go-migration.md) 为准。

# FastResearch 部署

## 本机

```bash
cp .env.example .env.production
# 填写生产环境变量
npm ci
bash scripts/deploy-local.sh --skip-pull --force
```

传统本机启动使用 `npm start` 读取 `.env.production`。

## GitHub Actions

版本发布入口为 `.github/workflows/tag-ci.yml`，推送 `v*` Git tag 后依次执行：

1. 在 Ubuntu 24.04 / Node 24 下安装锁定依赖、执行测试、构建前端。
2. 打包已测试的源码、前端和生产依赖，生成提交及 SHA256 清单，上传 artifact。
3. 调用 FastDeploy 的 reusable workflow；验证完成后 SSH 上传、切换版本、重启和检查健康，失败时恢复旧服务与配置。

直接推送到 `main` 或针对 `main` 的 PR 均执行验证和打包，部署 job 仅在版本 tag 上运行。手动从普通分支运行只做验证。

普通生产变量直接写在 `deploy.with.runtime-env`；敏感变量在 `deploy.secrets.runtime-secrets` 中逐项引用仓库 Secrets，通过 `toJSON` 保留特殊字符。前端 `VITE_*` 还需写到 `validate.env`，在构建时生效。不要把私密值写进 YAML。

SSH 配置来自组织 Secrets：`FASTRD_SSH_HOST`、`FASTRD_SSH_PORT`、`FASTRD_SSH_USER`、`FASTRD_SSH_PRIVATE_KEY`、`FASTRD_SSH_KNOWN_HOSTS`。组织需授权给 FastResearch，主机公钥必须预先核验。项目 Secrets 的完整名称以该 YAML 的 `runtime-secrets` 映射为准。

FastDeploy `v1` 已公开发布，生产引用固定完整提交 SHA；组织 SSH Secrets、项目 Secrets、`production` Environment 均已配置。服务器旧轮询已停用并屏蔽，原 `cd.yml` 手动 SSH 发布入口已移除，服务器发布统一走 FastDeploy。

FastDeploy 使用私有的 `.fastdeploy/runtime.json` 注入进程环境，保留原来的 `.env.production` 和 `/home/dev/FastResearch/data`。新增发布使用 `HOST=127.0.0.1`，通过现有 Nginx 对外服务。

手动回滚执行 `.github/workflows/rollback.yml`，填入成功发布日志中的当前 release ID。只恢复代码及运行配置，不恢复数据库。含不兼容数据库变更的版本需先完成独立备份和恢复安排。
