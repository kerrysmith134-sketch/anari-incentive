import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  amendEmploymentContractSchema,
  approvePayrollRunSchema,
  createAiScoreProposalSchema,
  createAppealSchema,
  createApprovalRequestSchema,
  createClawbackCaseSchema,
  createContributionClaimSchema,
  createDataQualityIssueSchema,
  createDataSourceSchema,
  createDsarSchema,
  createEmploymentContractSchema,
  createEvidenceSchema,
  createPayrollRunSchema,
  createRetentionPolicySchema,
  createSettlementBatchSchema,
  createWorkPackageSchema,
  publishPolicySchema,
  recordConfirmationSchema,
  recordLegalGateSchema,
  recordWorkforceSubgroupAttributeSchema,
  resolveAppealSchema,
  updateFieldAccessPoliciesSchema,
} from "@anari/contracts";

const spec = YAML.parse(
  readFileSync(new URL("../docs/openapi.yaml", import.meta.url), "utf8"),
) as {
  components: {
    schemas: Record<
      string,
      { required?: string[]; properties?: Record<string, unknown> }
    >;
  };
};

type ZodShape = Record<string, { isOptional?: () => boolean }>;
type ZodNode = {
  _def?: { schema?: ZodNode };
  shape?: ZodShape;
};

function zodShape(schema: unknown): ZodShape {
  let node = schema as ZodNode;
  while (node._def?.schema) node = node._def.schema;
  return node.shape ?? {};
}

const CASES = [
  { schema: "CreateWorkPackage", zod: createWorkPackageSchema },
  { schema: "CreateEmploymentContract", zod: createEmploymentContractSchema },
  { schema: "AmendEmploymentContract", zod: amendEmploymentContractSchema },
  { schema: "CreatePayrollRun", zod: createPayrollRunSchema },
  { schema: "ApprovePayrollRun", zod: approvePayrollRunSchema },
  { schema: "CreateContributionClaim", zod: createContributionClaimSchema },
  { schema: "CreateAppeal", zod: createAppealSchema },
  { schema: "ResolveAppeal", zod: resolveAppealSchema },
  { schema: "CreateEvidence", zod: createEvidenceSchema },
  { schema: "RecordConfirmation", zod: recordConfirmationSchema },
  { schema: "CreateDsar", zod: createDsarSchema },
  { schema: "CreateRetentionPolicy", zod: createRetentionPolicySchema },
  { schema: "RecordLegalGate", zod: recordLegalGateSchema },
  { schema: "CreateDataQualityIssue", zod: createDataQualityIssueSchema },
  { schema: "CreateDataSource", zod: createDataSourceSchema },
  { schema: "CreateApprovalRequest", zod: createApprovalRequestSchema },
  { schema: "CreateAiScoreProposal", zod: createAiScoreProposalSchema },
  { schema: "CreateSettlementBatch", zod: createSettlementBatchSchema },
  { schema: "CreateClawbackCase", zod: createClawbackCaseSchema },
  { schema: "PublishPolicy", zod: publishPolicySchema },
  {
    schema: "RecordWorkforceSubgroupAttribute",
    zod: recordWorkforceSubgroupAttributeSchema,
  },
  { schema: "UpdateFieldAccessPolicies", zod: updateFieldAccessPoliciesSchema },
] as const;

describe("OpenAPI request-field contracts", () => {
  for (const testCase of CASES) {
    it(`keeps ${testCase.schema} required fields aligned with Zod`, () => {
      const openapi = spec.components.schemas[testCase.schema];
      expect(openapi, testCase.schema).toBeTruthy();
      const shape = zodShape(testCase.zod);
      expect(Object.keys(shape).length, testCase.schema).toBeGreaterThan(0);
      const zodRequired = Object.entries(shape)
        .filter(([, field]) => field?.isOptional?.() === false)
        .map(([name]) => name)
        .sort();
      const specRequired = [...(openapi?.required ?? [])].sort();
      expect(specRequired).toEqual(zodRequired);
      const specProperties = Object.keys(openapi?.properties ?? {});
      for (const field of Object.keys(shape)) {
        expect(specProperties, `${testCase.schema}.${field}`).toContain(field);
      }
    });
  }
});
