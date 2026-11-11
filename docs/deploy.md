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

普通生产变量直接写在 `deploy.with.runtime-env`；敏感变量在 `deploy.secrets.runtime-secrets` 中逐项引用仓库 Secrets，通过 `toJSON` 保留特殊字符。前端 `VITE_*` 还需写到 `validate.env`，在构建时生效。不要把私密值写进 YAML。

SSH 配置来自组织 Secrets：`FASTRD_SSH_HOST`、`FASTRD_SSH_PORT`、`FASTRD_SSH_USER`、`FASTRD_SSH_PRIVATE_KEY`、`FASTRD_SSH_KNOWN_HOSTS`。组织需授权给 FastResearch，主机公钥必须预先核验。项目 Secrets 的完整名称以该 YAML 的 `runtime-secrets` 映射为准。

首次启用前先公开并发布 FastDeploy `v1`，生产引用改为完整提交 SHA，配置项目 `production` Environment，并按 FastDeploy README 接管服务器旧轮询。未完成接管时发布会拒绝切换。旧 `cd.yml` 只保留手动入口，不要在 FastDeploy 接管后再执行旧发布；它会直接更新在线目录，绕过新版本记录。

FastDeploy 使用私有的 `.fastdeploy/runtime.json` 注入进程环境，保留原来的 `.env.production` 和 `/home/dev/FastResearch/data`。新增发布使用 `HOST=127.0.0.1`，通过现有 Nginx 对外服务。

手动回滚执行 `.github/workflows/rollback.yml`，填入成功发布日志中的当前 release ID。只恢复代码及运行配置，不恢复数据库。含不兼容数据库变更的版本需先完成独立备份和恢复安排。
