# FastResearch 部署

## 本机

```bash
cp .env.example .env.production
# 填写生产环境变量
npm ci
bash scripts/deploy-local.sh --skip-pull --force
```

`fastresearch.service` 使用 `npm start` 读取 `.env.production`。

## GitHub Actions

推送到 `main` 会运行 `.github/workflows/cd.yml`：

1. `npm ci && npm run build` 作为门禁
2. 若配置了 `DEPLOY_SSH_KEY`，SSH 到服务器执行 `scripts/deploy-local.sh --force`

所需 Secrets：`DEPLOY_HOST`、`DEPLOY_USER`、`DEPLOY_SSH_KEY`，可选 `DEPLOY_KNOWN_HOSTS`。
