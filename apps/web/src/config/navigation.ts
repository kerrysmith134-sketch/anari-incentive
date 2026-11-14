import type { IconName } from "../components/Icon.js";

export interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  /** 空数组/缺省 = 所有人可见；否则仅列出的角色可见。 */
  allowed?: string[];
}

export interface NavGroup {
  key: string;
  label: string;
  icon: IconName;
  items: NavItem[];
}

/**
 * 导航唯一事实来源：分组、条目、图标、角色可见性。
 * AppShell / 面包屑 / E2E 都从这里读，禁止在别处手写导航。
 */
export const NAV: NavGroup[] = [
  {
    key: "workbench",
    label: "工作台",
    icon: "overview",
    items: [
      { to: "/", label: "总览", icon: "overview" },
      { to: "/my-workbench", label: "我的工作台", icon: "clock" },
      { to: "/my-ai", label: "我的 AI 记录", icon: "ai" },
      { to: "/my-rewards", label: "我的激励", icon: "rewards" },
      { to: "/notifications", label: "通知中心", icon: "info" },
      { to: "/privacy", label: "隐私与数据", icon: "shield" },
      { to: "/approvals", label: "审批收件箱", icon: "approvals" },
    ],
  },
  {
    key: "assessment",
    label: "考核与认定",
    icon: "clock",
    items: [
      { to: "/cycles", label: "考核周期", icon: "clock" },
      {
        to: "/performance",
        label: "绩效管理",
        icon: "policy",
        allowed: ["manager", "finance", "admin"],
      },
      { to: "/contribution", label: "贡献认定", icon: "layers", allowed: ["manager", "finance", "admin"] },
      { to: "/exceptions", label: "申诉与例外", icon: "alert-circle" },
    ],
  },
  {
    key: "incentive",
    label: "激励",
    icon: "rewards",
    items: [
      { to: "/rewards", label: "激励总览", icon: "rewards" },
      { to: "/commission", label: "奖金提成", icon: "wallet", allowed: ["manager", "finance", "admin"] },
      {
        to: "/award-batches",
        label: "奖励发放",
        icon: "wallet",
        allowed: ["manager", "finance", "admin"],
      },
      { to: "/equity", label: "期权股权", icon: "trend-up" },
      { to: "/bounty", label: "悬赏任务", icon: "check-circle" },
      { to: "/payroll", label: "薪酬发放", icon: "payroll", allowed: ["finance", "admin"] },
      { to: "/settlements", label: "结算", icon: "wallet", allowed: ["finance", "admin"] },
    ],
  },
  {
    key: "org",
    label: "制度与组织",
    icon: "building",
    items: [
      { to: "/institutions", label: "2026 制度中心", icon: "policy" },
      { to: "/task-pods", label: "任务制组织", icon: "layers" },
      { to: "/policy", label: "政策", icon: "policy", allowed: ["manager", "finance", "admin"] },
      { to: "/people", label: "人员", icon: "people" },
    ],
  },
  {
    key: "governance",
    label: "智能与治理",
    icon: "shield",
    items: [
      { to: "/governance", label: "治理中心", icon: "shield", allowed: ["admin"] },
      { to: "/ai", label: "AI 保障", icon: "ai", allowed: ["manager", "finance", "admin"] },
      { to: "/agent-ops", label: "Agent 运维", icon: "server", allowed: ["manager", "finance", "admin"] },
      { to: "/adverse-actions", label: "不利决定", icon: "alert-circle", allowed: ["manager", "finance", "admin"] },
      { to: "/audit", label: "审计", icon: "lock", allowed: ["manager", "finance", "admin"] },
    ],
  },
  {
    key: "system",
    label: "系统",
    icon: "settings",
    items: [
      { to: "/integrations", label: "集成", icon: "integrations", allowed: ["manager", "finance", "admin"] },
      { to: "/platform", label: "平台", icon: "building", allowed: ["admin"] },
      { to: "/settings", label: "设置", icon: "settings" },
      { to: "/field-access", label: "字段权限", icon: "key", allowed: ["admin"] },
      { to: "/registries", label: "登记簿", icon: "chart", allowed: ["manager", "finance", "admin"] },
    ],
  },
];

export interface NavLocation {
  group?: NavGroup;
  item?: NavItem;
}

/** 最长 href 匹配，保证嵌套路由（/policy-versions 等）落到正确条目。 */
export function locateNav(pathname: string): NavLocation {
  let best: { group: NavGroup; item: NavItem; length: number } | undefined;
  for (const group of NAV) {
    for (const item of group.items) {
      const target = item.to === "/" ? "/" : item.to;
      const matches =
        item.to === "/"
          ? pathname === "/"
          : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (!matches) continue;
      if (!best || item.to.length > best.item.to.length) {
        best = { group, item, length: item.to.length };
      }
    }
  }
  return best ?? {};
}
