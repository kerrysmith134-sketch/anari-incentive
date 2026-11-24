/**
 * Commercial 工作台（2026-11-21 审计 Sprint 3）：
 * Account → Opportunity → Quote → Contract → Order 的可视化生命周期。
 * Deal 只能出现在 Opportunity；Order 必须来自已签合同。
 */
import { useMemo, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Tabs,
  TextInput,
} from "../components/ui.js";
import { api, ApiError } from "../lib/api.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import { formatDateTime } from "../lib/format.js";
import type {
  CommercialAccount,
  CommercialContract,
  CommercialOpportunity,
  CommercialOrder,
  CommercialQuote,
} from "../lib/types.js";

type CreateKind = "account" | "opportunity" | "quote" | "contract" | "order";

interface FormState {
  name: string;
  externalId: string;
  accountId: string;
  opportunityId: string;
  quoteId: string;
  contractId: string;
  currency: string;
  amount: string;
  contractRef: string;
  orderNumber: string;
  description: string;
  quantity: string;
  unitPrice: string;
}

const emptyForm: FormState = {
  name: "",
  externalId: "",
  accountId: "",
  opportunityId: "",
  quoteId: "",
  contractId: "",
  currency: "USD",
  amount: "0",
  contractRef: "",
  orderNumber: "",
  description: "",
  quantity: "1",
  unitPrice: "0",
};

const CREATE_LABEL: Record<CreateKind, string> = {
  account: "新建客户账户",
  opportunity: "新建销售机会",
  quote: "新建报价",
  contract: "新建合同",
  order: "新建订单",
};

