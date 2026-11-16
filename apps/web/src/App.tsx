import {
  Component,
  lazy,
  Suspense,
  type ErrorInfo,
  type ReactNode,
} from "react";
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
import { Button } from "./components/ui.js";

const LoginPage = lazy(() =>
  import("./pages/LoginPage.js").then((module) => ({
    default: module.LoginPage,
  })),
);
const NotificationsPage = lazy(() =>
  import("./pages/NotificationsPage.js").then((module) => ({
    default: module.NotificationsPage,
  })),
);
const MyRewardsPage = lazy(() =>
  import("./pages/MyRewardsPage.js").then((module) => ({
    default: module.MyRewardsPage,
  })),
);
const MyWorkbenchPage = lazy(() =>
  import("./pages/MyWorkbenchPage.js").then((module) => ({
    default: module.MyWorkbenchPage,
  })),
);
const ManagementCenterPage = lazy(() =>
  import("./pages/ManagementCenterPage.js").then((module) => ({
    default: module.ManagementCenterPage,
  })),
);
const FinanceCenterPage = lazy(() =>
  import("./pages/FinanceCenterPage.js").then((module) => ({
    default: module.FinanceCenterPage,
  })),
);
const PerformancePage = lazy(() =>
  import("./pages/PerformancePage.js").then((module) => ({
    default: module.PerformancePage,
  })),
);
const CommissionPage = lazy(() =>
  import("./pages/CommissionPage.js").then((module) => ({
    default: module.CommissionPage,
  })),
);
const EquityPage = lazy(() =>
  import("./pages/EquityPage.js").then((module) => ({
    default: module.EquityPage,
  })),
);
const BountyPage = lazy(() =>
  import("./pages/BountyPage.js").then((module) => ({
    default: module.BountyPage,
  })),
);
const InstitutionsPage = lazy(() =>
  import("./pages/InstitutionsPage.js").then((module) => ({
    default: module.InstitutionsPage,
  })),
);
const TaskPodPage = lazy(() =>
  import("./pages/TaskPodPage.js").then((module) => ({
    default: module.TaskPodPage,
  })),
);
const AwardBatchPage = lazy(() =>
  import("./pages/AwardBatchPage.js").then((module) => ({
    default: module.AwardBatchPage,
  })),
);
const PrivacyPage = lazy(() =>
  import("./pages/PrivacyPage.js").then((module) => ({
    default: module.PrivacyPage,
  })),
);
const SignupPage = lazy(() =>
  import("./pages/SignupPage.js").then((module) => ({
    default: module.SignupPage,
  })),
);
const DashboardPage = lazy(() =>
  import("./pages/DashboardPage.js").then((module) => ({
    default: module.DashboardPage,
  })),
);
const AdverseActionsPage = lazy(() =>
  import("./pages/AdverseActionsPage.js").then((module) => ({
    default: module.AdverseActionsPage,
  })),
);
const AiPage = lazy(() =>
  import("./pages/AiPage.js").then((module) => ({
    default: module.AiPage,
  })),
);
const AgentOpsPage = lazy(() =>
  import("./pages/AgentOpsPage.js").then((module) => ({
    default: module.AgentOpsPage,
  })),
);
const ApprovalsPage = lazy(() =>
  import("./pages/ApprovalsPage.js").then((module) => ({
    default: module.ApprovalsPage,
  })),
);
const AuditPage = lazy(() =>
  import("./pages/AuditPage.js").then((module) => ({
    default: module.AuditPage,
  })),
);
const CyclesPage = lazy(() =>
  import("./pages/CyclesPage.js").then((module) => ({
    default: module.CyclesPage,
  })),
);
const ContributionPage = lazy(() =>
  import("./pages/ContributionPage.js").then((module) => ({
    default: module.ContributionPage,
  })),
);
const ExceptionsPage = lazy(() =>
  import("./pages/ExceptionsPage.js").then((module) => ({
    default: module.ExceptionsPage,
  })),
);
const IntegrationsPage = lazy(() =>
  import("./pages/IntegrationsPage.js").then((module) => ({
    default: module.IntegrationsPage,
  })),
);
const PayrollPage = lazy(() =>
  import("./pages/PayrollPage.js").then((module) => ({
    default: module.PayrollPage,
  })),
);
const MyAiPage = lazy(() =>
  import("./pages/MyAiPage.js").then((module) => ({
    default: module.MyAiPage,
  })),
);
const PeoplePage = lazy(() =>
  import("./pages/PeoplePage.js").then((module) => ({
    default: module.PeoplePage,
  })),
);
const PolicyPage = lazy(() =>
  import("./pages/PolicyPage.js").then((module) => ({
    default: module.PolicyPage,
  })),
);
const RewardsPage = lazy(() =>
  import("./pages/RewardsPage.js").then((module) => ({
    default: module.RewardsPage,
  })),
);
const RegistriesPage = lazy(() =>
  import("./pages/RegistriesPage.js").then((module) => ({
    default: module.RegistriesPage,
  })),
);
const FieldAccessPage = lazy(() =>
  import("./pages/FieldAccessPage.js").then((module) => ({
    default: module.FieldAccessPage,
  })),
);
const PlatformAdminPage = lazy(() =>
  import("./pages/PlatformAdminPage.js").then((module) => ({
    default: module.PlatformAdminPage,
  })),
);
const GovernanceHubPage = lazy(() =>
  import("./pages/GovernanceHubPage.js").then((module) => ({
    default: module.GovernanceHubPage,
  })),
);
const SettlementsPage = lazy(() =>
  import("./pages/SettlementsPage.js").then((module) => ({
    default: module.SettlementsPage,
  })),
);
const SettingsPage = lazy(() =>
  import("./pages/SettingsPage.js").then((module) => ({
    default: module.SettingsPage,
  })),
);

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
          <h3>控制台出现错误</h3>
          <p>{this.state.error.message}</p>
          <Button
            variant="primary"
            onClick={() => window.location.reload()}
            className="empty-state__action"
          >
            重新加载控制台
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageFallback() {
  return (
    <div className="loading-inline" style={{ minHeight: "50vh", justifyContent: "center" }}>
      <span className="spinner" /> 正在加载视图…
    </div>
  );
}

