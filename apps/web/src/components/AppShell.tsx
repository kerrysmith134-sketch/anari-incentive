import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { Icon } from "./Icon.js";
import { Avatar, IconButton } from "./ui.js";
import { useTheme } from "../contexts/ThemeContext.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useApiQuery } from "../lib/hooks.js";
import { NAV, locateNav } from "../config/navigation.js";
import { AgentAssistant } from "./AgentAssistant.js";
import type { PlatformIdentity } from "../lib/types.js";

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

const GROUPS_KEY = "anari.nav.groups";
const COLLAPSED_KEY = "anari.nav.collapsed";

function readStringSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((value) => typeof value === "string"));
    }
  } catch {
    /* ignore */
  }
  return new Set();
}

export function AppShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { preference, resolved, cyclePreference } = useTheme();
  const { session, clearSession } = useAuth();
  const identity = useApiQuery<PlatformIdentity>("/api/v1/platform/identity");
  const roles = identity.data?.roles ?? [];
  const authenticated = Boolean(session.token || session.userId);

  const visibleGroups = useMemo(
    () =>
      NAV.map((group) => ({
        ...group,
        items: group.items.filter(
          (item) =>
            !item.allowed ||
            // Fail closed: until the identity call succeeds we must not show
            // restricted navigation (a failed load used to reveal every item).
            (roles.length > 0 &&
              item.allowed.some((role) => roles.includes(role))),
        ),
      })).filter((group) => group.items.length > 0),
    [roles.join(",")], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => readStringSet(GROUPS_KEY),
  );
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === "1";
    } catch {
      return false;
    }
  });

  const active = locateNav(location.pathname);
  const activeGroupKey = active.group?.key;

  // 激活分组自动展开；用户手动折叠的分组保持折叠。
  useEffect(() => {
    if (!activeGroupKey) return;
    setCollapsedGroups((current) => {
      if (!current.has(activeGroupKey)) return current;
      const next = new Set(current);
      next.delete(activeGroupKey);
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [activeGroupKey]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  function toggleGroup(key: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(GROUPS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function toggleSidebarCollapsed() {
    setSidebarCollapsed((value) => {
      const next = !value;
      try {
        localStorage.setItem(COLLAPSED_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  function logout() {
    clearSession();
    window.location.href = "/console/login";
  }

  const themeLabel =
    preference === "system"
      ? "主题：跟随系统，点击切换浅色"
      : preference === "light"
        ? "主题：浅色，点击切换深色"
        : "主题：深色，点击切换回跟随系统";

  return (
    <div
      className={`app-shell ${sidebarOpen ? "nav-open" : ""} ${
        sidebarCollapsed ? "nav-collapsed" : ""
      }`}
    >
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
            className="sidebar__collapse"
            aria-label={
              sidebarCollapsed ? "展开侧边栏" : "收起为图标"
            }
            aria-expanded={!sidebarCollapsed}
            onClick={toggleSidebarCollapsed}
          >
            <Icon name="chevron-right" size={16} />
          </button>
          <button
            type="button"
            className="sidebar__close"
            aria-label="关闭导航"
            onClick={() => setSidebarOpen(false)}
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="sidebar__nav" aria-label="导航分组">
          {visibleGroups.map((group) => {
            const collapsed = collapsedGroups.has(group.key);
            const hasActive = group.key === activeGroupKey;
            return (
              <div
                className={`nav-group ${collapsed ? "is-collapsed" : ""}`}
                key={group.key}
              >
                <button
                  type="button"
                  className="nav-group__toggle"
                  aria-expanded={!collapsed}
                  aria-controls={`nav-group-${group.key}`}
                  onClick={() => toggleGroup(group.key)}
                  title={group.label}
                >
                  <Icon name={group.icon} size={18} />
                  <span className="nav-group__label">{group.label}</span>
                  <Icon
                    className="nav-group__chevron"
                    name={collapsed ? "chevron-right" : "chevron-down"}
                    size={14}
                  />
                  {hasActive ? <span className="nav-group__active-dot" aria-hidden="true" /> : null}
                </button>
                <div
                  className="nav-group__items"
                  id={`nav-group-${group.key}`}
                  hidden={collapsed}
                >
                  {group.items.map((item) => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={item.to === "/"}
                      className={({ isActive }) =>
                        `nav-item ${isActive ? "is-active" : ""}`
                      }
                      title={item.label}
                    >
                      <Icon name={item.icon} size={18} />
                      <span className="nav-item__label">{item.label}</span>
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="sidebar__footer">
          <div className="user-card">
            <Avatar name={identity.data?.displayName ?? "用户"} size={34} />
            <span className="user-card__copy">
              <strong>
                {identity.data?.displayName ??
                  (authenticated ? "已登录" : "未登录")}
              </strong>
              <span>
                {identity.data?.tenantName ?? "未选择工作区"}
                {identity.data?.roles?.length
                  ? ` · ${identity.data.roles.map((role) => zhRole(role)).join("/")}`
                  : authenticated
                    ? ""
                    : " · 未登录"}
              </span>
            </span>
            <div className="user-card__actions">
              <NavLink
                to="/settings"
                className="user-card__action"
                aria-label="个人设置"
              >
                <Icon name="settings" size={16} />
              </NavLink>
              {authenticated ? (
                <button
                  type="button"
                  className="user-card__action"
                  aria-label="退出登录"
                  title="退出登录"
                  onClick={logout}
                >
                  <Icon name="undo" size={16} />
                </button>
              ) : (
                <NavLink
                  to="/login"
                  className="user-card__action"
                  aria-label="登录"
                >
                  <Icon name="user" size={16} />
                </NavLink>
              )}
            </div>
          </div>
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
            <nav className="crumb" aria-label="面包屑">
              <span>控制台</span>
              {active.group ? (
                <>
                  <Icon name="chevron-right" size={13} />
                  <span>{active.group.label}</span>
                </>
              ) : null}
              {active.item ? (
                <>
                  <Icon name="chevron-right" size={13} />
                  <strong>{active.item.label}</strong>
                </>
              ) : null}
            </nav>
          </div>
          <div className="topbar__right">
            <span className="topbar__context">
              <Icon name="building" size={15} />
              {identity.data?.tenantName ?? "未选择工作区"}
            </span>
            <IconButton label={themeLabel} icon={
              preference === "system"
                ? "overview"
                : resolved === "dark"
                  ? "moon"
                  : "sun"
            } onClick={cyclePreference} />
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
        <AgentAssistant />
      </div>
    </div>
  );
}
