import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { Avatar, IconButton } from "./ui.js";
import { useTheme } from "../contexts/ThemeContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useApiQuery } from "../lib/hooks.js";
import { shortId } from "../lib/format.js";
import type { PlatformIdentity } from "../lib/types.js";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
  /** Roles allowed to see the item. Omitted means everyone. */
  allowed?: string[];
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV: NavGroup[] = [
  {
    label: "工作台",
    items: [
      { to: "/", label: "总览", icon: "overview", end: true },
      { to: "/my-ai", label: "我的 AI 记录", icon: "ai" },
      { to: "/my-rewards", label: "我的激励", icon: "rewards" },
      { to: "/notifications", label: "通知中心", icon: "approvals" },
      {
        to: "/approvals",
        label: "审批",
        icon: "approvals",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/cycles",
        label: "考核周期",
        icon: "clock",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/contribution",
        label: "贡献认定",
        icon: "layers",
        allowed: ["manager", "finance", "admin"],
      },
    ],
  },
  {
    label: "核心业务",
    items: [
      {
        to: "/performance",
        label: "绩效管理",
        icon: "policy",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/commission",
        label: "奖金提成",
        icon: "payroll",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/payroll",
        label: "薪酬发放",
        icon: "payroll",
        allowed: ["finance", "admin"],
      },
      { to: "/equity", label: "期权股权", icon: "rewards" },
      { to: "/bounty", label: "悬赏任务", icon: "rewards" },
      {
        to: "/settlements",
        label: "结算",
        icon: "wallet",
        allowed: ["finance", "admin"],
      },
      {
        to: "/registries",
        label: "登记簿",
        icon: "layers",
        allowed: ["manager", "finance", "admin"],
      },
    ],
  },
  {
    label: "治理与合规",
    items: [
      {
        to: "/governance",
        label: "治理中心",
        icon: "shield",
        allowed: ["admin"],
      },
      {
        to: "/ai",
        label: "AI 保障",
        icon: "ai",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/agent-ops",
        label: "Agent 运维",
        icon: "ai",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/policy",
        label: "政策",
        icon: "policy",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/exceptions",
        label: "申诉与例外",
        icon: "alert-circle",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/adverse-actions",
        label: "不利决定",
        icon: "user",
        allowed: ["admin"],
      },
      {
        to: "/audit",
        label: "审计",
        icon: "shield",
        allowed: ["admin", "finance"],
      },
    ],
  },
  {
    label: "系统",
    items: [
      {
        to: "/integrations",
        label: "集成",
        icon: "integrations",
        allowed: ["admin"],
      },
      {
        to: "/people",
        label: "人员",
        icon: "people",
        allowed: ["admin", "manager"],
      },
      {
        to: "/platform",
        label: "平台",
        icon: "layers",
        allowed: ["admin"],
      },
      {
        to: "/settings",
        label: "设置",
        icon: "settings",
        allowed: ["admin"],
      },
      {
        to: "/field-access",
        label: "字段权限",
        icon: "shield",
        allowed: ["admin"],
      },
    ],
  },
];

const ROLE_ZH: Record<string, string> = {
  admin: "管理员",
  manager: "经理",
  finance: "财务",
  employee: "员工",
  integration: "集成",
  platform_admin: "平台管理员",
};
function zhRole(role: string): string {
  return ROLE_ZH[role] ?? role;
}

