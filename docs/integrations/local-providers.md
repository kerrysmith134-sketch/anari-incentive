# 本地系统 Provider（2026-11-26）

N-Perform 按本地项目真实 API 拉取：

| Provider | 本地项目 | 实际端点 | N-Perform 目标 |
|---|---|---|---|
| anari-erp | Anari-ERP | `/api/finance/ap-payment-plan`、`/ar-collection-plan`、`/margin-portfolio` | `/api/v1/financial-facts` |
| anari-commercial | anari-commercial-sys | `/api/v1/customers`、`/api/v1/quotations`、`/api/v1/orders` | commercial import accounts/quotes/orders |
| anari-crm | anari-ai-crm | `/api/deals`、`/api/companies`、`/api/contacts` | commercial import opportunities/accounts |
| anari-ticketing | anari-ticketing | `/api/v1/admin/tickets` | `/api/v1/work-items/import` |
| anari-hr | anari-hr | `/api/v1/people`、`/legal-entities`、`/organization-units` | `/api/v1/people/import`（人员）；其余只读映射 |
| anari-finance | anari-baoxiao | `/api/v1/reports`、`/payments`、`/vouchers` | `/api/v1/financial-facts` |
| pingcode | PingCode 官方 | `GET /v2/pjm/workitems` | `/api/v1/work-items/import` |

## 运行

```bash
N_PERFORM_BASE_URL=http://127.0.0.1:4000 \
N_PERFORM_TOKEN=<token> \
ANARI_ERP_BASE_URL=http://127.0.0.1:8000 \
ANARI_ERP_TOKEN=<token> \
npx tsx scripts/import-local.ts --provider anari-erp --dry-run
```

去掉 `--dry-run` 才写库。

## 环境变量

- `ANARI_ERP_BASE_URL` / `ANARI_ERP_TOKEN`
- `ANARI_COMMERCIAL_BASE_URL` / `ANARI_COMMERCIAL_TOKEN`
- `ANARI_CRM_BASE_URL` / `ANARI_CRM_TOKEN`（CRM session JWT，会过期）
- `ANARI_TICKETING_BASE_URL` / `ANARI_TICKETING_TOKEN` / `ANARI_TICKETING_PROJECT_ID`
- `ANARI_HR_BASE_URL` / `ANARI_HR_TOKEN`
- `ANARI_FINANCE_BASE_URL` / `ANARI_FINANCE_API_KEY`
- `PINGCODE_BASE_URL` / `PINGCODE_ACCESS_TOKEN`
- `N_PERFORM_BASE_URL` / `N_PERFORM_TOKEN`

## 真实约束

- Commercial 的 quotation 没有 opportunity、order 没有 contract：provider 用稳定派生父键建链（`CUST-<customerId>`、`QUOTE-<quotationId>`、`CONTRACT-<quotationId>`），不是伪造来源外键；源记录仍在 payload/来源 ID 中可追溯。
- Ticketing 响应没有 project：默认投影到 `ANARI-TICKETING` 项目桶；可用 `ANARI_TICKETING_PROJECT_ID` 覆盖。
- HR 人员走幂等 `/api/v1/people/import`；法人/组织架构仍只读（N-Perform 目前没有对应主数据写端点）。
- ERP/Finance 默认 DRAFT。设置 `ANARI_ERP_POSTED=1`（法人、期间、instrument、版本、订单/合同齐全）或 `ANARI_FINANCE_POSTED=1` + `ANARI_FINANCE_LEGAL_ENTITY`/`ANARI_FINANCE_ORDER_ID` 后，才投影为 POSTED。
- PingCode 使用官方 v2：`GET /v2/pjm/workitems`，Bearer token，`page_index` 从 0 开始。
- 首次真实同步建议 `--max-pages 1 --dry-run`，核对字段后再写库。
