# 备份恢复与审计耐久性（NPV2-034）

> 本文区分本地演练结果和生产恢复目标。小型本地 dump/restore 的观察值不能作为生产 RPO/RTO 承诺。

## 最近一次已记录演练（2026-11-27）

- PostgreSQL 16；迁移基线 **001–121**。
- 122 号迁移在演练时已存在于仓库，但脚本显式以 `DRILL_MAX_MIGRATION=121` 排除；因此该演练**不覆盖 122**。
- 在线逻辑备份：`pg_dump --format=plain --no-owner`；恢复到全新容器和数据库。
- 样本 dump 约 570 KB；备份后至恢复库可查询观察值约 **1.768 秒**（本地 Docker / SSD / 小数据集）。
- 校验包含：迁移版本与 checksum、76 项 schema 指纹、144 条 RLS policies、144 张 FORCE RLS 表、29 个 trigger、23 张代表表行数与数据指纹、GL 平衡、奖励支付与批次行、JEV 证据/决定、审计与账本哈希链，以及恢复后以 `NOBYPASSRLS` 应用角色执行的 RLS 负向检查。

完整逐项日志与边界说明见 [`../runbooks/backup-restore-drill-2026-11-27.md`](../runbooks/backup-restore-drill-2026-11-27.md)。

## RPO / RTO 口径

- 本次逻辑备份只证明 **dump 时间点的数据可以恢复**；没有启用或验证连续 WAL 归档，因此不能声称生产 RPO=0，也不能声称生产 RPO 为秒级。
- 若生产仅每日逻辑全量备份，最坏 RPO 约等于备份间隔；要实现秒/分钟级 PITR，必须配置并监控连续 WAL 归档，并以恢复演练证明。
- 1.768 秒只适用于本次约 570 KB 的本地样本，不能外推为生产 RTO。生产 RTO 必须包括异地传输、镜像拉取、数据库体量、索引重建、应用恢复、DNS/凭据切换和人工决策窗口。

## 发布门禁

每次 schema 发布必须执行：

1. 从空库应用全部迁移并校验 manifest/checksum；
2. 从上一生产版本执行 upgrade path；
3. 进行全新数据库 restore drill，并验证账本、审计链、GL 平衡、RLS 和关键业务数据；
4. 演练基线必须与候选 release 的**最高 migration 一致**。若发布候选包含 122，必须重新执行：

```bash
DRILL_MAX_MIGRATION=122 bash scripts/backup-restore-drill.sh
```

5. 将演练日志、快照 ID、源/目标版本、checksum、恢复库验证结果和负责人归档。不能用旧的 121 基线记录替代 122。

## 生产建议

- PostgreSQL PITR：连续 WAL 归档 + 定期 base backup + 每日逻辑/物理快照；备份加密并复制至独立账号/项目。
- 审计耐久：配置 WORM/Object Lock、异地第二副本和 TSA/独立锚定；应用角色不能删除归档。
- 季度恢复演练，且在数据库大版本、关键迁移或存储架构变更后额外演练。
- `GET /api/v1/audit-events/durability` 仅证明部署配置项存在，不证明对象锁、镜像或 TSA 收据真实有效；必须保留实际策略导出与回执。
- 生产 RPO/RTO 目标需由业务与运维共同批准，并在生产规模数据集上实测，不得引用本地小样本的观察值作为 SLA。