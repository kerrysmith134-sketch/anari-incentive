# 财务口径外部研究结论（2026-11-25）

结论：ANARI 的财务没有特殊口径，按通行会计准则处理，不引入自创规则。

## 多法人多币种合并（IAS 21 / ASC 830）

- 境外主体以功能货币记账；合并到集团列报货币时：
  - 资产、负债按**期末汇率**折算；
  - 收入、费用按**平均汇率**折算；
  - 权益按**历史汇率**折算；
  - 折算差额计入**累计折算调整（CTA）**，作为其他综合收益/权益，不进入当期损益。
- 内部往来（IC AR/AP）在合并时按期末汇率折算后对冲，差额必须为 0；不平即数据错误，不能挤进 CTA。
- 参考：
  - [PwC Viewpoint — ASC 830 translation](https://viewpoint.pwc.com/dt/us/en/pwc/accounting_guides/foreign_currency/foreign_currency__2_US/chapter_5_translatin_US/53_translation_when__US.html)
  - [PwC — foreign exchange differences in OCI](https://viewpoint.pwc.com/dt/gx/en/pwc/industry/corporate_treasury/ifrs-accounting-standards/assets/IFRS_R_Accounting_Standards_hot_topics_for_treasure_centres_FINAL_updated.pdf)
  - [IAS 21 average/closing rate example](https://www.ifrs.org/content/dam/ifrs/meetings/2023/june/ifric/ap05-consolidation-of-a-non-hyperinflationary-subsidiary-by-a-hyperinflationary-parent.pdf)

## 应收账款账龄与坏账（IFRS 9 简化法）

- 贸易应收款按账龄矩阵计提**终身预期信用损失（ECL）**，不绕过分阶段。
- 默认矩阵：CURRENT 0%、1–30 天 2%、31–60 天 5%、61–90 天 10%、90+ 50%；可按主体/组合覆盖。
- 核销只冲减已被证明不可收回的余额，并保留审计链。
- 参考：
  - [IFRS 9 simplified approach / provision matrix](https://farahatco.com/blog/calculate-bad-debt-provision-under-ifrs-9/)

## 复式记账

- 每张发票、收款、退款、冲销、FX 重估、坏账计提/核销都生成借贷平衡的 GL 凭证；借贷不等返回 409，不允许只写单边。
- 子账（AR/收入/税/现金/汇兑损益/坏账准备）与 GL 使用同一 `documentId` 关联，支持按单据追溯。

## 不做的事

- 非 CNY payroll 的当地法定税社保：业务明确不需要；系统继续显式标记 `statutoryCurrencyUnsupported`，不静默套用中国口径。
