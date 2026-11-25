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

- Commercial 的 quotation 没有 opportunity、order 没有 contract：provider 明确跳过，不用 customer/quotation 伪造父关系。
- Ticketing 响应没有 project：必须配置 `ANARI_TICKETING_PROJECT_ID`，否则不导入。
- HR 只写人员；法人/组织架构没有 N-Perform 写端点，只读映射。
- ERP/Finance 的 AP/AR/报销/付款事实默认 DRAFT；只有来源具备法人、期间、instrument、版本和订单/合同时才 POSTED。
- PingCode 使用官方 v2：`GET /v2/pjm/workitems`，Bearer token，`page_index` 从 0 开始。
- 首次真实同步建议 `--max-pages 1 --dry-run`，核对字段后再写库。
