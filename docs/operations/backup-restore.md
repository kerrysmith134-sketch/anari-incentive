# 备份与恢复 runbook

> 目标:单区域部署下,RPO ≤ 15 分钟、RTO ≤ 1 小时。审计链的耐久性
> (WORM/镜像/TSA)另见 [`audit-durability.md`](audit-durability.md)。

## 1. 备份什么

| 数据 | 方式 | 频率 | 保留 |
|---|---|---|---|
| PostgreSQL(全部业务/治理/审计表) | `pg_dump --format=custom`(逻辑备份)+ WAL 归档(PITR) | 每日全量 + 连续 WAL | 全量 30 天,WAL 14 天 |
| 迁移状态(`schema_migrations`) | 随库备份 | 同上 | 同上 |
| 配置/密钥 | secret manager 的托管备份 | 变更时 | 按平台 |
| 对象证据(若外置对象存储) | 存储服务版本化/复制 | 持续 | 按类别保留期 |

产品本身无状态(API/worker 均可随时重建),**唯一必须备份的是数据库**。

## 2. 备份执行

```bash
# 每日全量(cron 02:00 低峰)
pg_dump --format=custom --compress=9 \
  --dbname="postgres://anari_backup@db-host:5432/anari_incentive" \
  --file="anari_incentive_$(date +%F).dump"

# 校验备份可读且包含关键资金路径表
pg_restore --list anari_incentive_$(date +%F).dump | grep -E \
  "calculation_lines|ledger_entries|settlement_lines|audit_events|schema_migrations"
```

要求:

- 备份角色只授予 `pg_read_all_data`(或按表的 SELECT),不使用 superuser;
- 备份写入独立的存储账户/桶,与生产隔离,启用版本化与防删锁(如支持);
- WAL 归档(`archive_command` 或托管服务的 PITR)必须开启,否则 15 分钟
  RPO 不成立。

## 3. 恢复演练(每 90 天执行一次并记录)

```bash
# 1) 在隔离环境恢复到时间点
createdb anari_restore_test
pg_restore --dbname=anari_restore_test --no-owner --role=anari_app \
  anari_incentive_<date>.dump
# 或 PITR(托管服务用控制台恢复到 restore_test 实例)

# 2) 完整性验证
psql -d anari_restore_test -c "SELECT count(*) FROM schema_migrations;"
# 审计链可验证:启动 API(指向恢复库)后
curl -s -H "authorization: Bearer <token>" \
  "$API/api/v1/audit-events/verify" | jq .data.valid   # 必须为 true
# 账本链可验证
curl -s -H "authorization: Bearer <token>" \
  "$API/api/v1/ledger/verify" | jq .data.valid          # 必须为 true

# 3) 记录演练时间与结果(供 MON-07/AUDIT_RESTORE_DRILL_AT 配置引用)
```

演练记录建议写入 `AUDIT_RESTORE_DRILL_AT`(ISO 日期),`GET
/audit-events/durability` 会把它纳入就绪报告。

## 4. 灾难恢复(真实故障)

1. 供给新数据库实例(同版本 PostgreSQL 16);
2. 恢复最近全量 + 重放 WAL 到故障前最后一次提交;
3. `npm run db:migrate`(幂等,应显示全部已应用);
4. 以恢复库连接串启动 API/worker,执行 §3 的两条链校验;
5. 切流(网关指向新实例),观察 `/ready` 与错误率;
6. 事后:补录事件单,核对结算批次与账本是否需要冻结审计。

## 5. 红线

- 禁止 `pg_dump` 之外的工具绕过权限直拷数据文件(会带出 RLS 外数据);
- 禁止在生产库上用 superuser 恢复(`--role=anari_app` 保持 RLS 语义);
- 恢复出的数据包含个人数据,演练环境同样受保留期/访问控制约束,演练完
  按保留策略销毁。
