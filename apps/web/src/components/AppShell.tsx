import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon, type IconName } from "./Icon.js";
import { Avatar, IconButton } from "./ui.js";
import { useTheme } from "../contexts/ThemeContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { shortId } from "../lib/format.js";

interface NavItem {
  to: string;
  label: string;
  icon: IconName;
  end?: boolean;
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
      { to: "/approvals", label: "Approvals", icon: "approvals" },
      { to: "/cycles", label: "Cycles", icon: "clock" },
      { to: "/contribution", label: "Contribution", icon: "layers" },
    ],
  },
  {
    label: "Money",
    items: [
      { to: "/payroll", label: "Payroll", icon: "payroll" },
      { to: "/rewards", label: "Rewards", icon: "rewards" },
      { to: "/settlements", label: "Settlements", icon: "wallet" },
    ],
  },
  {
    label: "Governance",
    items: [
      { to: "/ai", label: "AI assurance", icon: "ai" },
      { to: "/policy", label: "Policy", icon: "policy" },
      { to: "/exceptions", label: "Exceptions", icon: "alert-circle" },
      { to: "/adverse-actions", label: "Adverse actions", icon: "user" },
      { to: "/audit", label: "Audit", icon: "shield" },
    ],
  },
  {
    label: "System",
    items: [
      { to: "/integrations", label: "Integrations", icon: "integrations" },
      { to: "/people", label: "People", icon: "people" },
      { to: "/settings", label: "Settings", icon: "settings" },
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
          <span className="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="30" height="30">
              <rect width="32" height="32" rx="9" fill="currentColor" opacity="0.14" />
              <path
                d="M9 23V10.5L23 21.5V9"
                stroke="currentColor"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="none"
              />
              <circle cx="23" cy="9" r="2.4" fill="var(--accent-bright)" />
            </svg>
          </span>
          <div className="sidebar__brand-copy">
            <strong>N-Perform</strong>
            <span>Assurance console</span>
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
          {NAV.map((group) => (
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
              <strong>Header auth</strong>
              <span>Development identity</span>
            </div>
          </div>
          <NavLink to="/settings" className="user-chip">
            <Avatar name="Operator" size={30} />
            <span className="user-chip__copy">
              <strong>{shortId(session.userId, 16)}</strong>
              <span>{shortId(session.tenantId, 18)}</span>
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
            <NavLink
              to="/settings"
              className="topbar__settings"
              aria-label="Workspace settings"
            >
              <Icon name="settings" size={18} />
            </NavLink>
          </div>
        </header>
        <main className="main" id="main">
          {children}
        </main>
      </div>
    </div>
  );
}
