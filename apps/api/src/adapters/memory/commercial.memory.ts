/**
 * Commercial 域内存 Adapter（Sprint 3）：Account→Opportunity→Quote→Contract→Order。
 */
import { randomUUID } from "node:crypto";
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
import { formatDecimal, mul, parseDecimal } from "@anari/policy-dsl";
import { ConflictError } from "../../store.js";
import { money, notFound, now } from "../shared.js";
import type { CommercialPort } from "../../store-ports.js";
import type { MemoryPlatformStoreBase, MemoryPlatformStoreBaseShape } from "./base.memory.js";

function lifecycleConflict(error: unknown): never {
  if (error instanceof CommercialLifecycleError) {
    throw new ConflictError(`${error.code}: ${error.message}`);
  }
  throw error;
}

export function MemoryCommercialMixin(
  Base: abstract new (
    ...args: ConstructorParameters<typeof MemoryPlatformStoreBase>
  ) => MemoryPlatformStoreBaseShape,
) {
  return class extends Base implements CommercialPort {
    private findAccount(tenantId: string, id: string): Account {
      const account = this.commercialAccounts.get(id);
      if (!account || account.tenantId !== tenantId) {
        notFound("CommercialAccount", id);
      }
      return account;
    }

    private findOpportunity(tenantId: string, id: string): Opportunity {
      const opportunity = this.commercialOpportunities.get(id);
      if (!opportunity || opportunity.tenantId !== tenantId) {
        notFound("CommercialOpportunity", id);
      }
      return opportunity;
    }

    private findQuote(tenantId: string, id: string): Quote {
      const quote = this.commercialQuotes.get(id);
      if (!quote || quote.tenantId !== tenantId) notFound("CommercialQuote", id);
      return quote;
    }

    private findContract(tenantId: string, id: string): Contract {
      const contract = this.commercialContracts.get(id);
      if (!contract || contract.tenantId !== tenantId) {
        notFound("CommercialContract", id);
      }
      return contract;
    }

    async createAccount(input: {
      tenantId: string;
      externalAccountId?: string;
      name: string;
      ownerPersonId?: string;
    }): Promise<Account> {
      if (!this.tenants.has(input.tenantId)) notFound("Tenant", input.tenantId);
      if (input.externalAccountId) {
        const duplicate = [...this.commercialAccounts.values()].find(
          (account) =>
            account.tenantId === input.tenantId &&
            account.externalAccountId === input.externalAccountId,
        );
        if (duplicate) {
          throw new ConflictError(
            `COMMERCIAL_ACCOUNT_EXISTS: ${input.externalAccountId}`,
          );
        }
      }
      const account: Account = {
        id: randomUUID(),
        tenantId: input.tenantId,
        externalAccountId: input.externalAccountId,
        name: input.name,
        status: "ACTIVE",
        ownerPersonId: input.ownerPersonId,
      };
      this.commercialAccounts.set(account.id, account);
      return account;
    }

    async listAccounts(tenantId: string): Promise<Account[]> {
      return [...this.commercialAccounts.values()]
        .filter((account) => account.tenantId === tenantId)
        .sort((a, b) => a.name.localeCompare(b.name));
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
      this.findAccount(input.tenantId, input.accountId);
      if (input.externalOpportunityId) {
        const duplicate = [...this.commercialOpportunities.values()].find(
          (opportunity) =>
            opportunity.tenantId === input.tenantId &&
            opportunity.externalOpportunityId === input.externalOpportunityId,
        );
        if (duplicate) {
          throw new ConflictError(
            `COMMERCIAL_OPPORTUNITY_EXISTS: ${input.externalOpportunityId}`,
          );
        }
      }
      const opportunity: Opportunity = {
        id: randomUUID(),
        tenantId: input.tenantId,
        accountId: input.accountId,
        externalOpportunityId: input.externalOpportunityId,
        name: input.name,
        stage: input.stage ?? "QUALIFIED",
        estimatedAmount: input.estimatedAmount
          ? formatDecimal(money(input.estimatedAmount))
          : undefined,
        currency: input.currency.toUpperCase(),
        ownerPersonId: input.ownerPersonId,
      };
      this.commercialOpportunities.set(opportunity.id, opportunity);
      return opportunity;
    }

    async listOpportunities(
      tenantId: string,
      accountId?: string,
    ): Promise<Opportunity[]> {
      return [...this.commercialOpportunities.values()]
        .filter(
          (opportunity) =>
            opportunity.tenantId === tenantId &&
            (!accountId || opportunity.accountId === accountId),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
    }

    async upsertCommercialAccount(input: {
      tenantId: string;
      sourceSystem: string;
      externalAccountId: string;
      name: string;
      ownerPersonId?: string;
    }): Promise<{ account: Account; created: boolean }> {
      const existing = [...this.commercialAccounts.values()].find(
        (account) =>
          account.tenantId === input.tenantId &&
          account.sourceSystem === input.sourceSystem &&
          account.externalAccountId === input.externalAccountId,
      );
      if (existing) {
        existing.name = input.name;
        if (input.ownerPersonId) existing.ownerPersonId = input.ownerPersonId;
        return { account: existing, created: false };
      }
      const account = await this.createAccount({
        tenantId: input.tenantId,
        externalAccountId: input.externalAccountId,
        name: input.name,
        ownerPersonId: input.ownerPersonId,
      });
      account.sourceSystem = input.sourceSystem;
      return { account, created: true };
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
      const { account } = await this.upsertCommercialAccount({
        tenantId: input.tenantId,
        sourceSystem: input.sourceSystem,
        externalAccountId: input.externalAccountId,
        name: input.accountName,
        ownerPersonId: input.ownerPersonId,
      });
      const existing = [...this.commercialOpportunities.values()].find(
        (opportunity) =>
          opportunity.tenantId === input.tenantId &&
          opportunity.sourceSystem === input.sourceSystem &&
          opportunity.externalOpportunityId === input.externalOpportunityId,
      );
      if (existing) {
        existing.accountId = account.id;
        existing.name = input.name;
        if (input.stage) existing.stage = input.stage;
        if (input.estimatedAmount !== undefined) {
          existing.estimatedAmount = formatDecimal(money(input.estimatedAmount));
        }
        existing.currency = input.currency.toUpperCase();
        if (input.ownerPersonId) existing.ownerPersonId = input.ownerPersonId;
        return { account, opportunity: existing, created: false };
      }
      const opportunity = await this.createOpportunity({
        tenantId: input.tenantId,
        accountId: account.id,
        externalOpportunityId: input.externalOpportunityId,
        name: input.name,
        stage: input.stage,
        estimatedAmount: input.estimatedAmount,
        currency: input.currency,
        ownerPersonId: input.ownerPersonId,
      });
      opportunity.sourceSystem = input.sourceSystem;
      return { account, opportunity, created: true };
    }

    async createQuote(input: {
      tenantId: string;
      opportunityId: string;
      currency: string;
      amount: string;
      issuedAt?: string;
      supersedesQuoteId?: string;
    }): Promise<Quote> {
      const opportunity = this.findOpportunity(
        input.tenantId,
        input.opportunityId,
      );
      let version = 1;
      if (input.supersedesQuoteId) {
        const previous = this.findQuote(input.tenantId, input.supersedesQuoteId);
        if (previous.status === "ACCEPTED" || previous.status === "REJECTED") {
          throw new ConflictError(
            `QUOTE_NOT_REVISABLE: quote ${previous.id} is ${previous.status}; accepted/rejected quotes are immutable`,
          );
        }
        if (previous.opportunityId !== opportunity.id) {
          throw new ConflictError(
            "QUOTE_OPPORTUNITY_MISMATCH: superseded quote belongs to another opportunity",
          );
        }
        version = previous.version + 1;
      } else if (
        [...this.commercialQuotes.values()].some(
          (quote) =>
            quote.tenantId === input.tenantId &&
            quote.opportunityId === opportunity.id,
        )
      ) {
        throw new ConflictError(
          "QUOTE_VERSION_REQUIRES_SUPERSEDES: create a revision with supersedesQuoteId",
        );
      }
      const quote: Quote = {
        id: randomUUID(),
        tenantId: input.tenantId,
        opportunityId: opportunity.id,
        version,
        status: "DRAFT",
        currency: input.currency.toUpperCase(),
        amount: formatDecimal(money(input.amount)),
        issuedAt: input.issuedAt,
        supersedesQuoteId: input.supersedesQuoteId,
      };
      this.commercialQuotes.set(quote.id, quote);
      return quote;
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
      const opportunity = [...this.commercialOpportunities.values()].find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.sourceSystem === input.sourceSystem &&
          item.externalOpportunityId === input.externalOpportunityId,
      );
      if (!opportunity) notFound("CommercialOpportunity", input.externalOpportunityId);
      const existing = [...this.commercialQuotes.values()].find(
        (quote) =>
          quote.tenantId === input.tenantId &&
          quote.sourceSystem === input.sourceSystem &&
          quote.externalQuoteId === input.externalQuoteId,
      );
      if (existing) {
        existing.amount = formatDecimal(money(input.amount));
        existing.currency = input.currency.toUpperCase();
        if (input.status) existing.status = input.status;
        if (input.issuedAt) existing.issuedAt = input.issuedAt;
        if (input.acceptedAt) existing.acceptedAt = input.acceptedAt;
        return { quote: existing, created: false };
      }
      const version =
        Math.max(
          0,
          ...[...this.commercialQuotes.values()]
            .filter((quote) => quote.opportunityId === opportunity.id)
            .map((quote) => quote.version),
        ) + 1;
      const quote: Quote = {
        id: randomUUID(),
        tenantId: input.tenantId,
        opportunityId: opportunity.id,
        version,
        status: input.status ?? "DRAFT",
        currency: input.currency.toUpperCase(),
        amount: formatDecimal(money(input.amount)),
        issuedAt: input.issuedAt,
        acceptedAt: input.acceptedAt,
        sourceSystem: input.sourceSystem,
        externalQuoteId: input.externalQuoteId,
      };
      this.commercialQuotes.set(quote.id, quote);
      return { quote, created: true };
    }

    async listQuotes(tenantId: string, opportunityId?: string): Promise<Quote[]> {
      return [...this.commercialQuotes.values()]
        .filter(
          (quote) =>
            quote.tenantId === tenantId &&
            (!opportunityId || quote.opportunityId === opportunityId),
        )
        .sort(
          (a, b) =>
            b.version - a.version || a.id.localeCompare(b.id),
        );
    }

    async acceptQuote(tenantId: string, quoteId: string): Promise<Quote> {
      const quote = this.findQuote(tenantId, quoteId);
      if (quote.status === "ACCEPTED") return quote;
      if (quote.status !== "ISSUED" && quote.status !== "DRAFT") {
        throw new ConflictError(`QUOTE_NOT_ACCEPTABLE: ${quote.status}`);
      }
      quote.status = "ACCEPTED";
      quote.acceptedAt = now();
      return quote;
    }

    async voidQuote(tenantId: string, quoteId: string): Promise<Quote> {
      const quote = this.findQuote(tenantId, quoteId);
      if (quote.status === "REJECTED") return quote;
      if (quote.status !== "DRAFT" && quote.status !== "ISSUED") {
        throw new ConflictError(`QUOTE_NOT_VOIDABLE: ${quote.status}`);
      }
      quote.status = "REJECTED";
      return quote;
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
      this.findAccount(input.tenantId, input.accountId);
      const opportunity = this.findOpportunity(
        input.tenantId,
        input.opportunityId,
      );
      const quote = this.findQuote(input.tenantId, input.quoteId);
      if (
        opportunity.accountId !== input.accountId ||
        quote.opportunityId !== opportunity.id
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
      const contractAmount = formatDecimal(money(input.amount));
      if (quote.currency !== input.currency.toUpperCase()) {
        throw new ConflictError(
          `CONTRACT_CURRENCY_MISMATCH: quote ${quote.currency}, contract ${input.currency}`,
        );
      }
      if (quote.amount !== contractAmount) {
        throw new ConflictError(
          `CONTRACT_QUOTE_AMOUNT_MISMATCH: quote ${quote.amount}, contract ${contractAmount}`,
        );
      }
      const duplicate = [...this.commercialContracts.values()].find(
        (contract) =>
          contract.tenantId === input.tenantId &&
          contract.contractRef === input.contractRef,
      );
      if (duplicate) {
        throw new ConflictError(`COMMERCIAL_CONTRACT_EXISTS: ${input.contractRef}`);
      }
      const contract: Contract = {
        id: randomUUID(),
        tenantId: input.tenantId,
        accountId: input.accountId,
        opportunityId: input.opportunityId,
        quoteId: input.quoteId,
        contractRef: input.contractRef,
        status: "DRAFT",
        currency: input.currency.toUpperCase(),
        amount: contractAmount,
      };
      this.commercialContracts.set(contract.id, contract);
      return contract;
    }

    async signContract(tenantId: string, contractId: string): Promise<Contract> {
      const contract = this.findContract(tenantId, contractId);
      if (contract.status === "SIGNED") return contract;
      if (contract.status !== "DRAFT") {
        throw new ConflictError(`CONTRACT_NOT_SIGNABLE: ${contract.status}`);
      }
      contract.status = "SIGNED";
      contract.signedAt = now();
      return contract;
    }

    async terminateContract(tenantId: string, contractId: string): Promise<Contract> {
      const contract = this.findContract(tenantId, contractId);
      if (contract.status === "TERMINATED") return contract;
      if (contract.status !== "SIGNED") {
        throw new ConflictError(`CONTRACT_NOT_TERMINABLE: ${contract.status}`);
      }
      const confirmed = [...this.commercialOrders.values()].some(
        (order) =>
          order.tenantId === tenantId &&
          order.contractId === contractId &&
          order.status === "CONFIRMED",
      );
      if (confirmed) {
        throw new ConflictError(
          "CONTRACT_HAS_CONFIRMED_ORDER: cancel the order before terminating",
        );
      }
      contract.status = "TERMINATED";
      return contract;
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
      const quote = [...this.commercialQuotes.values()].find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.sourceSystem === input.sourceSystem &&
          item.externalQuoteId === input.externalQuoteId,
      );
      if (!quote) notFound("CommercialQuote", input.externalQuoteId);
      const opportunity = this.findOpportunity(input.tenantId, quote.opportunityId);
      const existing = [...this.commercialContracts.values()].find(
        (contract) =>
          contract.tenantId === input.tenantId &&
          contract.sourceSystem === input.sourceSystem &&
          contract.externalContractId === input.externalContractId,
      );
      if (existing) {
        existing.status = input.status ?? existing.status;
        existing.signedAt = input.signedAt ?? existing.signedAt;
        existing.amount = formatDecimal(money(input.amount));
        existing.currency = input.currency.toUpperCase();
        existing.contractRef = input.contractRef;
        return { contract: existing, created: false };
      }
      if (quote.status !== "ACCEPTED") {
        throw new ConflictError(
          `QUOTE_NOT_ACCEPTED: quote ${quote.id} is ${quote.status}`,
        );
      }
      const contract: Contract = {
        id: randomUUID(),
        tenantId: input.tenantId,
        accountId: opportunity.accountId,
        opportunityId: opportunity.id,
        quoteId: quote.id,
        contractRef: input.contractRef,
        status: input.status ?? "DRAFT",
        signedAt: input.signedAt ?? (input.status === "SIGNED" ? now() : undefined),
        currency: input.currency.toUpperCase(),
        amount: formatDecimal(money(input.amount)),
        sourceSystem: input.sourceSystem,
        externalContractId: input.externalContractId,
      };
      this.commercialContracts.set(contract.id, contract);
      return { contract, created: true };
    }

    async listContracts(tenantId: string, accountId?: string): Promise<Contract[]> {
      return [...this.commercialContracts.values()]
        .filter(
          (contract) =>
            contract.tenantId === tenantId &&
            (!accountId || contract.accountId === accountId),
        )
        .sort((a, b) => b.contractRef.localeCompare(a.contractRef));
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
      const contract = this.findContract(input.tenantId, input.contractId);
      if (contract.accountId !== input.accountId) {
        throw new ConflictError(
          "ORDER_CONTRACT_MISMATCH: order account does not match contract",
        );
      }
      if (contract.status !== "SIGNED") {
        throw new ConflictError(
          `CONTRACT_NOT_SIGNED: contract ${contract.id} is ${contract.status}`,
        );
      }
      if (input.lines.length === 0) {
        throw new ConflictError("ORDER_LINES_REQUIRED");
      }
      if (input.currency.toUpperCase() !== contract.currency) {
        throw new ConflictError(
          `ORDER_CURRENCY_MISMATCH: contract ${contract.currency}, order ${input.currency}`,
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
      if (orderTotal > parseDecimal(contract.amount)) {
        throw new ConflictError(
          `ORDER_EXCEEDS_CONTRACT: order ${formatDecimal(orderTotal)} > contract ${contract.amount}`,
        );
      }
      const duplicate = [...this.commercialOrders.values()].find(
        (order) =>
          order.tenantId === input.tenantId &&
          order.orderNumber === input.orderNumber,
      );
      if (duplicate) {
        throw new ConflictError(`COMMERCIAL_ORDER_EXISTS: ${input.orderNumber}`);
      }
      const order: CommercialOrder = {
        id: randomUUID(),
        tenantId: input.tenantId,
        accountId: input.accountId,
        contractId: input.contractId,
        orderNumber: input.orderNumber,
        status: "DRAFT",
        currency: input.currency.toUpperCase(),
        lines: input.lines.map((line) => ({
          id: randomUUID(),
          orderId: "",
          kind: line.kind,
          description: line.description,
          quantity: formatDecimal(money(line.quantity)),
          unitPrice: formatDecimal(money(line.unitPrice)),
          amount: formatDecimal(money(line.amount)),
          currency: line.currency.toUpperCase(),
        })),
      };
      for (const line of order.lines) line.orderId = order.id;
      this.commercialOrders.set(order.id, order);
      for (const line of order.lines) this.commercialOrderLines.set(line.id, line);
      return order;
    }

    async confirmOrder(
      tenantId: string,
      orderId: string,
    ): Promise<CommercialOrder> {
      const order = this.commercialOrders.get(orderId);
      if (!order || order.tenantId !== tenantId) notFound("CommercialOrder", orderId);
      if (order.status === "CONFIRMED") return order;
      const contract = this.findContract(tenantId, order.contractId);
      const quote = this.findQuote(tenantId, contract.quoteId);
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
      order.status = "CONFIRMED";
      order.confirmedAt = now();
      return order;
    }

    async cancelOrder(
      tenantId: string,
      orderId: string,
    ): Promise<CommercialOrder> {
      const order = this.commercialOrders.get(orderId);
      if (!order || order.tenantId !== tenantId) notFound("CommercialOrder", orderId);
      if (order.status === "CANCELLED") return order;
      if (order.status !== "DRAFT") {
        throw new ConflictError(`ORDER_NOT_CANCELLABLE: ${order.status}`);
      }
      order.status = "CANCELLED";
      return order;
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
      const contract = [...this.commercialContracts.values()].find(
        (item) =>
          item.tenantId === input.tenantId &&
          item.sourceSystem === input.sourceSystem &&
          item.externalContractId === input.externalContractId,
      );
      if (!contract) notFound("CommercialContract", input.externalContractId);
      const existing = [...this.commercialOrders.values()].find(
        (order) =>
          order.tenantId === input.tenantId &&
          order.sourceSystem === input.sourceSystem &&
          order.externalOrderId === input.externalOrderId,
      );
      if (existing) {
        if (input.status) existing.status = input.status;
        return { order: existing, created: false };
      }
      if (input.lines.length === 0) throw new ConflictError("ORDER_LINES_REQUIRED");
      if (input.currency.toUpperCase() !== contract.currency) {
        throw new ConflictError(
          `ORDER_CURRENCY_MISMATCH: contract ${contract.currency}, order ${input.currency}`,
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
      if (total > parseDecimal(contract.amount)) {
        throw new ConflictError("ORDER_EXCEEDS_CONTRACT");
      }
      const order: CommercialOrder = {
        id: randomUUID(),
        tenantId: input.tenantId,
        accountId: contract.accountId,
        contractId: contract.id,
        orderNumber: input.orderNumber,
        status: input.status ?? "DRAFT",
        currency: input.currency.toUpperCase(),
        lines: input.lines.map((line) => ({
          id: randomUUID(),
          orderId: "",
          kind: line.kind,
          description: line.description,
          quantity: formatDecimal(money(line.quantity)),
          unitPrice: formatDecimal(money(line.unitPrice)),
          amount: formatDecimal(money(line.amount)),
          currency: line.currency.toUpperCase(),
        })),
        sourceSystem: input.sourceSystem,
        externalOrderId: input.externalOrderId,
        confirmedAt: input.status === "CONFIRMED" ? now() : undefined,
      };
      for (const line of order.lines) line.orderId = order.id;
      this.commercialOrders.set(order.id, order);
      for (const line of order.lines) this.commercialOrderLines.set(line.id, line);
      return { order, created: true };
    }

    async listOrders(
      tenantId: string,
      accountId?: string,
    ): Promise<CommercialOrder[]> {
      return [...this.commercialOrders.values()]
        .filter(
          (order) =>
            order.tenantId === tenantId &&
            (!accountId || order.accountId === accountId),
        )
        .sort((a, b) => b.orderNumber.localeCompare(a.orderNumber));
    }
  };
}
