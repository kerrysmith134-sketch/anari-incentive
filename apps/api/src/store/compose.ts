import type { IncentiveStore } from "../store-interface.js";
import { DEFAULT_TENANT_ID } from "../store-support.js";
import { withAppeals } from "./appeals.js";
import { withAudit } from "./audit.js";
import { StoreBase } from "./base.js";
import { withCalculation } from "./calculation.js";
import { withContribution } from "./contribution.js";
import { withEvaluation } from "./evaluation.js";
import { withLedger } from "./ledger.js";
import { withPolicy } from "./policy.js";
import { withSettlement } from "./settlement.js";
import { withWorkPackage } from "./work-package.js";

/**
 * Full public surface assembled from every domain mixin. The intersection is
 * what the final class exposes; each domain module still owns (and type-checks)
 * its own slice (`Pick<IncentiveStore, ...>`) before it is mixed in.
 */
type StoreInstance = StoreBase &
  import("./audit.js").AuditApi &
  import("./policy.js").PolicyApi &
  import("./work-package.js").WorkPackageApi &
  import("./contribution.js").ContributionApi &
  import("./ledger.js").LedgerApi &
  import("./settlement.js").SettlementApi &
  import("./calculation.js").CalculationApi &
  import("./evaluation.js").EvaluationApi &
  import("./appeals.js").AppealsApi;

/**
 * Behaviour-preserving composition of the in-memory store. Each domain module
 * contributes its methods through the standard linear mixin pattern, so the
 * resulting `Store` still has the same constructor and public surface.
 */
const StoreChain = withAppeals(
  withEvaluation(
    withCalculation(
      withSettlement(
        withLedger(
          withContribution(
            withWorkPackage(withPolicy(withAudit(StoreBase))),
          ),
        ),
      ),
    ),
  ),
) as unknown as new (tenantId?: string) => StoreInstance;

export class Store extends StoreChain implements IncentiveStore {
  constructor(tenantId: string = DEFAULT_TENANT_ID) {
    super(tenantId);
  }
}
