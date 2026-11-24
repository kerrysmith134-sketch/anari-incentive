# 项目工作约定（Agent Memory）

## 测试节奏（强制）

- **不要在开发过程中反复跑全量测试。**
- 开发阶段只跑与改动直接相关的定向测试 / 单文件测试。
- 等所有开发工作完成、准备交付时，再统一跑一次全量：
  - `npm test`
  - `npm run typecheck`
  - `npm run test:pg`
  - `npm run test:pg-upgrade`
  - 必要时 `npm run web:build`
- 全量失败时，先修复再重跑；不要用“多跑几遍全量”代替定位问题。

## 交付前检查

- 迁移文件新增后运行 `npx tsx scripts/migration-manifest.ts` 刷新 `db/migrations/manifest.json`。
- 新增/修改 Zod 请求契约后运行 `npm run contracts:manifest` 刷新 `docs/generated/request-contracts.json`，并同步 `docs/openapi.yaml`。
- 不 commit、不改 lockfile，除非用户明确要求。
- 涉及金额/结算/财务事实的改动必须有定向测试与审计可追溯说明。
