import { describe, expect, it } from "vitest";
import { matchLocalIntent } from "../apps/web/src/lib/agent-intent.js";

describe("local intent router (LLM-free)", () => {
  it("maps common Chinese phrasings onto console commands", () => {
    expect(matchLocalIntent("帮我查一下证据缺口")?.command).toBe(
      "scan_evidence_gaps",
    );
    expect(matchLocalIntent("这个月结算准备好了吗")?.command).toBe(
      "check_settlement_readiness",
    );
    expect(matchLocalIntent("有没有超时的申诉")?.command).toBe(
      "check_appeal_sla",
    );
    expect(matchLocalIntent("把上月绩效生成评价草稿")?.command).toBe(
      "draft_evaluations",
    );
  });

  it("never matches money or scoring requests to a command", () => {
    expect(matchLocalIntent("把张三的奖金改成 50000")).toBeNull();
    expect(matchLocalIntent("")).toBeNull();
  });

  it("is case-insensitive for english keywords", () => {
    expect(matchLocalIntent("check Evidence gaps")?.command).toBe(
      "scan_evidence_gaps",
    );
  });
});
