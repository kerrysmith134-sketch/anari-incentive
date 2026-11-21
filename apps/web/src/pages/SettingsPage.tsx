import { useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  CopyButton,
  DefinitionList,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  PageHeader,
  Panel,
  Select,
  Textarea,
  TextInput,
} from "../components/ui.js";
import {
  PersonalStatusSection,
  SubscriptionSection,
} from "../components/settings/personal-sections.js";
import { FairnessGovernanceSection } from "../components/settings/fairness-section.js";
import { DataProtectionSection } from "../components/settings/privacy-section.js";
import { RetentionSection } from "../components/settings/retention-section.js";
import { ComplianceSection } from "../components/settings/compliance-section.js";
import { IncentiveGovernanceSection } from "../components/settings/incentive-governance-section.js";
import { Icon } from "../components/Icon.js";
import { Link } from "react-router-dom";
import {
  PersonSelect,
  usePeople,
} from "../components/PersonSelect.js";
import { useAuth } from "../contexts/AuthContext.js";
import { useToast } from "../contexts/ToastContext.js";
import { ApiError, api, DEFAULT_SESSION } from "../lib/api.js";
import { zhClawbackReason, zhStatus } from "../lib/zh.js";
import { useApiQuery, useDocumentTitle } from "../lib/hooks.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  formatMoney,
  shortId,
  titleCase,
} from "../lib/format.js";
import type {
  AuditRedaction,
  BreakGlassGrant,
  BudgetPool,
  CalibrationSession,
  ClawbackCase,
  ClawbackSchedule,
  ConflictDeclaration,
  DataClassification,
  DataMapReport,
  DiscretionaryPoolReview,
  DpiaRecord,
  FairnessCommitment,
  FieldAccessPolicyMatrix,
  DsarRequest,
  ManagerTrainingRecord,
  ModelProviderPolicy,
  PilotEnrollment,
  PlatformIdentity,
  RetentionDisposalRequest,
  RetentionPolicy,
  RetentionRecommendation,
  RetentionRecommendationsReport,
  TrustSurveyReport,
  TrustSurveyRun,
} from "../lib/types.js";

