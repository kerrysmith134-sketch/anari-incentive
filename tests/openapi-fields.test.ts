import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  describeRequestSchema,
  requestSchemaRegistry,
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

const manifest = JSON.parse(
  readFileSync(
    new URL("../docs/generated/request-contracts.json", import.meta.url),
    "utf8",
  ),
) as {
  schemas: Record<
    string,
    { required: string[]; optional: string[] }
  >;
};

const CASES = Object.entries(requestSchemaRegistry).sort(([left], [right]) =>
  left.localeCompare(right),
);

describe("OpenAPI request-field contracts", () => {
  it("keeps the generated contract manifest in sync with Zod", () => {
    const expected = Object.fromEntries(
      CASES.map(([name, schema]) => [name, describeRequestSchema(schema)]),
    );
    expect(manifest.schemas).toEqual(expected);
  });

  for (const [schemaName, zodSchema] of CASES) {
    it(`keeps ${schemaName} required fields aligned with Zod`, () => {
      const openapi = spec.components.schemas[schemaName];
      expect(openapi, schemaName).toBeTruthy();
      const contract = describeRequestSchema(zodSchema);
      const specRequired = [...(openapi?.required ?? [])].sort();
      expect(specRequired).toEqual(contract.required);
      const specProperties = Object.keys(openapi?.properties ?? {});
      for (const field of [...contract.required, ...contract.optional]) {
        expect(specProperties, `${schemaName}.${field}`).toContain(field);
      }
    });
  }
});