function NotFoundPage() {
  return (
    <div className="empty-state" style={{ minHeight: "60vh" }}>
      <span className="eyebrow">404</span>
      <h3>页面不存在</h3>
      <p>控制台仅提供侧边栏中列出的页面。</p>
      <Link to="/" className="btn btn--primary empty-state__action">
        返回总览
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
              跳到主要内容
            </a>
            <AppShell>
              <ErrorBoundary>
                <Suspense fallback={<PageFallback />}>
                  <Routes>
                    <Route path="/" element={<DashboardPage />} />
                    <Route path="/signup" element={<SignupPage />} />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/approvals" element={<ApprovalsPage />} />
                    <Route path="/cycles" element={<CyclesPage />} />
                    <Route path="/contribution" element={<ContributionPage />} />
                    <Route path="/performance" element={<PerformancePage />} />
                    <Route path="/my-workbench" element={<MyWorkbenchPage />} />
                    <Route path="/my-rewards" element={<MyRewardsPage />} />
                    <Route path="/management" element={<ManagementCenterPage />} />
                    <Route path="/finance-center" element={<FinanceCenterPage />} />
                    <Route path="/notifications" element={<NotificationsPage />} />
                    <Route path="/commission" element={<CommissionPage />} />
                    <Route path="/equity" element={<EquityPage />} />
                    <Route path="/bounty" element={<BountyPage />} />
                    <Route path="/institutions" element={<InstitutionsPage />} />
                    <Route path="/task-pods" element={<TaskPodPage />} />
                    <Route path="/award-batches" element={<AwardBatchPage />} />
                    <Route path="/privacy" element={<PrivacyPage />} />
                    <Route path="/payroll" element={<PayrollPage />} />
                    <Route path="/rewards" element={<RewardsPage />} />
                    <Route path="/registries" element={<RegistriesPage />} />
                    <Route path="/field-access" element={<FieldAccessPage />} />
                    <Route path="/platform" element={<PlatformAdminPage />} />
                    <Route path="/governance" element={<GovernanceHubPage />} />
                    <Route path="/settlements" element={<SettlementsPage />} />
                    <Route path="/adverse-actions" element={<AdverseActionsPage />} />
                    <Route path="/ai" element={<AiPage />} />
                    <Route path="/agent-ops" element={<AgentOpsPage />} />
                    <Route path="/policy" element={<PolicyPage />} />
                    <Route path="/exceptions" element={<ExceptionsPage />} />
                    <Route path="/audit" element={<AuditPage />} />
                    <Route path="/integrations" element={<IntegrationsPage />} />
                    <Route path="/people" element={<PeoplePage />} />
                    <Route path="/my-ai" element={<MyAiPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
              </ErrorBoundary>
            </AppShell>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
