import { Component, type ErrorInfo, type ReactNode } from "react";
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
} from "react-router-dom";
import { AppShell } from "./components/AppShell.js";
import { AuthProvider } from "./contexts/AuthContext.js";
import { ThemeProvider } from "./contexts/ThemeContext.js";
import { ToastProvider } from "./contexts/ToastContext.js";
import { AiPage } from "./pages/AiPage.js";
import { ApprovalsPage } from "./pages/ApprovalsPage.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { IntegrationsPage } from "./pages/IntegrationsPage.js";
import { PayrollPage } from "./pages/PayrollPage.js";
import { PeoplePage } from "./pages/PeoplePage.js";
import { PolicyPage } from "./pages/PolicyPage.js";
import { RewardsPage } from "./pages/RewardsPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import { Button } from "./components/ui.js";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Console render failed", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="empty-state" style={{ minHeight: "70vh" }}>
          <h3>Something broke in the console</h3>
          <p>{this.state.error.message}</p>
          <Button
            variant="primary"
            onClick={() => window.location.reload()}
            className="empty-state__action"
          >
            Reload console
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function NotFoundPage() {
  return (
    <div className="empty-state" style={{ minHeight: "60vh" }}>
      <span className="eyebrow">404</span>
      <h3>That view does not exist</h3>
      <p>The console only exposes the routes in the sidebar.</p>
      <Link to="/" className="btn btn--primary empty-state__action">
        Back to overview
      </Link>
    </div>
  );
}

export function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter basename="/console">
            <a className="skip-link" href="#main">
              Skip to content
            </a>
            <AppShell>
              <ErrorBoundary>
                <Routes>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/approvals" element={<ApprovalsPage />} />
                  <Route path="/payroll" element={<PayrollPage />} />
                  <Route path="/rewards" element={<RewardsPage />} />
                  <Route path="/ai" element={<AiPage />} />
                  <Route path="/policy" element={<PolicyPage />} />
                  <Route path="/integrations" element={<IntegrationsPage />} />
                  <Route path="/people" element={<PeoplePage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </ErrorBoundary>
            </AppShell>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
