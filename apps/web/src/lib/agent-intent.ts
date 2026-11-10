/**
 * 本地意图匹配（无需 LLM）：关键词 → 指令台命令。
 *
 * 定位：LLM 负责开放语句的意图解析；LLM 未配置时，这个确定性路由器让
 * 「查一下证据缺口」「结算准备好了吗」这类常见问法依然可用。金额、分数、
 * 系数永远不在这里产生——执行一律走 agent 任务状态机。
 */

export interface LocalIntent {
  command: string;
  label: string;
  keyword: string;
}

const INTENT_RULES: Array<{
  command: string;
  label: string;
  keywords: string[];
}> = [
  {
    command: "scan_evidence_gaps",
    label: "证据缺口扫描",
    keywords: ["证据", "缺口", "补证", "evidence"],
  },
  {
    command: "check_settlement_readiness",
    label: "结算就绪检查",
    keywords: ["结算", "就绪", "发放", "settlement"],
  },
  {
    command: "scan_data_quality",
    label: "数据质量扫描",
    keywords: ["数据质量", "质量问题", "低质量", "quality"],
  },
  {
    command: "scan_contribution_anomalies",
    label: "贡献异常扫描",
    keywords: ["异常", "虚报", "自我认定", "anomaly"],
  },
  {
    command: "check_appeal_sla",
    label: "申诉 SLA 检查",
    keywords: ["申诉", "sla", "超时"],
  },
  {
    command: "run_cycle_pre_review",
    label: "周期 AI 预审",
    keywords: ["预审", "周期", "预检"],
  },
  {
    command: "draft_evaluations",
    label: "评价草稿生成",
    keywords: ["评价草稿", "草稿", "评价"],
  },
  {
    command: "propose_policy_change",
    label: "政策变更提案",
    keywords: ["政策", "提案", "制度变更", "policy"],
  },
];

export function matchLocalIntent(text: string): LocalIntent | null {
  const input = text.trim().toLowerCase();
  if (!input) return null;
  for (const rule of INTENT_RULES) {
    const keyword = rule.keywords.find((candidate) =>
      input.includes(candidate.toLowerCase()),
    );
    if (keyword) {
      return { command: rule.command, label: rule.label, keyword };
    }
  }
  return null;
}

export const LOCAL_INTENT_RULES = INTENT_RULES;
