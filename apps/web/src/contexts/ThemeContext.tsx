import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemePreference = "light" | "dark" | "system";

interface ThemeContextValue {
  preference: ThemePreference;
  resolved: "light" | "dark";
  setPreference: (value: ThemePreference) => void;
  toggle: () => void;
  /** 三态循环：system → light → dark → system（设计规范要求可回到 system）。 */
  cyclePreference: () => void;
}

const STORAGE_KEY = "anari-theme";
const LEGACY_STORAGE_KEY = "anari.theme";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readPreference(): ThemePreference {
  try {
    const value =
      localStorage.getItem(STORAGE_KEY) ??
      localStorage.getItem(LEGACY_STORAGE_KEY);
    if (value === "light" || value === "dark" || value === "system") {
      return value;
    }
  } catch {
    /* ignore */
  }
  return "system";
}

function systemDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(readPreference);
  const [systemIsDark, setSystemIsDark] = useState(systemDark);
  const resolved: "light" | "dark" =
    preference === "system"
      ? systemIsDark
        ? "dark"
        : "light"
      : preference;

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return;
    const listener = (event: MediaQueryListEvent) =>
      setSystemIsDark(event.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (preference === "system") delete root.dataset.theme;
    else root.dataset.theme = preference;
    // 主题色 meta 由 CSS 令牌统一管理，这里只切换 data-theme。
    try {
      if (preference === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      /* ignore */
    }
  }, [preference, resolved]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      preference,
      resolved,
      setPreference: setPreferenceState,
      toggle: () =>
        setPreferenceState(resolved === "dark" ? "light" : "dark"),
      cyclePreference: () =>
        setPreferenceState(
          preference === "system"
            ? "light"
            : preference === "light"
              ? "dark"
              : "system",
        ),
    }),
    [preference, resolved],  // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return context;
}
