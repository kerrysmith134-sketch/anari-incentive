import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const spec = parse(
  readFileSync(join(root, "docs", "openapi.yaml"), "utf8"),
) as {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
};

const methodPattern = /app\.(get|post|patch|put|delete)\("([^"]+)"/g;

function documentedRoutes() {
  const source = readFileSync(join(root, "apps", "api", "src", "app.ts"), "utf8");
  return [...source.matchAll(methodPattern)]
    .map((match) => ({
      method: match[1] ?? "",
      path: (match[2] ?? "").replace(
        /(?<=\/):([A-Za-z][A-Za-z0-9]*)/g,
        "{$1}",
      ),
    }))
    .filter(
      (route) => route.path === "/health" || route.path.startsWith("/api/v1"),
    );
}

describe("OpenAPI contract", () => {
  it("is a valid OpenAPI 3.1 document", () => {
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.info.title).toBe("N-Perform Incentive API");
    expect(Object.keys(spec.paths).length).toBeGreaterThan(30);
  });

  it("documents every API route and no stale route", () => {
    const routes = documentedRoutes();
    expect(routes.length).toBeGreaterThan(40);

    const missing = routes.filter(
      (route) => !spec.paths[route.path]?.[route.method],
    );
    expect(missing).toEqual([]);

    const stale: Array<{ method: string; path: string }> = [];
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const method of Object.keys(operations)) {
        if (
          ["get", "post", "patch", "put", "delete"].includes(method) &&
          !routes.some(
            (route) => route.method === method && route.path === path,
          )
        ) {
          stale.push({ method, path });
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it("gives every operation a summary and at least one response", () => {
    for (const [path, operations] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(operations)) {
        if (!["get", "post", "patch", "put", "delete"].includes(method)) {
          continue;
        }
        const op = operation as {
          summary?: string;
          responses?: Record<string, unknown>;
        };
        expect(op.summary, `${method.toUpperCase()} ${path} summary`).toBeTruthy();
        expect(
          Object.keys(op.responses ?? {}).length,
          `${method.toUpperCase()} ${path} responses`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it("resolves every local $ref", () => {
    const refPattern = /\$ref: "#\/components\/([a-zA-Z]+)\/([A-Za-z0-9_]+)"/g;
    const source = readFileSync(join(root, "docs", "openapi.yaml"), "utf8");
    const components = (
      parse(source) as { components: Record<string, Record<string, unknown>> }
    ).components;
    for (const match of source.matchAll(refPattern)) {
      const section = match[1] ?? "";
      const name = match[2] ?? "";
      expect(components[section]?.[name], `${section}/${name}`).toBeDefined();
    }
  });
});
