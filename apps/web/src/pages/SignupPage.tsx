import { useEffect, useState } from "react";
import {
  Badge,
  Button,
  FormField,
  InfoNotice,
  PageHeader,
  Panel,
  Select,
  TextInput,
} from "../components/ui.js";
import { ApiError, api } from "../lib/api.js";
import type { SubscriptionPlanView } from "../lib/ops-types.js";
import { useDocumentTitle } from "../lib/hooks.js";

interface SignupResult {
  tenantId: string;
  slug: string;
  userId: string;
  personId: string;
  subscription: { planCode: string; status: string } | null;
  nextSteps: string;
}

export function SignupPage() {
  useDocumentTitle("注册");
  const [plans, setPlans] = useState<SubscriptionPlanView[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [planCode, setPlanCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SignupResult | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<SubscriptionPlanView[]>("/api/v1/public/plans")
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  async function submit() {
    setError(null);
    setSubmitting(true);
    try {
      const response = await api<SignupResult>("/api/v1/public/signup", {
        method: "POST",
        body: {
          companyName: companyName.trim(),
          adminDisplayName: adminName.trim(),
          adminEmail: adminEmail.trim(),
          planCode: planCode || undefined,
          acceptTerms: true,
        },
      });
      setResult(response);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not sign up",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page">
      <div className="auth-logo">
        <img src="/brand/logo-vertical.png" alt="anari" width="132" />
      </div>
      <PageHeader
        title="创建企业工作区"
        description="一键开通租户、管理员账号与试用订阅；登录走企业邮箱密码或飞书。"
      />

      {result ? (
        <Panel title="Workspace ready">
          <div className="stat-grid">
            <div>
              <div className="stat-label">Tenant</div>
              <div className="stat-value">{result.slug}</div>
            </div>
            <div>
              <div className="stat-label">Tenant ID</div>
              <div className="stat-value">
                <code>{result.tenantId}</code>
              </div>
            </div>
            <div>
              <div className="stat-label">Subscription</div>
              <div className="stat-value">
                {result.subscription
                  ? `${result.subscription.planCode} · ${result.subscription.status}`
                  : "None"}
              </div>
            </div>
          </div>
          <InfoNotice>{result.nextSteps}</InfoNotice>
        </Panel>
      ) : (
        <Panel title="企业信息">
          <div className="form-grid">
            {error ? (
              <div className="field--full">
                <InfoNotice tone="warning">{error}</InfoNotice>
              </div>
            ) : null}
            <FormField label="企业名称" htmlFor="signup-company">
              <TextInput
                id="signup-company"
                value={companyName}
                onChange={(event) => setCompanyName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="你的姓名" htmlFor="signup-name">
              <TextInput
                id="signup-name"
                value={adminName}
                onChange={(event) => setAdminName(event.target.value)}
                required
              />
            </FormField>
            <FormField label="企业邮箱" htmlFor="signup-email">
              <TextInput
                id="signup-email"
                type="email"
                value={adminEmail}
                onChange={(event) => setAdminEmail(event.target.value)}
                required
              />
            </FormField>
            <FormField label="套餐" htmlFor="signup-plan">
              <Select
                id="signup-plan"
                value={planCode}
                onChange={(event) => setPlanCode(event.target.value)}
              >
                <option value="">暂不选择套餐</option>
                {plans.map((plan) => (
                  <option key={plan.id} value={plan.code}>
                    {plan.name} · {plan.monthlyPrice} {plan.currency}/mo ·{" "}
                    {plan.seatLimit < 0 ? "unlimited" : plan.seatLimit} seats ·{" "}
                    {plan.trialDays}d trial
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="field--full">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={accepted}
                  onChange={(event) => setAccepted(event.target.checked)}
                />{" "}
                I accept the terms of service and the data-processing
                agreement.
              </label>
            </div>
            <div className="field--full">
              <Button
                variant="primary"
                disabled={
                  submitting ||
                  !accepted ||
                  !companyName.trim() ||
                  !adminName.trim() ||
                  !adminEmail.trim()
                }
                onClick={submit}
              >
                {submitting ? "创建中…" : "创建工作区"}
              </Button>
            </div>
          </div>
          {plans.length === 0 ? (
            <p className="hint">
              <Badge tone="neutral">No public plans</Badge> The operator has
              not published plans yet; you can still create the workspace and
              subscribe later.
            </p>
          ) : null}
        </Panel>
      )}
    </div>
  );
}