export function SettingsPage() {
  useDocumentTitle("设置");
  const { session, updateSession } = useAuth();
  const toast = useToast();
  const identity = useApiQuery<PlatformIdentity>("/api/v1/platform/identity");
  // 治理/合规设置只对 manager/finance/admin 展示；员工的相应接口本就 403。
  // 未确认角色前按无权限处理（fail-closed），确认后再放行相应查询。
  const identityRoles = identity.data?.roles ?? [];
  const canGovern = identityRoles.some((role) =>
    ["admin", "manager", "finance"].includes(role),
  );
  const { people } = usePeople();
  const governPath = (path: string) => (canGovern ? path : null);
  const fieldPolicies = useApiQuery<FieldAccessPolicyMatrix>(
    governPath("/api/v1/field-access-policies"),
  );
  const disposals = useApiQuery<RetentionDisposalRequest[]>(
    governPath("/api/v1/retention-disposal-requests"),
  );
  const grants = useApiQuery<BreakGlassGrant[]>(
    governPath("/api/v1/break-glass-grants"),
  );
  const [token, setToken] = useState(session.token ?? "");
  const [tenantId, setTenantId] = useState(session.tenantId);
  const [userId, setUserId] = useState(session.userId);
  const [personId, setPersonId] = useState(session.personId);
  const [revokeReason, setRevokeReason] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantSaving, setGrantSaving] = useState(false);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [granteeId, setGranteeId] = useState(session.personId);
  const [grantedById, setGrantedById] = useState(session.personId);
  const [grantReason, setGrantReason] = useState("");
  const [disposalProcessing, setDisposalProcessing] = useState(false);
  const [disposalOpen, setDisposalOpen] = useState(false);
  const [disposalPolicy, setDisposalPolicy] = useState("");
  const [disposalReason, setDisposalReason] = useState("");
  const [disposalRequester, setDisposalRequester] = useState(
    session.personId,
  );
  const [disposalSaving, setDisposalSaving] = useState(false);
  const [disposalError, setDisposalError] = useState<string | null>(null);

  function saveSession(event: FormEvent) {
    event.preventDefault();
    updateSession({
      tenantId: tenantId.trim(),
      userId: userId.trim(),
      personId: personId.trim(),
      token: token.trim(),
    });
    toast.success(
      "会话已更新",
      "正在刷新以应用租户与人员上下文。",
    );
    window.setTimeout(() => window.location.reload(), 450);
  }

  function resetSession() {
    updateSession(DEFAULT_SESSION);
    setTenantId(DEFAULT_SESSION.tenantId);
    setUserId(DEFAULT_SESSION.userId);
    setPersonId(DEFAULT_SESSION.personId);
    setToken("");
    toast.success("会话已重置", "已恢复开发默认值。");
    window.setTimeout(() => window.location.reload(), 450);
  }

  async function saveDisposal(event: FormEvent) {
    event.preventDefault();
    setDisposalSaving(true);
    setDisposalError(null);
    try {
      await api(
        `/api/v1/retention-policies/${disposalPolicy}/disposal-requests`,
        {
          method: "POST",
          body: {
            requestedBy: disposalRequester,
            reason: disposalReason.trim(),
          },
        },
      );
      toast.success(
        "处置请求已创建",
        "需另一人批准，随后进入宽限期。",
      );
      setDisposalOpen(false);
      disposals.reload();
    } catch (error) {
      setDisposalError(
        error instanceof Error
          ? error.message
          : "Could not create the disposal request.",
      );
    } finally {
      setDisposalSaving(false);
    }
  }

  async function approveDisposal(request: RetentionDisposalRequest) {
    setDisposalSaving(true);
    try {
      await api(
        `/api/v1/retention-disposal-requests/${request.id}/approve`,
        {
          method: "POST",
          body: { approvedBy: session.personId },
        },
      );
      toast.success("留存销毁已批准");
      disposals.reload();
    } catch (error) {
      toast.error(
        "审批处置失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setDisposalSaving(false);
    }
  }
  async function processDueDisposals() {
    setDisposalProcessing(true);
    try {
      const result = await api<{
        processedCount: number;
        skipped: Array<{ requestId: string; reason: string }>;
      }>("/api/v1/retention-disposal-requests:process", {
        method: "POST",
        body: { actorPersonId: session.personId },
      });
      toast.success(
        "销毁处理完成",
        `已完成 ${result.processedCount} 项${
          result.skipped.length > 0
            ? `，跳过 ${result.skipped.length} 项（法务保全或门禁）`
            : ""
        }`,
      );
      disposals.reload();
    } catch (error) {
      toast.error(
        "处理销毁失败",
        error instanceof Error ? error.message : "操作失败。",
      );
    } finally {
      setDisposalProcessing(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="工作区"
        title="设置"
        description="会话身份、外观与本租户的保障登记簿。"
      />


      {!canGovern ? (
        <InfoNotice tone="info">
          治理与合规设置（保障记录、保留策略、数据源登记、利益冲突、信任调查、
          承诺发布、经理赋能、紧急授权、追回案例、机动池、模型策略、审计脱敏、
          字段权限）仅对 manager/finance/admin 展示；当前视图只包含个人设置、
          订阅与试点登记。
        </InfoNotice>
      ) : null}
      <div className="split-grid">
        <Panel
          title="会话上下文"
          subtitle="每次 API 调用以 x-tenant-id / x-user-id / x-person-id 发送"
        >
          <form onSubmit={saveSession} className="stack">
            <FormField
              label="租户 ID"
              htmlFor="session-tenant"
              hint="开发模式可用 tenant-demo；PostgreSQL 模式请用租户 UUID。"
            >
              <TextInput
                id="session-tenant"
                value={tenantId}
                onChange={(event) => setTenantId(event.target.value)}
                required
              />
            </FormField>
            <FormField label="用户 ID" htmlFor="session-user">
              <TextInput
                id="session-user"
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="人员 ID"
              htmlFor="session-person"
              hint="用于审批归属、薪酬职责分离与个人范围请求。"
            >
              <TextInput
                id="session-person"
                value={personId}
                onChange={(event) => setPersonId(event.target.value)}
                required
              />
            </FormField>
            <FormField
              label="OIDC Bearer 令牌（可选）"
              htmlFor="session-token"
              hint="API 以 AUTH_MODE=oidc 运行时使用；仅存本浏览器，生产建议网关注入。"
            >
              <TextInput
                id="session-token"
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="eyJhbGciOi…"
                autoComplete="off"
                spellCheck={false}
              />
            </FormField>
            <div className="form-actions">
              <Button variant="ghost" onClick={resetSession}>
                重置默认
              </Button>
              <Button variant="primary" type="submit" icon="check">
                保存会话
              </Button>
            </div>
          </form>
          <InfoNotice tone="warning">
            <strong>请求头认证仅用于开发环境。</strong> In OIDC
            mode the server ignores these headers and derives identity from the
            signed token.
          </InfoNotice>
          <Link className="btn btn--secondary" to="/my-ai">
            <Icon name="ai" size={16} />
            <span>打开我的 AI 记录</span>
          </Link>
        </Panel>

        <PersonalStatusSection
          session={{ tenantId: session.tenantId, personId: session.personId }}
          auditChainPath={governPath("/api/v1/audit-events/verify")}
        />
      </div>

      {canGovern ? (<>
      <div className="section-gap">
        <PageHeader
          eyebrow="登记簿"
          title="保障记录"
          description="正式周期依赖的隐私与保留物证的只读视图。"
        />
      </div>
      </>) : null}

      <FairnessGovernanceSection
        session={{ personId: session.personId }}
        governPath={governPath}
        people={people}
        canGovern={canGovern}
      />

      <DataProtectionSection
        session={{ personId: session.personId }}
        governPath={governPath}
        people={people}
        canGovern={canGovern}
      />

      <RetentionSection
        session={{ personId: session.personId }}
        governPath={governPath}
        people={people}
        canGovern={canGovern}
      />

      <ComplianceSection
        session={{ personId: session.personId }}
        governPath={governPath}
        people={people}
        canGovern={canGovern}
      />

      <IncentiveGovernanceSection
        session={{ personId: session.personId }}
        governPath={governPath}
        people={people}
        canGovern={canGovern}
      />
    </>
  );
}
