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
import { useAuth } from "../contexts/AuthContext.js";
import { useDocumentTitle } from "../lib/hooks.js";
import { api, ApiError } from "../lib/api.js";

type LoginMode = "password" | "feishu" | "token";

interface PasswordLoginResult {
  token: string;
  tenantId: string;
  userId: string;
  personId: string | null;
  roles: string[];
}

/**
 * 控制台登录：账号密码 / 飞书扫码 / OIDC 令牌 三种方式。
 * 密码登录由后端签发会话 JWT；飞书走 OAuth 回调；令牌用于已有 OIDC 部署。
 */
export function LoginPage() {
  useDocumentTitle("登录");
  const { updateSession, session } = useAuth();
  const [mode, setMode] = useState<LoginMode>(
    session.token ? "token" : "password",
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantId, setTenantId] = useState(session.tenantId);
  const [userId, setUserId] = useState(session.userId);
  const [personId, setPersonId] = useState(session.personId);
  const [token, setToken] = useState(session.token ?? "");
  const [error, setError] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  // 飞书 OAuth 回跳：#feishu-token=…&postLoginPath=…；失败以 ?error=… 返回。
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, "");
    const hashParams = new URLSearchParams(hash);
    const feishuToken = hashParams.get("feishu-token");
    const queryError = new URLSearchParams(window.location.search).get("error");
    if (queryError) {
      setRedirectError(queryError);
      window.history.replaceState(null, "", "/console/login");
      return;
    }
    if (!feishuToken) return;
    updateSession({
      tenantId: session.tenantId,
      userId: session.userId || "feishu-user",
      personId: session.personId,
      token: feishuToken,
    });
    const postLoginPath = hashParams.get("postLoginPath") ?? "/console";
    window.history.replaceState(null, "", postLoginPath);
    window.location.reload();
  }, [session, updateSession]);

  function enterConsole(next: {
    tenantId: string;
    userId: string;
    personId: string;
    token: string;
  }) {
    updateSession(next);
    window.location.pathname = "/console/";
    window.location.reload();
  }

  async function submitPassword() {
    setError(null);
    setVerifying(true);
    try {
      const result = await api<PasswordLoginResult>(
        "/api/v1/auth/password/login",
        {
          method: "POST",
          body: { email: email.trim(), password },
        },
      );
      enterConsole({
        tenantId: result.tenantId,
        userId: result.userId,
        personId: result.personId ?? "",
        token: result.token,
      });
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "登录失败，请稍后再试",
      );
    } finally {
      setVerifying(false);
    }
  }

  async function submitToken() {
    setError(null);
    setVerifying(true);
    const next = {
      tenantId: tenantId.trim(),
      userId: userId.trim(),
      personId: personId.trim(),
      token: token.trim(),
    };
    updateSession(next);
    try {
      const identity = await api<{
        personId?: string;
        roles: string[];
        tenantId: string;
      }>("/api/v1/platform/identity");
      updateSession({
        ...next,
        personId: identity.personId ?? next.personId,
        userId: next.userId || identity.personId || "oidc-user",
      });
      window.location.pathname = "/console/";
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? `${caught.message} (${caught.code})`
          : "无法校验会话，请检查令牌",
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="page">
      <div className="auth-logo">
        <img src="/brand/logo-vertical.png" alt="anari" width="132" />
      </div>
      <PageHeader
        eyebrow="控制台"
        title="登录 Anari N-Perform"
        description="账号密码、飞书企业账号或 OIDC 令牌均可登录。生产部署建议使用飞书或 OIDC。"
      />
      <Panel title="选择登录方式">
        {redirectError ? (
          <div className="section-gap">
            <InfoNotice tone="warning">{redirectError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="登录方式" htmlFor="login-mode">
          <Select
            id="login-mode"
            value={mode}
            onChange={(event) => setMode(event.target.value as LoginMode)}
          >
            <option value="password">账号密码登录</option>
            <option value="feishu">飞书企业账号</option>
            <option value="token">OIDC 令牌（高级）</option>
          </Select>
        </FormField>

        {mode === "password" ? (
          <div className="form-grid">
            {error ? (
              <div className="field--full">
                <InfoNotice tone="warning">{error}</InfoNotice>
              </div>
            ) : null}
            <FormField label="企业邮箱" htmlFor="login-email">
              <TextInput
                id="login-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="name@company.com"
                required
              />
            </FormField>
            <FormField label="密码" htmlFor="login-password">
              <TextInput
                id="login-password"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </FormField>
            <div className="field--full">
              <Button
                variant="primary"
                loading={verifying}
                disabled={!email.trim() || !password}
                onClick={() => void submitPassword()}
              >
                登录
              </Button>
            </div>
          </div>
        ) : null}

        {mode === "feishu" ? (
          <div className="form-grid">
            <div className="field--full">
              <a
                className="feishu-login"
                href="/api/v1/auth/feishu/authorize?postLoginPath=/console"
              >
                使用飞书登录
              </a>
            </div>
            <div className="field--full">
              <InfoNotice>
                跳转到飞书授权后自动返回。首次登录会创建基础员工账号，权限由管理员审批后生效。
              </InfoNotice>
            </div>
          </div>
        ) : null}

        {mode === "token" ? (
          <div className="form-grid">
            {error ? (
              <div className="field--full">
                <InfoNotice tone="warning">{error}</InfoNotice>
              </div>
            ) : null}
            <FormField label="租户 ID" htmlFor="login-tenant">
              <TextInput
                id="login-tenant"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
              />
            </FormField>
            <FormField label="Bearer 令牌" htmlFor="login-token">
              <TextInput
                id="login-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="eyJhbGciOi…"
                required
              />
            </FormField>
            <div className="field--full">
              <Button
                variant="primary"
                loading={verifying}
                disabled={!tenantId.trim() || !token.trim()}
                onClick={() => void submitToken()}
              >
                验证并进入
              </Button>
            </div>
            <div className="field--full">
              <p className="hint">
                <Badge tone="info">生产</Badge>{" "}
                令牌由企业 IdP 签发，API 校验 issuer/JWKS；仅保存在本浏览器会话。
              </p>
            </div>
          </div>
        ) : null}
      </Panel>
    </div>
  );
}
