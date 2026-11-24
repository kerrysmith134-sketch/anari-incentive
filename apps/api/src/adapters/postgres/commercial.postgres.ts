/**
 * Commercial 域 PostgreSQL Adapter（Sprint 3）。
 */
import { randomUUID } from "node:crypto";
import type { Pool, QueryResultRow } from "pg";
import {
  assertOrderMayBeConfirmed,
  CommercialLifecycleError,
  type Account,
  type CommercialOrder,
  type Contract,
  type Opportunity,
  type OrderLine,
  type Quote,
} from "@anari/domain";
import { ConflictError } from "../../store.js";
import { formatDecimal, mul, parseDecimal } from "@anari/policy-dsl";
import { iso, isoDate, now, notFound, decimalText } from "../shared.js";
import type { CommercialPort } from "../../store-ports.js";
import type { PgPlatformStoreBase, PgPlatformStoreBaseShape } from "./base.postgres.js";

function lifecycleConflict(error: unknown): never {
  if (error instanceof CommercialLifecycleError) {
    throw new ConflictError(`${error.code}: ${error.message}`);
  }
  throw error;
}

export function PgCommercialMixin(
  Base: abstract new (
    ...args: ConstructorParameters<typeof PgPlatformStoreBase>
  ) => PgPlatformStoreBaseShape,
) {
  return class extends Base implements CommercialPort {
    private mapAccount(row: QueryResultRow): Account {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        externalAccountId: row.external_account_id ?? undefined,
        name: row.name,
        status: row.status,
        ownerPersonId: row.owner_person_id ?? undefined,
      };
    }

    private mapOpportunity(row: QueryResultRow): Opportunity {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        accountId: row.account_id,
        externalOpportunityId: row.external_opportunity_id ?? undefined,
        name: row.name,
        stage: row.stage,
        estimatedAmount:
          row.estimated_amount === null || row.estimated_amount === undefined
            ? undefined
            : decimalText(String(row.estimated_amount)),
        currency: String(row.currency).trim(),
        ownerPersonId: row.owner_person_id ?? undefined,
      };
    }

    private mapQuote(row: QueryResultRow): Quote {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        opportunityId: row.opportunity_id,
        version: Number(row.version),
        status: row.status,
        currency: String(row.currency).trim(),
        amount: decimalText(String(row.amount)) ?? "0",
        issuedAt: iso(row.issued_at),
        acceptedAt: iso(row.accepted_at),
        supersedesQuoteId: row.supersedes_quote_id ?? undefined,
      };
    }

    private mapContract(row: QueryResultRow): Contract {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        accountId: row.account_id,
        opportunityId: row.opportunity_id,
        quoteId: row.quote_id,
        contractRef: row.contract_ref,
        status: row.status,
        signedAt: iso(row.signed_at),
        currency: String(row.currency).trim(),
        amount: decimalText(String(row.amount)) ?? "0",
      };
    }

    private mapOrderLine(row: QueryResultRow): OrderLine {
      return {
        id: row.id,
        orderId: row.order_id,
        kind: row.kind,
        description: row.description,
        quantity: decimalText(String(row.quantity)) ?? "0",
        unitPrice: decimalText(String(row.unit_price)) ?? "0",
        amount: decimalText(String(row.amount)) ?? "0",
        currency: String(row.currency).trim(),
      };
    }

    private mapOrder(row: QueryResultRow, lines: OrderLine[]): CommercialOrder {
      return {
        id: row.id,
        tenantId: row.tenant_id,
        accountId: row.account_id,
        contractId: row.contract_id,
        orderNumber: row.order_number,
        status: row.status,
        currency: String(row.currency).trim(),
        confirmedAt: iso(row.confirmed_at),
        lines,
      };
    }

    async createAccount(input: {
      tenantId: string;
      externalAccountId?: string;
      name: string;
      ownerPersonId?: string;
    }): Promise<Account> {
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO commercial_accounts
           (tenant_id, external_account_id, name, owner_person_id)
         VALUES ($1,$2,$3,$4)
         RETURNING *`,
        [
          input.tenantId,
          input.externalAccountId ?? null,
          input.name,
          input.ownerPersonId ?? null,
        ],
      );
      return this.mapAccount(rows[0]);
    }

    async listAccounts(tenantId: string): Promise<Account[]> {
      const { rows } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM commercial_accounts WHERE tenant_id=$1 ORDER BY name ASC",
        [tenantId],
      );
      return rows.map((row: QueryResultRow) => this.mapAccount(row));
    }

    async createOpportunity(input: {
      tenantId: string;
      accountId: string;
      externalOpportunityId?: string;
      name: string;
      stage?: Opportunity["stage"];
      estimatedAmount?: string;
      currency: string;
      ownerPersonId?: string;
    }): Promise<Opportunity> {
      await this.assertCommercialAccount(input.tenantId, input.accountId);
      const { rows } = await this.tenantQuery(
        input.tenantId,
        `INSERT INTO commercial_opportunities
           (tenant_id, account_id, external_opportunity_id, name, stage,
            estimated_amount, currency, owner_person_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         RETURNING *`,
        [
          input.tenantId,
          input.accountId,
          input.externalOpportunityId ?? null,
          input.name,
          input.stage ?? "QUALIFIED",
          input.estimatedAmount ?? null,
          input.currency.toUpperCase(),
          input.ownerPersonId ?? null,
        ],
      );
      return this.mapOpportunity(rows[0]);
    }

    async listOpportunities(
      tenantId: string,
      accountId?: string,
    ): Promise<Opportunity[]> {
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM commercial_opportunities WHERE tenant_id=$1";
      if (accountId) {
        params.push(accountId);
        sql += " AND account_id=$2";
      }
      sql += " ORDER BY name ASC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapOpportunity(row));
    }

    async upsertCommercialAccount(input: {
      tenantId: string;
      sourceSystem: string;
      externalAccountId: string;
      name: string;
      ownerPersonId?: string;
    }): Promise<{ account: Account; created: boolean }> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: existing } = await client.query(
          `SELECT * FROM commercial_accounts
            WHERE tenant_id=$1 AND source_system=$2 AND external_account_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalAccountId],
        );
        if (existing[0]) {
          const { rows } = await client.query(
            `UPDATE commercial_accounts
                SET name=$3, owner_person_id=COALESCE($4, owner_person_id), updated_at=now()
              WHERE tenant_id=$1 AND id=$2
              RETURNING *`,
            [input.tenantId, existing[0].id, input.name, input.ownerPersonId ?? null],
          );
          return { account: this.mapAccount(rows[0]), created: false };
        }
        const { rows } = await client.query(
          `INSERT INTO commercial_accounts
             (tenant_id, source_system, external_account_id, name, owner_person_id)
           VALUES ($1,$2,$3,$4,$5)
           RETURNING *`,
          [
            input.tenantId,
            input.sourceSystem,
            input.externalAccountId,
            input.name,
            input.ownerPersonId ?? null,
          ],
        );
        return { account: this.mapAccount(rows[0]), created: true };
      });
    }

    async upsertCommercialOpportunity(input: {
      tenantId: string;
      sourceSystem: string;
      externalAccountId: string;
      accountName: string;
      externalOpportunityId: string;
      name: string;
      stage?: Opportunity["stage"];
      estimatedAmount?: string;
      currency: string;
      ownerPersonId?: string;
    }): Promise<{
      account: Account;
      opportunity: Opportunity;
      created: boolean;
    }> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: accounts } = await client.query(
          `SELECT * FROM commercial_accounts
            WHERE tenant_id=$1 AND source_system=$2 AND external_account_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalAccountId],
        );
        let accountRow = accounts[0];
        if (!accountRow) {
          const { rows } = await client.query(
            `INSERT INTO commercial_accounts
               (tenant_id, source_system, external_account_id, name, owner_person_id)
             VALUES ($1,$2,$3,$4,$5)
             RETURNING *`,
            [
              input.tenantId,
              input.sourceSystem,
              input.externalAccountId,
              input.accountName,
              input.ownerPersonId ?? null,
            ],
          );
          accountRow = rows[0];
        }
        const { rows: opportunities } = await client.query(
          `SELECT * FROM commercial_opportunities
            WHERE tenant_id=$1 AND source_system=$2 AND external_opportunity_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalOpportunityId],
        );
        if (opportunities[0]) {
          const { rows } = await client.query(
            `UPDATE commercial_opportunities
                SET account_id=$3, name=$4, stage=COALESCE($5, stage),
                    estimated_amount=COALESCE($6, estimated_amount),
                    currency=$7, owner_person_id=COALESCE($8, owner_person_id),
                    updated_at=now()
              WHERE tenant_id=$1 AND id=$2
              RETURNING *`,
            [
              input.tenantId,
              opportunities[0].id,
              accountRow.id,
              input.name,
              input.stage ?? null,
              input.estimatedAmount ?? null,
              input.currency.toUpperCase(),
              input.ownerPersonId ?? null,
            ],
          );
          return {
            account: this.mapAccount(accountRow),
            opportunity: this.mapOpportunity(rows[0]),
            created: false,
          };
        }
        const { rows } = await client.query(
          `INSERT INTO commercial_opportunities
             (tenant_id, account_id, source_system, external_opportunity_id,
              name, stage, estimated_amount, currency, owner_person_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            input.tenantId,
            accountRow.id,
            input.sourceSystem,
            input.externalOpportunityId,
            input.name,
            input.stage ?? "QUALIFIED",
            input.estimatedAmount ?? null,
            input.currency.toUpperCase(),
            input.ownerPersonId ?? null,
          ],
        );
        return {
          account: this.mapAccount(accountRow),
          opportunity: this.mapOpportunity(rows[0]),
          created: true,
        };
      });
    }

    async createQuote(input: {
      tenantId: string;
      opportunityId: string;
      currency: string;
      amount: string;
      issuedAt?: string;
      supersedesQuoteId?: string;
    }): Promise<Quote> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: opportunities } = await client.query(
          "SELECT * FROM commercial_opportunities WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [input.tenantId, input.opportunityId],
        );
        if (!opportunities[0]) notFound("CommercialOpportunity", input.opportunityId);
        let version = 1;
        if (input.supersedesQuoteId) {
          const { rows: previous } = await client.query(
            "SELECT * FROM commercial_quotes WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
            [input.tenantId, input.supersedesQuoteId],
          );
          if (!previous[0]) notFound("CommercialQuote", input.supersedesQuoteId);
          if (
            previous[0].status === "ACCEPTED" ||
            previous[0].status === "REJECTED"
          ) {
            throw new ConflictError(
              `QUOTE_NOT_REVISABLE: quote ${previous[0].id} is ${previous[0].status}; accepted/rejected quotes are immutable`,
            );
          }
          if (previous[0].opportunity_id !== input.opportunityId) {
            throw new ConflictError(
              "QUOTE_OPPORTUNITY_MISMATCH: superseded quote belongs to another opportunity",
            );
          }
          version = Number(previous[0].version) + 1;
        } else {
          const { rows: existing } = await client.query(
            "SELECT 1 FROM commercial_quotes WHERE tenant_id=$1 AND opportunity_id=$2 LIMIT 1",
            [input.tenantId, input.opportunityId],
          );
          if (existing[0]) {
            throw new ConflictError(
              "QUOTE_VERSION_REQUIRES_SUPERSEDES: create a revision with supersedesQuoteId",
            );
          }
        }
        const { rows } = await client.query(
          `INSERT INTO commercial_quotes
             (tenant_id, opportunity_id, version, status, currency, amount,
              issued_at, supersedes_quote_id)
           VALUES ($1,$2,$3,'DRAFT',$4,$5,$6,$7)
           RETURNING *`,
          [
            input.tenantId,
            input.opportunityId,
            version,
            input.currency.toUpperCase(),
            input.amount,
            input.issuedAt ?? null,
            input.supersedesQuoteId ?? null,
          ],
        );
        return this.mapQuote(rows[0]);
      });
    }

    async upsertCommercialQuote(input: {
      tenantId: string;
      sourceSystem: string;
      externalOpportunityId: string;
      externalQuoteId: string;
      currency: string;
      amount: string;
      status?: Quote["status"];
      issuedAt?: string;
      acceptedAt?: string;
    }): Promise<{ quote: Quote; created: boolean }> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: opportunities } = await client.query(
          `SELECT * FROM commercial_opportunities
            WHERE tenant_id=$1 AND source_system=$2 AND external_opportunity_id=$3`,
          [input.tenantId, input.sourceSystem, input.externalOpportunityId],
        );
        if (!opportunities[0]) {
          notFound("CommercialOpportunity", input.externalOpportunityId);
        }
        const { rows: existing } = await client.query(
          `SELECT * FROM commercial_quotes
            WHERE tenant_id=$1 AND source_system=$2 AND external_quote_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalQuoteId],
        );
        if (existing[0]) {
          const { rows } = await client.query(
            `UPDATE commercial_quotes
                SET amount=$3, currency=$4,
                    status=COALESCE($5, status),
                    issued_at=COALESCE($6, issued_at),
                    accepted_at=COALESCE($7, accepted_at),
                    updated_at=now()
              WHERE tenant_id=$1 AND id=$2
              RETURNING *`,
            [
              input.tenantId,
              existing[0].id,
              input.amount,
              input.currency.toUpperCase(),
              input.status ?? null,
              input.issuedAt ?? null,
              input.acceptedAt ?? null,
            ],
          );
          return { quote: this.mapQuote(rows[0]), created: false };
        }
        const { rows: versions } = await client.query(
          "SELECT COALESCE(MAX(version),0) + 1 AS next FROM commercial_quotes WHERE tenant_id=$1 AND opportunity_id=$2",
          [input.tenantId, opportunities[0].id],
        );
        const { rows } = await client.query(
          `INSERT INTO commercial_quotes
             (tenant_id, opportunity_id, version, status, currency, amount,
              issued_at, accepted_at, source_system, external_quote_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           RETURNING *`,
          [
            input.tenantId,
            opportunities[0].id,
            Number(versions[0].next),
            input.status ?? "DRAFT",
            input.currency.toUpperCase(),
            input.amount,
            input.issuedAt ?? null,
            input.acceptedAt ?? null,
            input.sourceSystem,
            input.externalQuoteId,
          ],
        );
        return { quote: this.mapQuote(rows[0]), created: true };
      });
    }

    async listQuotes(tenantId: string, opportunityId?: string): Promise<Quote[]> {
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM commercial_quotes WHERE tenant_id=$1";
      if (opportunityId) {
        params.push(opportunityId);
        sql += " AND opportunity_id=$2";
      }
      sql += " ORDER BY version DESC, id ASC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapQuote(row));
    }

    async acceptQuote(tenantId: string, quoteId: string): Promise<Quote> {
      const { rows } = await this.tenantQuery(
        tenantId,
        `UPDATE commercial_quotes
            SET status='ACCEPTED', accepted_at=COALESCE(accepted_at, now()), updated_at=now()
          WHERE tenant_id=$1 AND id=$2
            AND status IN ('DRAFT','ISSUED')
          RETURNING *`,
        [tenantId, quoteId],
      );
      if (rows[0]) return this.mapQuote(rows[0]);
      const { rows: current } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM commercial_quotes WHERE tenant_id=$1 AND id=$2",
        [tenantId, quoteId],
      );
      if (!current[0]) notFound("CommercialQuote", quoteId);
      if (current[0].status === "ACCEPTED") return this.mapQuote(current[0]);
      throw new ConflictError(`QUOTE_NOT_ACCEPTABLE: ${current[0].status}`);
    }

    async voidQuote(tenantId: string, quoteId: string): Promise<Quote> {
      const { rows } = await this.tenantQuery(
        tenantId,
        `UPDATE commercial_quotes
            SET status='REJECTED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status IN ('DRAFT','ISSUED')
          RETURNING *`,
        [tenantId, quoteId],
      );
      if (rows[0]) return this.mapQuote(rows[0]);
      const { rows: current } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM commercial_quotes WHERE tenant_id=$1 AND id=$2",
        [tenantId, quoteId],
      );
      if (!current[0]) notFound("CommercialQuote", quoteId);
      if (current[0].status === "REJECTED") return this.mapQuote(current[0]);
      throw new ConflictError(`QUOTE_NOT_VOIDABLE: ${current[0].status}`);
    }

    async createContract(input: {
      tenantId: string;
      accountId: string;
      opportunityId: string;
      quoteId: string;
      contractRef: string;
      currency: string;
      amount: string;
    }): Promise<Contract> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: accounts } = await client.query(
          "SELECT * FROM commercial_accounts WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.accountId],
        );
        if (!accounts[0]) notFound("CommercialAccount", input.accountId);
        const { rows: opportunities } = await client.query(
          "SELECT * FROM commercial_opportunities WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, input.opportunityId],
        );
        if (!opportunities[0]) notFound("CommercialOpportunity", input.opportunityId);
        const { rows: quotes } = await client.query(
          "SELECT * FROM commercial_quotes WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [input.tenantId, input.quoteId],
        );
        if (!quotes[0]) notFound("CommercialQuote", input.quoteId);
        const quote = quotes[0];
        if (
          opportunities[0].account_id !== input.accountId ||
          quote.opportunity_id !== input.opportunityId
        ) {
          throw new ConflictError(
            "CONTRACT_QUOTE_MISMATCH: contract must reference the same account/opportunity/quote",
          );
        }
        if (quote.status !== "ACCEPTED") {
          throw new ConflictError(
            `QUOTE_NOT_ACCEPTED: quote ${quote.id} is ${quote.status}`,
          );
        }
        const contractAmount = formatDecimal(parseDecimal(String(input.amount)));
        if (String(quote.currency).trim() !== input.currency.toUpperCase()) {
          throw new ConflictError(
            `CONTRACT_CURRENCY_MISMATCH: quote ${String(quote.currency).trim()}, contract ${input.currency}`,
          );
        }
        if (formatDecimal(parseDecimal(String(quote.amount))) !== contractAmount) {
          throw new ConflictError(
            `CONTRACT_QUOTE_AMOUNT_MISMATCH: quote ${formatDecimal(parseDecimal(String(quote.amount)))}, contract ${contractAmount}`,
          );
        }
        const { rows } = await client.query(
          `INSERT INTO commercial_contracts
             (tenant_id, account_id, opportunity_id, quote_id, contract_ref,
              status, currency, amount)
           VALUES ($1,$2,$3,$4,$5,'DRAFT',$6,$7)
           RETURNING *`,
          [
            input.tenantId,
            input.accountId,
            input.opportunityId,
            input.quoteId,
            input.contractRef,
            input.currency.toUpperCase(),
            input.amount,
          ],
        );
        return this.mapContract(rows[0]);
      });
    }

    async signContract(tenantId: string, contractId: string): Promise<Contract> {
      const { rows } = await this.tenantQuery(
        tenantId,
        `UPDATE commercial_contracts
            SET status='SIGNED', signed_at=COALESCE(signed_at, now()), updated_at=now()
          WHERE tenant_id=$1 AND id=$2
            AND status='DRAFT'
          RETURNING *`,
        [tenantId, contractId],
      );
      if (rows[0]) return this.mapContract(rows[0]);
      const { rows: current } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM commercial_contracts WHERE tenant_id=$1 AND id=$2",
        [tenantId, contractId],
      );
      if (!current[0]) notFound("CommercialContract", contractId);
      if (current[0].status === "SIGNED") return this.mapContract(current[0]);
      throw new ConflictError(`CONTRACT_NOT_SIGNABLE: ${current[0].status}`);
    }

    async terminateContract(tenantId: string, contractId: string): Promise<Contract> {
      return this.transactionFor(tenantId, async (client) => {
        const { rows: contracts } = await client.query(
          "SELECT * FROM commercial_contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenantId, contractId],
        );
        if (!contracts[0]) notFound("CommercialContract", contractId);
        if (contracts[0].status === "TERMINATED") {
          return this.mapContract(contracts[0]);
        }
        if (contracts[0].status !== "SIGNED") {
          throw new ConflictError(`CONTRACT_NOT_TERMINABLE: ${contracts[0].status}`);
        }
        const { rows: confirmed } = await client.query(
          "SELECT 1 FROM commercial_orders WHERE tenant_id=$1 AND contract_id=$2 AND status='CONFIRMED' LIMIT 1",
          [tenantId, contractId],
        );
        if (confirmed[0]) {
          throw new ConflictError(
            "CONTRACT_HAS_CONFIRMED_ORDER: cancel the order before terminating",
          );
        }
        const { rows } = await client.query(
          "UPDATE commercial_contracts SET status='TERMINATED', updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *",
          [tenantId, contractId],
        );
        return this.mapContract(rows[0]);
      });
    }

    async upsertCommercialContract(input: {
      tenantId: string;
      sourceSystem: string;
      externalContractId: string;
      externalQuoteId: string;
      contractRef: string;
      currency: string;
      amount: string;
      status?: Contract["status"];
      signedAt?: string;
    }): Promise<{ contract: Contract; created: boolean }> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: quotes } = await client.query(
          `SELECT * FROM commercial_quotes
            WHERE tenant_id=$1 AND source_system=$2 AND external_quote_id=$3`,
          [input.tenantId, input.sourceSystem, input.externalQuoteId],
        );
        if (!quotes[0]) notFound("CommercialQuote", input.externalQuoteId);
        const quote = quotes[0];
        const { rows: opportunities } = await client.query(
          "SELECT * FROM commercial_opportunities WHERE tenant_id=$1 AND id=$2",
          [input.tenantId, quote.opportunity_id],
        );
        if (!opportunities[0]) notFound("CommercialOpportunity", quote.opportunity_id);
        const { rows: existing } = await client.query(
          `SELECT * FROM commercial_contracts
            WHERE tenant_id=$1 AND source_system=$2 AND external_contract_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalContractId],
        );
        if (existing[0]) {
          const { rows } = await client.query(
            `UPDATE commercial_contracts
                SET contract_ref=$3, status=COALESCE($4, status),
                    signed_at=COALESCE($5, signed_at), amount=$6, currency=$7,
                    updated_at=now()
              WHERE tenant_id=$1 AND id=$2
              RETURNING *`,
            [
              input.tenantId,
              existing[0].id,
              input.contractRef,
              input.status ?? null,
              input.signedAt ?? null,
              input.amount,
              input.currency.toUpperCase(),
            ],
          );
          return { contract: this.mapContract(rows[0]), created: false };
        }
        if (quote.status !== "ACCEPTED") {
          throw new ConflictError(
            `QUOTE_NOT_ACCEPTED: quote ${quote.id} is ${quote.status}`,
          );
        }
        const { rows } = await client.query(
          `INSERT INTO commercial_contracts
             (tenant_id, account_id, opportunity_id, quote_id, contract_ref,
              status, signed_at, currency, amount, source_system, external_contract_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
           RETURNING *`,
          [
            input.tenantId,
            quote.account_id ?? opportunities[0].account_id,
            quote.opportunity_id,
            quote.id,
            input.contractRef,
            input.status ?? "DRAFT",
            input.signedAt ??
              (input.status === "SIGNED" ? new Date().toISOString() : null),
            input.currency.toUpperCase(),
            input.amount,
            input.sourceSystem,
            input.externalContractId,
          ],
        );
        return { contract: this.mapContract(rows[0]), created: true };
      });
    }

    async listContracts(tenantId: string, accountId?: string): Promise<Contract[]> {
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM commercial_contracts WHERE tenant_id=$1";
      if (accountId) {
        params.push(accountId);
        sql += " AND account_id=$2";
      }
      sql += " ORDER BY contract_ref DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      return rows.map((row: QueryResultRow) => this.mapContract(row));
    }

    async createOrder(input: {
      tenantId: string;
      accountId: string;
      contractId: string;
      orderNumber: string;
      currency: string;
      lines: Array<{
        kind: OrderLine["kind"];
        description: string;
        quantity: string;
        unitPrice: string;
        amount: string;
        currency: string;
      }>;
    }): Promise<CommercialOrder> {
      if (input.lines.length === 0) throw new ConflictError("ORDER_LINES_REQUIRED");
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: contracts } = await client.query(
          "SELECT * FROM commercial_contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [input.tenantId, input.contractId],
        );
        if (!contracts[0]) notFound("CommercialContract", input.contractId);
        const contract = contracts[0];
        if (contract.account_id !== input.accountId) {
          throw new ConflictError(
            "ORDER_CONTRACT_MISMATCH: order account does not match contract",
          );
        }
        if (contract.status !== "SIGNED") {
          throw new ConflictError(
            `CONTRACT_NOT_SIGNED: contract ${contract.id} is ${contract.status}`,
          );
        }
        if (input.currency.toUpperCase() !== String(contract.currency).trim()) {
          throw new ConflictError(
            `ORDER_CURRENCY_MISMATCH: contract ${String(contract.currency).trim()}, order ${input.currency}`,
          );
        }
        let orderTotal = 0n;
        for (const line of input.lines) {
          if (line.currency.toUpperCase() !== input.currency.toUpperCase()) {
            throw new ConflictError(
              `ORDER_LINE_CURRENCY_MISMATCH: order ${input.currency}, line ${line.currency}`,
            );
          }
          const expected = mul(parseDecimal(line.quantity), parseDecimal(line.unitPrice));
          if (expected !== parseDecimal(line.amount)) {
            throw new ConflictError(
              `ORDER_LINE_AMOUNT_MISMATCH: quantity × unitPrice = ${formatDecimal(expected)}, line amount ${line.amount}`,
            );
          }
          orderTotal += parseDecimal(line.amount);
        }
        if (orderTotal > parseDecimal(String(contract.amount))) {
          throw new ConflictError(
            `ORDER_EXCEEDS_CONTRACT: order ${formatDecimal(orderTotal)} > contract ${formatDecimal(parseDecimal(String(contract.amount)))}`,
          );
        }
        const { rows: orders } = await client.query(
          `INSERT INTO commercial_orders
             (tenant_id, account_id, contract_id, order_number, status, currency)
           VALUES ($1,$2,$3,$4,'DRAFT',$5)
           RETURNING *`,
          [
            input.tenantId,
            input.accountId,
            input.contractId,
            input.orderNumber,
            input.currency.toUpperCase(),
          ],
        );
        const order = orders[0];
        const lines: OrderLine[] = [];
        for (const line of input.lines) {
          const { rows: inserted } = await client.query(
            `INSERT INTO commercial_order_lines
               (tenant_id, order_id, kind, description, quantity, unit_price,
                amount, currency)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             RETURNING *`,
            [
              input.tenantId,
              order.id,
              line.kind,
              line.description,
              line.quantity,
              line.unitPrice,
              line.amount,
              line.currency.toUpperCase(),
            ],
          );
          lines.push(this.mapOrderLine(inserted[0]));
        }
        return this.mapOrder(order, lines);
      });
    }

    async confirmOrder(
      tenantId: string,
      orderId: string,
    ): Promise<CommercialOrder> {
      return this.transactionFor(tenantId, async (client) => {
        const { rows: snapshot } = await client.query(
          "SELECT contract_id FROM commercial_orders WHERE tenant_id=$1 AND id=$2",
          [tenantId, orderId],
        );
        if (!snapshot[0]) notFound("CommercialOrder", orderId);
        // Lock order: contract first, then order — the same order as
        // terminateContract() — to avoid the terminate/confirm race.
        const { rows: contracts } = await client.query(
          "SELECT * FROM commercial_contracts WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenantId, snapshot[0].contract_id],
        );
        const { rows: orders } = await client.query(
          "SELECT * FROM commercial_orders WHERE tenant_id=$1 AND id=$2 FOR UPDATE",
          [tenantId, orderId],
        );
        const orderRow = orders[0];
        if (orderRow.status === "CONFIRMED") {
          return this.loadOrderWithLines(client, tenantId, orderId);
        }
        if (!contracts[0]) notFound("CommercialContract", orderRow.contract_id);
        const contract = this.mapContract(contracts[0]);
        const { rows: quotes } = await client.query(
          "SELECT * FROM commercial_quotes WHERE tenant_id=$1 AND id=$2",
          [tenantId, contract.quoteId],
        );
        if (!quotes[0]) notFound("CommercialQuote", contract.quoteId);
        const quote = this.mapQuote(quotes[0]);
        const { rows: lines } = await client.query(
          "SELECT * FROM commercial_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at ASC",
          [tenantId, orderId],
        );
        const order = this.mapOrder(
          orderRow,
          lines.map((row: QueryResultRow) => this.mapOrderLine(row)),
        );
        if (order.currency !== contract.currency) {
          throw new ConflictError(
            `ORDER_CURRENCY_MISMATCH: contract ${contract.currency}, order ${order.currency}`,
          );
        }
        const total = order.lines.reduce(
          (sum, line) => sum + parseDecimal(line.amount),
          0n,
        );
        if (total > parseDecimal(contract.amount)) {
          throw new ConflictError(
            `ORDER_EXCEEDS_CONTRACT: order ${formatDecimal(total)} > contract ${contract.amount}`,
          );
        }
        try {
          assertOrderMayBeConfirmed({ order, contract, quote });
        } catch (error) {
          lifecycleConflict(error);
        }
        await client.query(
          "UPDATE commercial_orders SET status='CONFIRMED', confirmed_at=now(), updated_at=now() WHERE tenant_id=$1 AND id=$2",
          [tenantId, orderId],
        );
        return this.loadOrderWithLines(client, tenantId, orderId);
      });
    }

    async cancelOrder(
      tenantId: string,
      orderId: string,
    ): Promise<CommercialOrder> {
      const { rows } = await this.tenantQuery(
        tenantId,
        `UPDATE commercial_orders
            SET status='CANCELLED', updated_at=now()
          WHERE tenant_id=$1 AND id=$2 AND status='DRAFT'
          RETURNING *`,
        [tenantId, orderId],
      );
      if (rows[0]) return this.loadOrderWithLines(
        { query: (sql, params) => this.tenantQuery(tenantId, sql, params) },
        tenantId,
        orderId,
      );
      const { rows: current } = await this.tenantQuery(
        tenantId,
        "SELECT * FROM commercial_orders WHERE tenant_id=$1 AND id=$2",
        [tenantId, orderId],
      );
      if (!current[0]) notFound("CommercialOrder", orderId);
      if (current[0].status === "CANCELLED") {
        return this.loadOrderWithLines(
          { query: (sql, params) => this.tenantQuery(tenantId, sql, params) },
          tenantId,
          orderId,
        );
      }
      throw new ConflictError(`ORDER_NOT_CANCELLABLE: ${current[0].status}`);
    }

    async upsertCommercialOrder(input: {
      tenantId: string;
      sourceSystem: string;
      externalOrderId: string;
      externalContractId: string;
      orderNumber: string;
      currency: string;
      status?: CommercialOrder["status"];
      lines: Array<{
        kind: CommercialOrder["lines"][number]["kind"];
        description: string;
        quantity: string;
        unitPrice: string;
        amount: string;
        currency: string;
      }>;
    }): Promise<{ order: CommercialOrder; created: boolean }> {
      return this.transactionFor(input.tenantId, async (client) => {
        const { rows: contracts } = await client.query(
          `SELECT * FROM commercial_contracts
            WHERE tenant_id=$1 AND source_system=$2 AND external_contract_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalContractId],
        );
        if (!contracts[0]) notFound("CommercialContract", input.externalContractId);
        const contract = contracts[0];
        const { rows: existing } = await client.query(
          `SELECT * FROM commercial_orders
            WHERE tenant_id=$1 AND source_system=$2 AND external_order_id=$3
            FOR UPDATE`,
          [input.tenantId, input.sourceSystem, input.externalOrderId],
        );
        if (existing[0]) {
          if (input.status) {
            await client.query(
              "UPDATE commercial_orders SET status=$3, updated_at=now() WHERE tenant_id=$1 AND id=$2",
              [input.tenantId, existing[0].id, input.status],
            );
          }
          return {
            order: await this.loadOrderWithLines(client, input.tenantId, existing[0].id),
            created: false,
          };
        }
        if (input.lines.length === 0) throw new ConflictError("ORDER_LINES_REQUIRED");
        if (input.currency.toUpperCase() !== String(contract.currency).trim()) {
          throw new ConflictError(
            `ORDER_CURRENCY_MISMATCH: contract ${String(contract.currency).trim()}, order ${input.currency}`,
          );
        }
        let total = 0n;
        for (const line of input.lines) {
          if (line.currency.toUpperCase() !== input.currency.toUpperCase()) {
            throw new ConflictError("ORDER_LINE_CURRENCY_MISMATCH");
          }
          const expected = mul(parseDecimal(line.quantity), parseDecimal(line.unitPrice));
          if (expected !== parseDecimal(line.amount)) {
            throw new ConflictError("ORDER_LINE_AMOUNT_MISMATCH");
          }
          total += parseDecimal(line.amount);
        }
        if (total > parseDecimal(String(contract.amount))) {
          throw new ConflictError("ORDER_EXCEEDS_CONTRACT");
        }
        const { rows: orders } = await client.query(
          `INSERT INTO commercial_orders
             (tenant_id, account_id, contract_id, order_number, status, currency,
              confirmed_at, source_system, external_order_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
           RETURNING *`,
          [
            input.tenantId,
            contract.account_id,
            contract.id,
            input.orderNumber,
            input.status ?? "DRAFT",
            input.currency.toUpperCase(),
            input.status === "CONFIRMED" ? new Date().toISOString() : null,
            input.sourceSystem,
            input.externalOrderId,
          ],
        );
        for (const line of input.lines) {
          await client.query(
            `INSERT INTO commercial_order_lines
               (tenant_id, order_id, kind, description, quantity, unit_price, amount, currency)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              input.tenantId,
              orders[0].id,
              line.kind,
              line.description,
              line.quantity,
              line.unitPrice,
              line.amount,
              line.currency.toUpperCase(),
            ],
          );
        }
        return {
          order: await this.loadOrderWithLines(client, input.tenantId, orders[0].id),
          created: true,
        };
      });
    }

    async listOrders(
      tenantId: string,
      accountId?: string,
    ): Promise<CommercialOrder[]> {
      const params: string[] = [tenantId];
      let sql = "SELECT * FROM commercial_orders WHERE tenant_id=$1";
      if (accountId) {
        params.push(accountId);
        sql += " AND account_id=$2";
      }
      sql += " ORDER BY order_number DESC";
      const { rows } = await this.tenantQuery(tenantId, sql, params);
      const orders: CommercialOrder[] = [];
      for (const row of rows as QueryResultRow[]) {
        const { rows: lines } = await this.tenantQuery(
          tenantId,
          "SELECT * FROM commercial_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at ASC",
          [tenantId, row.id],
        );
        orders.push(
          this.mapOrder(
            row,
            lines.map((line: QueryResultRow) => this.mapOrderLine(line)),
          ),
        );
      }
      return orders;
    }

    private async assertCommercialAccount(
      tenantId: string,
      accountId: string,
    ): Promise<void> {
      const { rows } = await this.tenantQuery(
        tenantId,
        "SELECT 1 FROM commercial_accounts WHERE tenant_id=$1 AND id=$2",
        [tenantId, accountId],
      );
      if (!rows[0]) notFound("CommercialAccount", accountId);
    }

    private async loadOrderWithLines(
      client: { query: (sql: string, params: unknown[]) => Promise<{ rows: QueryResultRow[] }> },
      tenantId: string,
      orderId: string,
    ): Promise<CommercialOrder> {
      const { rows: orders } = await client.query(
        "SELECT * FROM commercial_orders WHERE tenant_id=$1 AND id=$2",
        [tenantId, orderId],
      );
      if (!orders[0]) notFound("CommercialOrder", orderId);
      const { rows: lines } = await client.query(
        "SELECT * FROM commercial_order_lines WHERE tenant_id=$1 AND order_id=$2 ORDER BY created_at ASC",
        [tenantId, orderId],
      );
      return this.mapOrder(
        orders[0],
        lines.map((row: QueryResultRow) => this.mapOrderLine(row)),
      );
    }
  };
}
