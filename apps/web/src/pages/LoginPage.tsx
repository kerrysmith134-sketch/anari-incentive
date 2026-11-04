import { useState } from "react";
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

/**
 * Product-grade console sign-in. Two modes:
 * - DEV headers (local/demo deployments with AUTH_MODE=dev)
 * - Bearer token (production OIDC deployments; the token comes from the
 *   corporate IdP and the API validates issuer/audience/JWKS)
 * The chosen session is verified against GET /platform/identity before the
 * console is unlocked.
 */
export function LoginPage() {
  useDocumentTitle("Sign in");
  const { updateSession, session } = useAuth();
  const [mode, setMode] = useState(session.token ? "token" : "dev");
  const [tenantId, setTenantId] = useState(session.tenantId);
  const [userId, setUserId] = useState(session.userId);
  const [personId, setPersonId] = useState(session.personId);
  const [token, setToken] = useState(session.token ?? "");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  async function signIn() {
    setError(null);
    setVerifying(true);
    const next =
      mode === "token"
        ? { tenantId: tenantId.trim(), userId: "", personId: "", token: token.trim() }
        : {
            tenantId: tenantId.trim(),
            userId: userId.trim(),
            personId: personId.trim(),
            token: "",
          };
    updateSession(next);
    try {
      const identity = await api<{
        personId?: string;
        roles: string[];
        tenantId: string;
      }>("/api/v1/platform/identity");
      // Adopt the server-resolved person for token sessions.
      updateSession({
        ...next,
        personId: identity.personId ?? next.personId,
        userId: next.userId || identity.personId || "oidc-user",
      });
      window.location.hash = "";
      window.location.pathname =
        window.location.pathname.replace(/\/login\/?$/, "") +
        (window.location.pathname.endsWith("/") ? "" : "/");
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? `${caught.message} (${caught.code})`
          : "Could not verify the session against the API",
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Console access"
        title="Sign in"
        description="Verify a session against the API before entering the operations console. Production deployments use OIDC bearer tokens; dev headers only work when the API runs with AUTH_MODE=dev."
      />
      <Panel title="Session">
        <div className="form-grid">
          {error ? (
            <div className="field--full">
              <InfoNotice tone="warning">{error}</InfoNotice>
            </div>
          ) : null}
          <FormField label="Mode" htmlFor="login-mode">
            <Select
              id="login-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value)}
            >
              <option value="token">OIDC bearer token</option>
              <option value="dev">Dev headers (local only)</option>
            </Select>
          </FormField>
          <FormField label="Tenant ID" htmlFor="login-tenant">
            <TextInput
              id="login-tenant"
              value={tenantId}
              onChange={(event) => setTenantId(event.target.value)}
              required
            />
          </FormField>
          {mode === "token" ? (
            <FormField label="Bearer token" htmlFor="login-token">
              <TextInput
                id="login-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="eyJhbGciOi…"
                required
              />
            </FormField>
          ) : (
            <>
              <FormField label="User ID" htmlFor="login-user">
                <TextInput
                  id="login-user"
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                  required
                />
              </FormField>
              <FormField label="Person ID" htmlFor="login-person">
                <TextInput
                  id="login-person"
                  value={personId}
                  onChange={(event) => setPersonId(event.target.value)}
                  required
                />
              </FormField>
            </>
          )}
          <div className="field--full">
            <Button
              variant="primary"
              disabled={
                verifying ||
                !tenantId.trim() ||
                (mode === "token" ? !token.trim() : !userId.trim())
              }
              onClick={signIn}
            >
              {verifying ? "Verifying…" : "Unlock console"}
            </Button>
          </div>
        </div>
        <p className="hint">
          {mode === "token" ? (
            <>
              <Badge tone="info">Production</Badge> The token is validated by
              the API against the configured OIDC issuer/JWKS and is stored
              only in this browser session.
            </>
          ) : (
            <>
              <Badge tone="warning">Development only</Badge> Dev headers can
              impersonate any user; the API refuses them in production
              (AUTH_MODE=oidc).
            </>
          )}
        </p>
      </Panel>
    </div>
  );
}
