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
import { formatDecimal } from "@anari/policy-dsl";
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
        amount: formatDecimal(money(input.amount)),
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
