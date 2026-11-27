# 依赖与镜像安全收口（2026-11-27）

## 依赖升级
- zod `3.25.76` → `4.6.7`；源码改用 `zod/v3` 兼容入口，保持现有 schema 行为。
- vitest `2.1.9` → `5.1.2`；vite `5.4.21` → `7.3.8`（root），与 apps/web 的 vite 7 对齐。
- `npm audit fix` 处理 glob/minimatch moderate。

结果：
- `npm audit --audit-level=high` → **0 vulnerabilities**
- `npx tsc --noEmit` → exit 0
- `npm test`（vitest 5，`--no-file-parallelism`）→ **1802 passed / 118 skipped**
- PG `131 passed`；升级 `89 → 122` / 110 passed

## 镜像
- Dockerfile runtime 阶段 `npm ci --omit=dev` 后执行 `npm install -g npm@latest`，移除 npm CLI 自带旧依赖。
- `docker build` 成功；`trivy image --severity HIGH,CRITICAL --ignore-unfixed` → **0 findings**。

## CI
- `.github/workflows/security.yml` 的 audit / Trivy 门禁现在可转绿。
- `release.yml` 的 SBOM/cosign 仍需 GitHub 仓库设置（分支保护、tag 保护、OIDC 权限）。