export function CommercialPage() {
  useDocumentTitle("Commercial");
  const accounts = useApiQuery<CommercialAccount[]>("/api/v1/commercial/accounts");
  const opportunities = useApiQuery<CommercialOpportunity[]>(
    "/api/v1/commercial/opportunities",
  );
  const quotes = useApiQuery<CommercialQuote[]>("/api/v1/commercial/quotes");
  const contracts = useApiQuery<CommercialContract[]>(
    "/api/v1/commercial/contracts",
  );
  const orders = useApiQuery<CommercialOrder[]>("/api/v1/commercial/orders");

  const [tab, setTab] = useState("accounts");
  const [createKind, setCreateKind] = useState<CreateKind | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accountList = accounts.data ?? [];
  const opportunityList = opportunities.data ?? [];
  const quoteList = quotes.data ?? [];
  const contractList = contracts.data ?? [];
  const orderList = orders.data ?? [];

  const accountName = useMemo(
    () => new Map(accountList.map((account) => [account.id, account.name])),
    [accountList],
  );
  const opportunityName = useMemo(
    () =>
      new Map(
        opportunityList.map((opportunity) => [
          opportunity.id,
          opportunity.name,
        ]),
      ),
    [opportunityList],
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function openCreate(kind: CreateKind) {
    setError(null);
    setCreateKind(kind);
    setForm({
      ...emptyForm,
      accountId: accountList[0]?.id ?? "",
      opportunityId: opportunityList[0]?.id ?? "",
      quoteId: quoteList.find((quote) => quote.status === "ACCEPTED")?.id ?? "",
      contractId:
        contractList.find((contract) => contract.status === "SIGNED")?.id ?? "",
    });
  }

  function reloadAll() {
    accounts.reload();
    opportunities.reload();
    quotes.reload();
    contracts.reload();
    orders.reload();
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!createKind) return;
    setBusy(true);
    setError(null);
    try {
      if (createKind === "account") {
        await api("/api/v1/commercial/accounts", {
          method: "POST",
          body: {
            name: form.name,
            externalAccountId: form.externalId || undefined,
          },
        });
      } else if (createKind === "opportunity") {
        await api("/api/v1/commercial/opportunities", {
          method: "POST",
          body: {
            accountId: form.accountId,
            name: form.name,
            externalOpportunityId: form.externalId || undefined,
            currency: form.currency,
            estimatedAmount: form.amount || undefined,
          },
        });
      } else if (createKind === "quote") {
        await api("/api/v1/commercial/quotes", {
          method: "POST",
          body: {
            opportunityId: form.opportunityId,
            currency: form.currency,
            amount: form.amount,
          },
        });
      } else if (createKind === "contract") {
        await api("/api/v1/commercial/contracts", {
          method: "POST",
          body: {
            accountId: form.accountId,
            opportunityId: form.opportunityId,
            quoteId: form.quoteId,
            contractRef: form.contractRef,
            currency: form.currency,
            amount: form.amount,
          },
        });
      } else {
        await api("/api/v1/commercial/orders", {
          method: "POST",
          body: {
            accountId: form.accountId,
            contractId: form.contractId,
            orderNumber: form.orderNumber,
            currency: form.currency,
            lines: [
              {
                kind: "PRODUCT",
                description: form.description,
                quantity: form.quantity,
                unitPrice: form.unitPrice,
                amount: String(
                  Number(form.quantity) * Number(form.unitPrice),
                ),
                currency: form.currency,
              },
            ],
          },
        });
      }
      setCreateKind(null);
      reloadAll();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function action(path: string) {
    setBusy(true);
    setError(null);
    try {
      await api(path, { method: "POST", body: {} });
      reloadAll();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  const tabs = [
    { id: "accounts", label: "客户", count: accountList.length },
    { id: "opportunities", label: "机会", count: opportunityList.length },
    { id: "quotes", label: "报价", count: quoteList.length },
    { id: "contracts", label: "合同", count: contractList.length },
    { id: "orders", label: "订单", count: orderList.length },
  ];

  return (
    <>
      <PageHeader
        eyebrow="Commercial"
        title="商业对象"
        description="CRM Deal 只进入机会；报价接受→合同签署→订单确认，避免把 Deal 当订单。"
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() =>
              openCreate(
                tab === "opportunities"
                  ? "opportunity"
                  : tab === "quotes"
                    ? "quote"
                    : tab === "contracts"
                      ? "contract"
                      : tab === "orders"
                        ? "order"
                        : "account",
              )
            }
          >
            {CREATE_LABEL[
              tab === "opportunities"
                ? "opportunity"
                : tab === "quotes"
                  ? "quote"
                  : tab === "contracts"
                    ? "contract"
                    : tab === "orders"
                      ? "order"
                      : "account"
            ]}
          </Button>
        }
      />

      {error ? (
        <div style={{ marginBottom: 16 }}>
          <InfoNotice tone="warning">{error}</InfoNotice>
        </div>
      ) : null}

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat-tile stat-tile--accent">
          <div className="stat-tile__top">
            <span className="stat-tile__label">客户账户</span>
          </div>
          <div className="stat-tile__value">{accountList.length}</div>
        </div>
        <div className="stat-tile">
          <div className="stat-tile__top">
            <span className="stat-tile__label">销售机会</span>
          </div>
          <div className="stat-tile__value">{opportunityList.length}</div>
          <div className="stat-tile__detail">
            {opportunityList.filter((item) => item.stage === "WON").length} won
          </div>
        </div>
        <div className="stat-tile stat-tile--warning">
          <div className="stat-tile__top">
            <span className="stat-tile__label">已签合同</span>
          </div>
          <div className="stat-tile__value">
            {contractList.filter((item) => item.status === "SIGNED").length}
          </div>
        </div>
        <div className="stat-tile stat-tile--good">
          <div className="stat-tile__top">
            <span className="stat-tile__label">已确认订单</span>
          </div>
          <div className="stat-tile__value">
            {orderList.filter((item) => item.status === "CONFIRMED").length}
          </div>
        </div>
      </div>

      <Panel>
        <Tabs items={tabs} active={tab} onChange={setTab} label="Commercial 视图" />

        {tab === "accounts" ? (
          accounts.error ? (
            <ErrorNotice error={accounts.error} onRetry={accounts.reload} />
          ) : accounts.loading ? (
            <LoadingRows rows={3} />
          ) : accountList.length === 0 ? (
            <EmptyState icon="building" title="暂无客户账户" description="先建账户，再建机会与报价。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>名称</th>
                    <th>外部 ID</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {accountList.map((account) => (
                    <tr key={account.id}>
                      <td>{account.name}</td>
                      <td className="mono">{account.externalAccountId ?? "—"}</td>
                      <td><Badge status={account.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "opportunities" ? (
          opportunities.error ? (
            <ErrorNotice error={opportunities.error} onRetry={opportunities.reload} />
          ) : opportunityList.length === 0 ? (
            <EmptyState icon="chart" title="暂无机会" description="CRM Deal 应导入为机会，而不是订单。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>机会</th>
                    <th>客户</th>
                    <th>阶段</th>
                    <th>预计金额</th>
                  </tr>
                </thead>
                <tbody>
                  {opportunityList.map((item) => (
                    <tr key={item.id}>
                      <td>{item.name}</td>
                      <td>{accountName.get(item.accountId) ?? item.accountId}</td>
                      <td><Badge status={item.stage} /></td>
                      <td className="mono">
                        {item.estimatedAmount ?? "—"} {item.currency}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "quotes" ? (
          quotes.error ? (
            <ErrorNotice error={quotes.error} onRetry={quotes.reload} />
          ) : quoteList.length === 0 ? (
            <EmptyState icon="policy" title="暂无报价" description="报价可版本化；旧版本只读。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>机会</th>
                    <th>版本</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {quoteList.map((quote) => (
                    <tr key={quote.id}>
                      <td>{opportunityName.get(quote.opportunityId) ?? quote.opportunityId}</td>
                      <td className="mono">v{quote.version}</td>
                      <td className="mono">{quote.amount} {quote.currency}</td>
                      <td><Badge status={quote.status} /></td>
                      <td>
                        {quote.status === "DRAFT" || quote.status === "ISSUED" ? (
                          <div className="row-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                action(`/api/v1/commercial/quotes/${quote.id}/accept`)
                              }
                            >
                              接受
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                action(`/api/v1/commercial/quotes/${quote.id}/void`)
                              }
                            >
                              作废
                            </Button>
                          </div>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "contracts" ? (
          contracts.error ? (
            <ErrorNotice error={contracts.error} onRetry={contracts.reload} />
          ) : contractList.length === 0 ? (
            <EmptyState icon="policy" title="暂无合同" description="合同必须来自已接受报价。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>合同号</th>
                    <th>客户</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {contractList.map((contract) => (
                    <tr key={contract.id}>
                      <td className="mono">{contract.contractRef}</td>
                      <td>{accountName.get(contract.accountId) ?? contract.accountId}</td>
                      <td className="mono">{contract.amount} {contract.currency}</td>
                      <td><Badge status={contract.status} /></td>
                      <td>
                        {contract.status === "DRAFT" ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            disabled={busy}
                            onClick={() =>
                              action(`/api/v1/commercial/contracts/${contract.id}/sign`)
                            }
                          >
                            签署
                          </Button>
                        ) : contract.status === "SIGNED" ? (
                          <div className="row-actions">
                            <span className="muted">
                              {contract.signedAt ? formatDateTime(contract.signedAt) : "—"}
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                action(`/api/v1/commercial/contracts/${contract.id}/terminate`)
                              }
                            >
                              终止
                            </Button>
                          </div>
                        ) : (
                          <span className="muted">
                            {contract.signedAt
                              ? formatDateTime(contract.signedAt)
                              : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}

        {tab === "orders" ? (
          orders.error ? (
            <ErrorNotice error={orders.error} onRetry={orders.reload} />
          ) : orderList.length === 0 ? (
            <EmptyState icon="layers" title="暂无订单" description="订单必须来自已签合同。" />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>订单号</th>
                    <th>客户</th>
                    <th>金额</th>
                    <th>状态</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {orderList.map((order) => (
                    <tr key={order.id}>
                      <td className="mono">{order.orderNumber}</td>
                      <td>{accountName.get(order.accountId) ?? order.accountId}</td>
                      <td className="mono">
                        {order.lines
                          .reduce((sum, line) => sum + Number(line.amount), 0)
                          .toFixed(2)}{" "}
                        {order.currency}
                      </td>
                      <td><Badge status={order.status} /></td>
                      <td>
                        {order.status === "DRAFT" ? (
                          <div className="row-actions">
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() =>
                                action(`/api/v1/commercial/orders/${order.id}/confirm`)
                              }
                            >
                              确认
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() =>
                                action(`/api/v1/commercial/orders/${order.id}/cancel`)
                              }
                            >
                              取消
                            </Button>
                          </div>
                        ) : (
                          <span className="muted">
                            {order.confirmedAt
                              ? formatDateTime(order.confirmedAt)
                              : "—"}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : null}
      </Panel>

      <Modal
        open={createKind !== null}
        title={createKind ? CREATE_LABEL[createKind] : ""}
        onClose={() => setCreateKind(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateKind(null)}>
              取消
            </Button>
            <Button
              variant="primary"
              type="submit"
              form="commercial-create-form"
              loading={busy}
            >
              创建
            </Button>
          </>
        }
      >
        <form id="commercial-create-form" onSubmit={submitCreate}>
          {createKind === "account" || createKind === "opportunity" ? (
            <FormField label="名称" htmlFor="commercial-name">
              <TextInput
                id="commercial-name"
                value={form.name}
                required
                onChange={(event) => update("name", event.target.value)}
              />
            </FormField>
          ) : null}
          {createKind === "opportunity" ? (
            <>
              <FormField label="客户账户" htmlFor="commercial-account">
                <Select
                  id="commercial-account"
                  value={form.accountId}
                  required
                  onChange={(event) => update("accountId", event.target.value)}
                >
                  {accountList.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="外部 Deal ID（可选）" htmlFor="commercial-external">
                <TextInput
                  id="commercial-external"
                  value={form.externalId}
                  onChange={(event) => update("externalId", event.target.value)}
                />
              </FormField>
            </>
          ) : null}
          {createKind === "quote" ? (
            <FormField label="机会" htmlFor="commercial-opportunity">
              <Select
                id="commercial-opportunity"
                value={form.opportunityId}
                required
                onChange={(event) => update("opportunityId", event.target.value)}
              >
                {opportunityList.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </FormField>
          ) : null}
          {createKind === "contract" ? (
            <>
              <FormField label="客户账户" htmlFor="commercial-account">
                <Select
                  id="commercial-account"
                  value={form.accountId}
                  required
                  onChange={(event) => update("accountId", event.target.value)}
                >
                  {accountList.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="机会" htmlFor="commercial-opportunity">
                <Select
                  id="commercial-opportunity"
                  value={form.opportunityId}
                  required
                  onChange={(event) => update("opportunityId", event.target.value)}
                >
                  {opportunityList.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="已接受报价" htmlFor="commercial-quote">
                <Select
                  id="commercial-quote"
                  value={form.quoteId}
                  required
                  onChange={(event) => update("quoteId", event.target.value)}
                >
                  {quoteList
                    .filter((quote) => quote.status === "ACCEPTED")
                    .map((quote) => (
                      <option key={quote.id} value={quote.id}>
                        v{quote.version} · {quote.amount} {quote.currency}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField label="合同号" htmlFor="commercial-contract-ref">
                <TextInput
                  id="commercial-contract-ref"
                  value={form.contractRef}
                  required
                  onChange={(event) => update("contractRef", event.target.value)}
                />
              </FormField>
            </>
          ) : null}
          {createKind === "order" ? (
            <>
              <FormField label="客户账户" htmlFor="commercial-account">
                <Select
                  id="commercial-account"
                  value={form.accountId}
                  required
                  onChange={(event) => update("accountId", event.target.value)}
                >
                  {accountList.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="已签合同" htmlFor="commercial-contract">
                <Select
                  id="commercial-contract"
                  value={form.contractId}
                  required
                  onChange={(event) => update("contractId", event.target.value)}
                >
                  {contractList
                    .filter((contract) => contract.status === "SIGNED")
                    .map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.contractRef}
                      </option>
                    ))}
                </Select>
              </FormField>
              <FormField label="订单号" htmlFor="commercial-order-number">
                <TextInput
                  id="commercial-order-number"
                  value={form.orderNumber}
                  required
                  onChange={(event) => update("orderNumber", event.target.value)}
                />
              </FormField>
              <FormField label="行项目描述" htmlFor="commercial-line-desc">
                <TextInput
                  id="commercial-line-desc"
                  value={form.description}
                  required
                  onChange={(event) => update("description", event.target.value)}
                />
              </FormField>
              <div className="row">
                <FormField label="数量" htmlFor="commercial-qty">
                  <TextInput
                    id="commercial-qty"
                    inputMode="decimal"
                    value={form.quantity}
                    required
                    onChange={(event) => update("quantity", event.target.value)}
                  />
                </FormField>
                <FormField label="单价" htmlFor="commercial-price">
                  <TextInput
                    id="commercial-price"
                    inputMode="decimal"
                    value={form.unitPrice}
                    required
                    onChange={(event) => update("unitPrice", event.target.value)}
                  />
                </FormField>
              </div>
            </>
          ) : null}
          {createKind && createKind !== "account" && createKind !== "opportunity" ? (
            <div className="row">
              <FormField label="金额" htmlFor="commercial-amount">
                <TextInput
                  id="commercial-amount"
                  inputMode="decimal"
                  value={form.amount}
                  required={createKind !== "order"}
                  onChange={(event) => update("amount", event.target.value)}
                />
              </FormField>
              <FormField label="币种" htmlFor="commercial-currency">
                <TextInput
                  id="commercial-currency"
                  value={form.currency}
                  maxLength={3}
                  required
                  onChange={(event) =>
                    update("currency", event.target.value.toUpperCase())
                  }
                />
              </FormField>
            </div>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
