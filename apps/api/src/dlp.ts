/**
 * 导出 DLP 扫描（NPV2-011 移入共享层）。
 */

/** Detect common unmasked identifiers in an export payload. */
export function scanExportDlp(
  text: string,
  extraRules: Array<{ code: string; pattern: string; flags?: string }> = [],
): string[] {
  const patterns: Array<{ code: string; pattern: RegExp }> = [
    { code: "CHINESE_ID", pattern: /\b\d{17}[\dXx]\b/g },
    { code: "BANK_CARD", pattern: /\b\d{16,19}\b/g },
    { code: "PHONE", pattern: /\b1[3-9]\d{9}\b/g },
    { code: "EMAIL", pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  ];
  for (const rule of extraRules) {
    try {
      patterns.push({
        code: rule.code || "CUSTOM",
        pattern: new RegExp(rule.pattern, rule.flags ?? "g"),
      });
    } catch {
      /* invalid tenant rule is ignored; management API validates on write */
    }
  }
  const findings = new Set<string>();
  for (const { code, pattern } of patterns) {
    if (pattern.test(text)) findings.add(code);
    pattern.lastIndex = 0;
  }
  return [...findings];
}