const TITLES: Record<string, string> = {
  "/": "运营总览",
  "/approvals": "审批",
  "/cycles": "考核周期",
  "/contribution": "贡献认定",
  "/payroll": "薪酬发放",
  "/rewards": "激励",
  "/settlements": "结算",
  "/ai": "AI 保障",
  "/policy": "政策",
  "/exceptions": "申诉与例外",
  "/adverse-actions": "不利决定",
  "/audit": "审计",
  "/integrations": "集成",
  "/people": "人员",
  "/my-ai": "我的 AI 记录",
  "/settings": "设置",
  "/performance": "绩效管理",
  "/commission": "奖金提成",
  "/equity": "期权股权",
  "/bounty": "悬赏任务",
  "/field-access": "字段权限",
  "/governance": "治理中心",
  "/agent-ops": "Agent 运维",
  "/platform": "平台",
  "/login": "登录",
  "/signup": "注册",
  "/my-rewards": "我的激励",
  "/notifications": "通知中心",
};

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { resolved, toggle } = useTheme();
  const { session } = useAuth();
  const identity = useApiQuery<PlatformIdentity>("/api/v1/platform/identity");
  const roles = identity.data?.roles ?? [];
  const visibleGroups = NAV.map((group) => ({
    ...group,
    items: group.items.filter(
      (item) =>
        roles.length === 0 ||
        !item.allowed ||
        item.allowed.some((role) => roles.includes(role)),
    ),
  })).filter((group) => group.items.length > 0);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const section =
    TITLES[location.pathname] ??
    TITLES[
      `/${location.pathname.split("/").filter(Boolean)[0] ?? ""}`
    ] ??
    "Console";

  return (
    <div className={`app-shell ${sidebarOpen ? "nav-open" : ""}`}>
      <button
        type="button"
        className="nav-scrim"
        aria-label="关闭导航"
        onClick={() => setSidebarOpen(false)}
      />
      <aside className="sidebar" aria-label="主导航">
        <div className="sidebar__brand">
          <img
            src="/brand/logo-icon.png"
            alt=""
            width="28"
            height="28"
            className="brand-mark brand-mark--logo"
          />
          <div className="sidebar__brand-copy">
            <strong>anari</strong>
            <span>N-Perform 控制台</span>
          </div>
          <button
            type="button"
            className="sidebar__close"
            aria-label="关闭导航"
            onClick={() => setSidebarOpen(false)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="sidebar__nav">
          {visibleGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group__label">{group.label}</span>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "is-active" : ""}`
                  }
                >
                  <Icon name={item.icon} size={18} />
                  <span>{item.label}</span>
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar__footer">
          <div className="env-card">
            <span
              className="env-card__dot"
              aria-hidden="true"
              style={{
                background: identity.data?.roles.includes("admin")
                  ? "var(--good)"
                  : "var(--brand)",
              }}
            />
            <div>
              <strong>
                {identity.data?.displayName ??
                  (session.token || session.userId
                    ? identity.data?.userId
                      ? "已登录"
                      : "未登录"
                    : "未登录")}
              </strong>
              <span>
                {identity.data?.tenantName ?? "选择工作区"} ·{" "}
                {identity.data?.roles?.length
                  ? identity.data.roles.map((role) => zhRole(role)).join("/")
                  : "无角色"}
              </span>
            </div>
          </div>
          {roles.length === 0 || roles.includes("admin") ? (
          <NavLink to="/settings" className="user-chip">
            <Avatar
              name={identity.data?.displayName ?? "用户"}
              size={30}
            />
            <span className="user-chip__copy">
              <strong>
                {identity.data?.displayName ?? "未命名用户"}
              </strong>
              <span>
                {identity.data?.tenantName ?? "未选择工作区"}
              </span>
            </span>
            <Icon name="chevron-right" size={14} />
          </NavLink>
          ) : null}
          <NavLink to="/login" className="user-chip">
            <Avatar name="会话" size={30} />
            <span className="user-chip__copy">
              <strong>登录 / 切换账号</strong>
              <span>账号密码 · 飞书 · OIDC</span>
            </span>
            <Icon name="chevron-right" size={14} />
          </NavLink>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__left">
            <IconButton
              label="打开导航"
              icon="menu"
              className="topbar__menu"
              onClick={() => setSidebarOpen(true)}
            />
            <div className="crumb">
              <span>控制台</span>
              <Icon name="chevron-right" size={13} />
              <strong>{section}</strong>
            </div>
          </div>
          <div className="topbar__right">
            <span className="topbar__context">
              <Icon name="building" size={15} />
              {shortId(session.tenantId, 18)}
            </span>
            <IconButton
              label={
                resolved === "dark"
                  ? "切换到浅色"
                  : "切换到深色"
              }
              icon={resolved === "dark" ? "sun" : "moon"}
              onClick={toggle}
            />
            {roles.length === 0 || roles.includes("admin") ? (
              <NavLink
                to="/settings"
                className="topbar__settings"
                aria-label="工作区设置"
              >
                <Icon name="settings" size={18} />
              </NavLink>
            ) : null}
          </div>
        </header>
        <main className="main" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
