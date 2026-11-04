# 生产部署 runbook

> 适用范围:API(`apps/api`)、Agent worker(`apps/worker`)、PostgreSQL 16。
> 本文档描述从零到可运维的部署步骤、环境矩阵、升级与回滚。备份/恢复见
> [`backup-restore.md`](backup-restore.md),审计耐久性(WORM/TSA)见
> [`audit-durability.md`](audit-durability.md)。

## 1. 前置条件

- PostgreSQL 16(或兼容版本),已创建数据库与 `anari_app` 角色(见 `db/seed/`);
- OIDC 提供方(IdP):签发包含 `tenant_id` claim 的 JWT,暴露 JWKS 端点;
- 容器运行时(推荐)或 Node.js 22+;
- 网关/负载均衡:TLS 终止、共享限流、静态 console 资源缓存。

## 2. 环境变量矩阵

| 变量 | 必填 | 说明 |
|---|---|---|
| `NODE_ENV=production` | ✅ | 触发启动安全校验(见 §3) |
| `STORE=postgres` | ✅ | 生产禁用内存 store |
| `DATABASE_URL` | ✅ | 应用连接串(使用 `anari_app`,非 superuser) |
| `AUTH_MODE=oidc` | ✅ | 生产禁用 dev 头认证 |
| `OIDC_ISSUER` / `OIDC_JWKS_URL` | ✅(oidc) | JWT 校验 |
| `OIDC_AUDIENCE` | 建议 | JWT audience 校验 |
| `LOG_LEVEL=info` | 建议 | 请求日志 |
| `RATE_LIMIT_PER_MINUTE` | 建议 | 单副本限流;多副本在网关层做共享限流 |
| `REQUIRE_APPROVAL_FOR` | 按治理 | 强制审批的动作清单 |
| `ENFORCE_BUDGET_POOLS` | 按治理 | FORMAL 计算强制预算池 |
| `WEBHOOK_SECRET_<SOURCE>` / `WEBHOOK_SCHEME_<SOURCE>` | 按集成 | webhook 验签 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | 可选 | OTLP 追踪导出 |
| worker:`WORKER_TOKEN` 或 `OIDC_TOKEN_URL`+`OIDC_CLIENT_ID`+`OIDC_CLIENT_SECRET` | ✅ | worker 调 API 的凭证;token 的 tenant claim 必须匹配 `TENANT_ID` |

## 3. 启动安全校验(fail-fast)

`apps/api/src/config.ts` 在进程绑定端口前校验环境,以下组合**直接拒绝启动**:

- `NODE_ENV=production` + `AUTH_MODE=dev`(除非 `ALLOW_UNSAFE_DEV_AUTH=true`);
- `NODE_ENV=production` + 内存 store(除非 `ALLOW_MEMORY_STORE=true`);
- `AUTH_MODE=oidc` 缺 `OIDC_ISSUER`/`OIDC_JWKS_URL`;
- `STORE=postgres` 缺 `DATABASE_URL`。

worker 在生产环境缺 `WORKER_TOKEN`/OAuth client credentials 同样拒绝启动。
覆盖标志只用于显式接受风险的非生产演示,不得用于真实数据。

## 4. 部署步骤(容器)

镜像为多阶段构建:builder 阶段安装依赖并构建 console;运行阶段仅安装
生产依赖、以非 root `node` 用户运行,内置 `/health` HEALTHCHECK,
默认 `NODE_ENV=production`、`npm run start`。

```bash
# 1) 迁移 + 种子(checksum 跟踪,幂等;已应用文件被修改会失败)
DATABASE_URL=postgres://anari:anari@db-host:5432/anari_incentive \
  npm run db:migrate && npm run db:seed

# 2) (可选)导入策略包
APPROVED_BY=<person-uuid> npm run seed:packs

# 3) 启动 API 与 worker
docker run -d --name anari-api \
  -e NODE_ENV=production -e STORE=postgres \
  -e DATABASE_URL=... -e AUTH_MODE=oidc \
  -e OIDC_ISSUER=... -e OIDC_JWKS_URL=... -e OIDC_AUDIENCE=... \
  -e LOG_LEVEL=info -e RATE_LIMIT_PER_MINUTE=600 \
  -p 3000:3000 <image>
docker run -d --name anari-worker \
  -e NODE_ENV=production -e DATABASE_URL=... \
  -e API_BASE_URL=http://anari-api:3000 \
  -e TENANT_ID=<tenant-uuid> -e WORKER_TOKEN=<secret> \
  -p 3100:3100 <image> npm run start:worker
```

`docker-compose.yml` 是开发/演示栈(`NODE_ENV=development`),不要直接用于
生产;生产请用上述命令或自己的编排(K8s Helm/Kustomize 等),要点:

- API 与 worker 分开部署,各自扩缩容;
- worker 需要 `DATABASE_URL`(outbox 轮询)与 API 凭证;
- 迁移作为独立任务在任何 API/worker 之前执行,禁止并发双跑。

## 5. 健康检查与监控

| 端点 | 用途 |
|---|---|
| `GET /health` | 存活(容器 HEALTHCHECK 用) |
| `GET /ready` | 就绪(校验 store;503 表示不可接流) |
| `GET /metrics` | Prometheus:HTTP 计数/延迟、业务事件计数、进程指标 |

worker 在 3100 端口提供相同的 `/health`、`/ready`。

告警建议(最低集):

- `/ready` 连续失败 > 2 次;
- 5xx 比例 > 1%(5 分钟窗口);
- `n_perform_business_events_total` 长期为 0(业务停摆);
- 迁移任务失败;
- 磁盘/连接池饱和(PG 侧监控)。

## 6. 升级与回滚

1. 新版本镜像先跑迁移任务(向前兼容的迁移;迁移 runner 拒绝已被修改的
   已应用文件,保证可追溯);
2. 滚动替换 API 副本,观察 `/ready` 与错误率;
3. 替换 worker;
4. 回滚:回滚镜像即可——**不要**回滚数据库迁移;新增列/表保持向后兼容,
   破坏性变更必须拆分为两个发布周期(先停写,后删除)。

## 7. 密钥管理

- 所有 secret(DATABASE_URL、WORKER_TOKEN、WEBHOOK_SECRET_*、OIDC client
  secret)经 secret manager 注入,禁止写入镜像或 repo;
- 轮换 webhook secret 时支持双窗口:新旧 secret 并存一个发布周期;
- DB 口令轮换:先在 PG 侧 `ALTER ROLE ... PASSWORD`,再滚动重启服务。

## 8. 上线前核对清单

- [ ] `NODE_ENV=production` 且无覆盖标志;
- [ ] OIDC issuer/audience/JWKS 与 IdP 一致,token 含 `tenant_id`;
- [ ] 迁移已应用,`schema_migrations` 无失败记录;
- [ ] 审计耐久性配置就绪(`GET /audit-events/durability`,WORM/镜像/TSA);
- [ ] 备份计划与恢复演练完成(见 backup-restore.md);
- [ ] 网关限流、TLS、安全头(产品已内置 CSP/nosniff/frame denial);
- [ ] 告警接通,`/metrics` 被采集;
- [ ] 法务门禁材料(民主程序、告知签收、DPIA)按 PRD LG-01..10 落档。
