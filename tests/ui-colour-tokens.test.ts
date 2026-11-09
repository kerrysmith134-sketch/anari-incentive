import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * anari-design-system skill 守卫：
 * 1. 颜色只允许出现在 tokens.css（组件/页面禁止 #hex）；
 * 2. 禁止 `var(--x) + "18"` 这类字符串拼接产生颜色（会被浏览器丢弃）。
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === "dist") continue;
      out.push(...walk(full));
    } else if (/\.(tsx|ts)$/.test(entry) && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("design-token guard (anari-design-system)", () => {
  it("keeps hex colours out of components/pages", () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "apps/web/src"))) {
      if (file.includes("styles")) continue;
      const source = readFileSync(file, "utf8");
      const matches = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      if (matches.length > 0) offenders.push(`${file}: ${matches.join(", ")}`);
    }
    expect(offenders).toEqual([]);
  });

  it("forbids var() + string colour concatenation", () => {
    const offenders: string[] = [];
    for (const file of walk(join(process.cwd(), "apps/web/src"))) {
      const source = readFileSync(file, "utf8");
      if (/var\(--[a-z0-9-]+\)"?\s*\+\s*["'`]/.test(source)) {
        offenders.push(file);
      }
    }
    expect(offenders).toEqual([]);
  });
});
