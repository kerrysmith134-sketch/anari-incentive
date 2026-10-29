import { createCalculationRunSchema } from "@anari/contracts";
import type {
  CalculationInput,
  PolicyDefinition,
  PolicyTestCase,
  PolicyTestCaseDifference,
  PolicyTestCaseRunResult,
} from "@anari/domain";
import { PolicyGateError, calculateByPolicy } from "@anari/policy-dsl";

const SUPPORTED_EXPECTATIONS = new Set([
  "pool",
  "poolRounded",
  "resultHash",
  "lines",
]);

function collectDifferences(
  path: string,
  expected: unknown,
  actual: unknown,
  differences: PolicyTestCaseDifference[],
): void {
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual)) {
      differences.push({ path, expected, actual });
      return;
    }
    if (expected.length !== actual.length) {
      differences.push({
        path: `${path}.length`,
        expected: expected.length,
        actual: actual.length,
      });
    }
    const length = Math.max(expected.length, actual.length);
    for (let index = 0; index < length; index += 1) {
      collectDifferences(
        `${path}[${index}]`,
        expected[index],
        actual[index],
        differences,
      );
    }
    return;
  }
  if (expected && typeof expected === "object") {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) {
      differences.push({ path, expected, actual });
      return;
    }
    const expectedRecord = expected as Record<string, unknown>;
    const actualRecord = actual as Record<string, unknown>;
    for (const key of Object.keys(expectedRecord)) {
      collectDifferences(
        `${path}.${key}`,
        expectedRecord[key],
        actualRecord[key],
        differences,
      );
    }
    return;
  }
  if (!Object.is(expected, actual)) {
    differences.push({ path, expected, actual });
  }
}

/**
 * Execute a stored golden case against the current policy definition.
 *
 * The case input is a calculation request; its policy version and mode are
 * pinned to the case so a golden case cannot accidentally exercise another
 * policy. Expectations may use any subset of pool, poolRounded, resultHash and
 * lines; unknown keys are reported instead of being silently ignored.
 */
export function runPolicyTestCase(
  testCase: PolicyTestCase,
  policy: PolicyDefinition,
): PolicyTestCaseRunResult {
  const parsed = createCalculationRunSchema.parse({
    ...testCase.input,
    policyVersionId: testCase.policyVersionId,
    mode: "SHADOW",
  });
  const input: CalculationInput = {
    tenantId: testCase.tenantId,
    cycleId: parsed.cycleId,
    policyVersionId: testCase.policyVersionId,
    mode: "SHADOW",
    order: parsed.order as CalculationInput["order"],
    participants: parsed.participants,
  };

  const blockers: string[] = [];
  let actual: Record<string, unknown> = {};
  let resultHash: string | undefined;
  try {
    const result = calculateByPolicy(policy, input);
    actual = {
      pool: result.pool,
      poolRounded: result.poolRounded,
      resultHash: result.resultHash,
      lines: result.lines.map((line) => ({
        personId: line.personId,
        workPackageId: line.workPackageId,
        incentiveType: line.incentiveType,
        roundedAmount: line.roundedAmount,
        currency: line.currency,
      })),
    };
    resultHash = result.resultHash;
  } catch (error) {
    if (!(error instanceof PolicyGateError)) throw error;
    blockers.push(...error.blockers);
    actual = { blockers: [...error.blockers] };
  }

  const expected = testCase.expectedOutput;
  const expectedKeys = Object.keys(expected);
  const unsupportedExpectationKeys = expectedKeys.filter(
    (key) => !SUPPORTED_EXPECTATIONS.has(key),
  );
  const differences: PolicyTestCaseDifference[] = [];
  for (const key of expectedKeys) {
    if (!SUPPORTED_EXPECTATIONS.has(key)) continue;
    collectDifferences(key, expected[key], actual[key], differences);
  }

  return {
    testCaseId: testCase.id,
    policyVersionId: testCase.policyVersionId,
    caseCode: testCase.caseCode,
    passed:
      blockers.length === 0 &&
      unsupportedExpectationKeys.length === 0 &&
      expectedKeys.length > 0 &&
      differences.length === 0,
    expected,
    actual,
    differences,
    unsupportedExpectationKeys,
    blockers,
    resultHash,
  };
}
