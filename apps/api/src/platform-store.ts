/**
 * NPV2-013：MemoryPlatformStore / PgPlatformStore 门面。
 *
 * 方法体已逐字平移至 adapters/memory 与 adapters/postgres 的 14 个领域
 * mixin（与 NPV2-012 端口一一对应）；本文件保留：
 * - PlatformStore 接口组合（对外类型不变）
 * - 两个门面类（构造签名与拆分前一致，旧导入面不变）
 * - 链式组合处用 as 断言串联；完整性由各 mixin `implements <Port>` 与
 *   门面 `implements PlatformStore` 静态约束 + 单测/PG/E2E 回归兜底
 */
import type { Pool } from "pg";
import type {
  ApprovalPort, AssessmentPort, BudgetPort, CommsPort, DatagovPort, DeliveryPort, DirectoryPort, IdentityPort, IncentivePort, IntegrationPort, ModelgovPort, PolicygovPort, SettlementPort, TenantPort
} from "./store-ports.js";
import { MemoryPlatformStoreBase, type MemoryPlatformStoreBaseShape } from "./adapters/memory/base.memory.js";
import { MemoryApprovalMixin } from "./adapters/memory/approval.memory.js";
import { MemoryAssessmentMixin } from "./adapters/memory/assessment.memory.js";
import { MemoryBudgetMixin } from "./adapters/memory/budget.memory.js";
import { MemoryCommsMixin } from "./adapters/memory/comms.memory.js";
import { MemoryDatagovMixin } from "./adapters/memory/datagov.memory.js";
import { MemoryDeliveryMixin } from "./adapters/memory/delivery.memory.js";
import { MemoryDirectoryMixin } from "./adapters/memory/directory.memory.js";
import { MemoryIdentityMixin } from "./adapters/memory/identity.memory.js";
import { MemoryIncentiveMixin } from "./adapters/memory/incentive.memory.js";
import { MemoryIntegrationMixin } from "./adapters/memory/integration.memory.js";
import { MemoryModelgovMixin } from "./adapters/memory/modelgov.memory.js";
import { MemoryPolicygovMixin } from "./adapters/memory/policygov.memory.js";
import { MemorySettlementMixin } from "./adapters/memory/settlement.memory.js";
import { MemoryTenantMixin } from "./adapters/memory/tenant.memory.js";
import { PgPlatformStoreBase, type PgPlatformStoreBaseShape } from "./adapters/postgres/base.postgres.js";
import { PgApprovalMixin } from "./adapters/postgres/approval.postgres.js";
import { PgAssessmentMixin } from "./adapters/postgres/assessment.postgres.js";
import { PgBudgetMixin } from "./adapters/postgres/budget.postgres.js";
import { PgCommsMixin } from "./adapters/postgres/comms.postgres.js";
import { PgDatagovMixin } from "./adapters/postgres/datagov.postgres.js";
import { PgDeliveryMixin } from "./adapters/postgres/delivery.postgres.js";
import { PgDirectoryMixin } from "./adapters/postgres/directory.postgres.js";
import { PgIdentityMixin } from "./adapters/postgres/identity.postgres.js";
import { PgIncentiveMixin } from "./adapters/postgres/incentive.postgres.js";
import { PgIntegrationMixin } from "./adapters/postgres/integration.postgres.js";
import { PgModelgovMixin } from "./adapters/postgres/modelgov.postgres.js";
import { PgPolicygovMixin } from "./adapters/postgres/policygov.postgres.js";
import { PgSettlementMixin } from "./adapters/postgres/settlement.postgres.js";
import { PgTenantMixin } from "./adapters/postgres/tenant.postgres.js";

export interface PlatformStore extends
  ApprovalPort,
  AssessmentPort,
  BudgetPort,
  CommsPort,
  DatagovPort,
  DeliveryPort,
  DirectoryPort,
  IdentityPort,
  IncentivePort,
  IntegrationPort,
  ModelgovPort,
  PolicygovPort,
  SettlementPort,
  TenantPort {}

type MemoryBaseCtor = abstract new (...args: ConstructorParameters<typeof MemoryPlatformStoreBase>) => MemoryPlatformStoreBaseShape;
type PgBaseCtor = abstract new (...args: ConstructorParameters<typeof PgPlatformStoreBase>) => PgPlatformStoreBaseShape;

export class MemoryPlatformStore
  extends MemoryTenantMixin(
    (MemorySettlementMixin(
    (MemoryPolicygovMixin(
    (MemoryModelgovMixin(
    (MemoryIntegrationMixin(
    (MemoryIncentiveMixin(
    (MemoryIdentityMixin(
    (MemoryDirectoryMixin(
    (MemoryDeliveryMixin(
    (MemoryDatagovMixin(
    (MemoryCommsMixin(
    (MemoryBudgetMixin(
    (MemoryAssessmentMixin(
    (MemoryApprovalMixin(
    (MemoryPlatformStoreBase) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )) as unknown as MemoryBaseCtor
  )
  implements PlatformStore {}

export class PgPlatformStore
  extends PgTenantMixin(
    (PgSettlementMixin(
    (PgPolicygovMixin(
    (PgModelgovMixin(
    (PgIntegrationMixin(
    (PgIncentiveMixin(
    (PgIdentityMixin(
    (PgDirectoryMixin(
    (PgDeliveryMixin(
    (PgDatagovMixin(
    (PgCommsMixin(
    (PgBudgetMixin(
    (PgAssessmentMixin(
    (PgApprovalMixin(
    (PgPlatformStoreBase) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )) as unknown as PgBaseCtor
  )
  implements PlatformStore {
  constructor(pool: Pool) {
    super(pool);
  }
}
