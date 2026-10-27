import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@anari/domain": `${root}packages/domain/src/index.ts`,
      "@anari/contracts": `${root}packages/contracts/src/index.ts`,
      "@anari/policy-dsl": `${root}packages/policy-dsl/src/index.ts`,
      "@anari/ledger": `${root}packages/ledger/src/index.ts`,
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["packages/**/*.test.ts", "apps/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
