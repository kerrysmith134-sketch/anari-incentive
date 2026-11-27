import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * NP-031（2026-11-21 审计）：最小字号制度门禁——
 * 元数据/标签一律 ≥12px；表格正文 ≥13px。样式文件与组件内联样式同查。
 */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entryName of readdirSync(dir)) {
    const full = join(dir, entryName);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      isDirectory = false;
    }
    if (isDirectory) {
      out.push(...walk(full));
    } else if (/\.(css|tsx|ts)$/.test(entryName)) {
      out.push(full);
    }
  }
  return out;
}

// Scan the complete web source tree, not only shared styles/components:
 // page-level inline styles and future CSS files must not bypass this gate.
const sources = [
  ...walk(join(process.cwd(), "apps", "web", "src")),
];

describe("NP-031: 最小字号 12px 门禁", () => {
  it("整个 Web 源码中的 CSS/inline font-size 均不低于 12px", () => {
    const violations: string[] = [];
    for (const file of sources) {
      const text = readFileSync(file, "utf8");
      const declarations = [
        ...[...text.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map(
          (match) => ({ token: match[0], pixels: Number(match[1]) }),
        ),
        ...[...text.matchAll(/fontSize:\s*["']?(\d+(?:\.\d+)?)(px)?["']?/g)].map(
          (match) => ({ token: match[0], pixels: Number(match[1]) }),
        ),
      ];
      for (const declaration of declarations) {
        if (declaration.pixels < 12) {
          violations.push(`${file}: ${declaration.token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("12px 存量在位（元数据层提升已生效）", () => {
    const app = readFileSync(
      join(process.cwd(), "apps", "web", "src", "styles", "app.css"),
      "utf8",
    );
    expect(app).toContain("font-size: 12px");
  });
});
