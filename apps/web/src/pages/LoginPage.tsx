import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Button,
  FormField,
  InfoNotice,
  PageHeader,
  Panel,
  TextInput,
} from "../components/ui.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useDocumentTitle } from "../lib/hooks.js";
import { api, ApiError } from "../lib/api.js";

interface PasswordLoginResult {
  token: string;
  tenantId: string;
  userId: string;
  personId: string | null;
  roles: string[];
}

interface IdentityResult {
  userId?: string;
  personId?: string;
  tenantId?: string;
  roles: string[];
}

/**
 * 控制台统一登录：飞书企业账号为主入口，账号密码为后备。
 * 只有一条会话路径：后端签发 SessionJwt → 前端只存 token，身份由
 * /platform/identity 解析；不再提供手填令牌入口。
 */
export function LoginPage() {
  useDocumentTitle("登录");
  const { session, updateSession } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

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
    let cancelled = false;
    setVerifying(true);
    (async () => {
      try {
        updateSession({ ...session, token: feishuToken });
        const identity = await api<IdentityResult>(
          "/api/v1/platform/identity",
        );
        if (cancelled) return;
        updateSession({
          tenantId: identity.tenantId ?? session.tenantId,
          userId: identity.userId ?? "",
          personId: identity.personId ?? "",
          token: feishuToken,
        });
        const postLoginPath = hashParams.get("postLoginPath") ?? "/console";
        window.history.replaceState(null, "", postLoginPath);
        window.location.reload();
      } catch (caught) {
        if (cancelled) return;
        setRedirectError(
          caught instanceof ApiError
            ? `飞书登录成功，但会话校验失败：${caught.message}`
            : "飞书登录成功，但会话校验失败",
        );
        setVerifying(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function enterConsole(result: PasswordLoginResult) {
    updateSession({
      tenantId: result.tenantId,
      userId: result.userId,
      personId: result.personId ?? "",
      token: result.token,
    });
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
      enterConsole(result);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "登录失败，请稍后再试",
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="page login-page">
      <div className="auth-logo">
        <img src="/brand/logo-vertical.png" alt="anari" width="132" />
      </div>
      <PageHeader
        eyebrow="控制台"
        title="登录 Anari N-Perform"
        description="推荐使用飞书企业账号登录；首次登录自动同步组织架构并创建基础员工账号。"
      />
      <Panel title="登录">
        {redirectError ? (
          <div className="section-gap">
            <InfoNotice tone="warning">{redirectError}</InfoNotice>
          </div>
        ) : null}

        <div className="field--full login-feishu">
          <a
            className="feishu-login"
            href="/api/v1/auth/feishu/authorize?postLoginPath=/console"
          >
            使用飞书企业账号登录
          </a>
          <p className="hint">
            跳转到飞书授权后自动返回；组织架构（部门/汇报线）随登录自动同步。
          </p>
        </div>

        <div className="login-divider" role="separator">
          <span>或使用账号密码</span>
        </div>

        {!showPassword ? (
          <div className="field--full">
            <Button
              variant="secondary"
              onClick={() => setShowPassword(true)}
              disabled={verifying}
            >
              使用账号密码登录
            </Button>
          </div>
        ) : (
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
        )}

        <div className="field--full login-footer">
          <p className="hint">
            没有工作区？
            <Link to="/signup">创建企业工作区</Link>
          </p>
        </div>
      </Panel>
    </div>
  );
}
