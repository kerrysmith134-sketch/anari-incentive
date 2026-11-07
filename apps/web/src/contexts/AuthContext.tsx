import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  loadSession,
  saveSession,
  setApiSession,
  type Session,
} from "../lib/api.js";

interface AuthContextValue {
  session: Session;
  updateSession: (next: Session) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session>(() => loadSession());

  useEffect(() => {
    setApiSession(session);
    saveSession(session);
  }, [session]);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      updateSession: (next) => {
        setApiSession(next);
        setSession(next);
      },
    }),
    [session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth 必须在 AuthProvider 内使用");
  return context;
}
