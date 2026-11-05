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
    label: "Workspace",
    items: [
      { to: "/", label: "Overview", icon: "overview", end: true },
      { to: "/my-ai", label: "My AI record", icon: "ai" },
      {
        to: "/approvals",
        label: "Approvals",
        icon: "approvals",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/cycles",
        label: "Cycles",
        icon: "clock",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/contribution",
        label: "Contribution",
        icon: "layers",
        allowed: ["manager", "finance", "admin"],
      },
    ],
  },
  {
    label: "Money",
    items: [
      {
        to: "/payroll",
        label: "Payroll",
        icon: "payroll",
        allowed: ["finance", "admin"],
      },
      {
        to: "/rewards",
        label: "Rewards",
        icon: "rewards",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/settlements",
        label: "Settlements",
        icon: "wallet",
        allowed: ["finance", "admin"],
      },
      {
        to: "/registries",
        label: "Registries",
        icon: "layers",
        allowed: ["manager", "finance", "admin"],
      },
    ],
  },
  {
    label: "Governance",
    items: [
      {
        to: "/governance",
        label: "Governance hub",
        icon: "shield",
        allowed: ["admin"],
      },
      {
        to: "/ai",
        label: "AI assurance",
        icon: "ai",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/agent-ops",
        label: "Agent ops",
        icon: "ai",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/policy",
        label: "Policy",
        icon: "policy",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/exceptions",
        label: "Exceptions",
        icon: "alert-circle",
        allowed: ["manager", "finance", "admin"],
      },
      {
        to: "/adverse-actions",
        label: "Adverse actions",
        icon: "user",
        allowed: ["admin"],
      },
      {
        to: "/audit",
        label: "Audit",
        icon: "shield",
        allowed: ["admin", "finance"],
      },
    ],
  },
  {
    label: "System",
    items: [
      {
        to: "/integrations",
        label: "Integrations",
        icon: "integrations",
        allowed: ["admin"],
      },
      {
        to: "/people",
        label: "People",
        icon: "people",
        allowed: ["admin", "manager"],
      },
      {
        to: "/platform",
        label: "Platform",
        icon: "layers",
        allowed: ["admin"],
      },
      {
        to: "/settings",
        label: "Settings",
        icon: "settings",
        allowed: ["admin"],
      },
      {
        to: "/field-access",
        label: "Field access",
        icon: "shield",
        allowed: ["admin"],
      },
    ],
  },
];

const TITLES: Record<string, string> = {
  "/": "Overview",
  "/approvals": "Approvals",
  "/cycles": "Cycles",
  "/contribution": "Contribution",
  "/payroll": "Payroll",
  "/rewards": "Rewards",
  "/settlements": "Settlements",
  "/ai": "AI assurance",
  "/policy": "Policy",
  "/exceptions": "Exceptions",
  "/adverse-actions": "Adverse actions",
  "/audit": "Audit",
  "/integrations": "Integrations",
  "/people": "People",
  "/my-ai": "My AI record",
  "/settings": "Settings",
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
        aria-label="Close navigation"
        onClick={() => setSidebarOpen(false)}
      />
      <aside className="sidebar" aria-label="Primary navigation">
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
            <span>N-Perform console</span>
          </div>
          <button
            type="button"
            className="sidebar__close"
            aria-label="Close navigation"
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
            <span className="env-card__dot" aria-hidden="true" />
            <div>
              <strong>{session.token ? "OIDC token" : "Header auth"}</strong>
              <span>{session.token ? "Bearer session" : "Development identity"}</span>
            </div>
          </div>
          {roles.length === 0 || roles.includes("admin") ? (
          <NavLink to="/settings" className="user-chip">
            <Avatar name="Operator" size={30} />
            <span className="user-chip__copy">
              <strong>{shortId(session.userId || session.personId, 16)}</strong>
              <span>{shortId(session.tenantId, 18)}</span>
            </span>
            <Icon name="chevron-right" size={14} />
          </NavLink>
          ) : null}
          <NavLink to="/login" className="user-chip">
            <Avatar name="Session" size={30} />
            <span className="user-chip__copy">
              <strong>Sign in / switch session</strong>
              <span>{session.token ? "OIDC bearer" : "Dev headers"}</span>
            </span>
            <Icon name="chevron-right" size={14} />
          </NavLink>
        </div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar__left">
            <IconButton
              label="Open navigation"
              icon="menu"
              className="topbar__menu"
              onClick={() => setSidebarOpen(true)}
            />
            <div className="crumb">
              <span>Console</span>
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
                  ? "Switch to light appearance"
                  : "Switch to dark appearance"
              }
              icon={resolved === "dark" ? "sun" : "moon"}
              onClick={toggle}
            />
            {roles.length === 0 || roles.includes("admin") ? (
              <NavLink
                to="/settings"
                className="topbar__settings"
                aria-label="Workspace settings"
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
