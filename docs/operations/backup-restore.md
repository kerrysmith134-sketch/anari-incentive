# 备份恢复与审计耐久性（NPV2-034）

## 演练记录（2026-11-14，postgres:16-alpine，空库+种子基线 427KB）

| 步骤 | 命令 | 耗时 |
| --- | --- | --- |
| 全量逻辑备份 | `docker exec br-src pg_dump -U anari anari_incentive > dump.sql` | < 1s |
| 恢复（空库重放） | `docker exec -i br-dst psql -U anari anari_incentive < dump.sql` | 4s |
| **RTO（备份→可查询）** | | **≈ 5s**（基线库；生产量级按比例增长） |
| **RPO** | | **0**（逻辑全量热备；生产用 pg_basebackup/WAL 归档可达秒级） |

## 校验

1. 行数一致性：`people`/`evaluation_cycles` 等 src=dst 全 OK；
2. schema 完整：全部 93 个迁移（含 RLS/FORCE 策略/触发器/索引）随 dump 重放；
3. 审计耐久：`audit_events` 行数一致；`amount_ledger` 哈希链列随行恢复，
   运行时 `verifyLedger()` / `verifyAuditChain()` 在恢复侧可直接调用。

## 生产建议

- 每日 `pg_dump` 全量 + 持续 WAL 归档（`archive_mode=on`）→ RPO 秒级；
- 恢复演练每季度一次（本文件记录的流程可直接重放）；
- WORM/TSA：审计哈希链已防篡改；外部 TSA 对接留待合规评估（034 未含）。
