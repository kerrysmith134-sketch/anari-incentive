import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  createAiScoreProposalSchema,
  createClawbackCaseSchema,
  createContributionClaimSchema,
  createDataSourceSchema,
  createEmploymentContractSchema,
  createSettlementBatchSchema,
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

const CASES = [
  {
    schema: "CreateEmploymentContract",
    zod: createEmploymentContractSchema,
    required: [
      "personId",
      "contractCode",
      "employmentType",
      "startDate",
      "workLocation",
      "currency",
      "fixedMonthlySalary",
      "minimumMonthlyWage",
      "consentSignatureRef",
    ],
  },
  {
    schema: "CreateContributionClaim",
    zod: createContributionClaimSchema,
    required: [
      "workPackageId",
      "claimantPersonId",
      "claimType",
      "claimedContribution",
      "rationale",
    ],
  },
  {
    schema: "CreateDataSource",
    zod: createDataSourceSchema,
    required: [
      "code",
      "name",
      "category",
      "ownerPersonId",
      "slaHours",
      "criticality",
      "storageRegion",
      "fields",
    ],
  },
  {
    schema: "CreateAiScoreProposal",
    zod: createAiScoreProposalSchema,
    required: [
      "cycleId",
      "personId",
      "evaluationRunId",
      "dimensions",
      "evidence",
    ],
  },
  {
    schema: "CreateSettlementBatch",
    zod: createSettlementBatchSchema,
    required: ["cycleId"],
  },
  {
    schema: "CreateClawbackCase",
    zod: createClawbackCaseSchema,
    required: [
      "personId",
      "amount",
      "currency",
      "reasonCode",
      "explanation",
      "consentSignatureRef",
      "requestedBy",
    ],
  },
] as const;

describe("OpenAPI request-field contracts", () => {
  for (const testCase of CASES) {
    it(`keeps ${testCase.schema} required fields aligned with Zod`, () => {
      const openapi = spec.components.schemas[testCase.schema];
      expect(openapi, testCase.schema).toBeTruthy();
      const specRequired = new Set(openapi?.required ?? []);
      expect([...specRequired].sort()).toEqual([...testCase.required].sort());
      let schemaNode = testCase.zod as unknown as {
        _def?: { schema?: unknown };
        shape?: Record<string, unknown>;
      };
      while (schemaNode._def?.schema) {
        schemaNode = schemaNode._def.schema as typeof schemaNode;
      }
      const shape = schemaNode.shape;
      expect(shape).toBeTruthy();
      for (const field of testCase.required) {
        expect(shape?.[field], `${testCase.schema}.${field}`).toBeTruthy();
        expect(
          Object.keys(openapi?.properties ?? {}),
          `${testCase.schema}.${field}`,
        ).toContain(field);
      }
    });
  }
});
