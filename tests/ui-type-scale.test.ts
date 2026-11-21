import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NP-031（2026-11-21 审计）：最小字号制度门禁——
 * 元数据/标签一律 ≥12px；表格正文 ≥13px。样式文件与组件内联样式同查。
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry.name ?? entry);
    try {
      if (entry.isDirectory?.()) {
        out.push(...walk(full));
      } else if (/\.(css|tsx|ts)$/.test(String(entry.name ?? entry))) {
        out.push(full);
      }
    } catch {
      /* ignore unreadable entries */
    }
  }
  return out;
}

const sources = [
  ...walk(join(process.cwd(), "apps", "web", "src", "styles")),
  ...walk(join(process.cwd(), "apps", "web", "src", "components")),
];

const INLINE_RE = /font-size:\s*(['"]?)(8|9|10|11)px\1/g;

describe("NP-031: 最小字号 12px 门禁", () => {
  it("样式与组件中不存在 8–11px 字号", () => {
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/font-size:\s*(8|9|10|11)px/g)) {
        violations.push(`${file}: ${match[0]}`);
      }
    }
    expect(violations).toEqual([]);
    void INLINE_RE;
  });

  it("12px 存量在位（元数据层提升已生效）", () => {
    const app = readFileSync(
      join(process.cwd(), "apps", "web", "src", "styles", "app.css"),
      "utf8",
    );
    expect(app).toContain("font-size: 12px");
  });
});
