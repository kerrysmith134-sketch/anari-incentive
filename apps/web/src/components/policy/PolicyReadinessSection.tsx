import type { Dispatch, SetStateAction } from "react";
import { Badge, Button, ErrorNotice, InfoNotice, LoadingRows, Panel } from "../ui.js";
import { Icon } from "../Icon.js";
import { clickableRowProps } from "../../lib/a11y.js";
import { formatDate, formatDateTime, shortId, titleCase } from "../../lib/format.js";
import type { PolicyReadinessReport, PolicyVersionSummary } from "../../lib/types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface PolicyReadinessSectionProps {
  list: PolicyVersionSummary[];
  openGate: () => void;
  readiness: QueryState<PolicyReadinessReport>;
  selected: PolicyVersionSummary | undefined;
  selectedId: string | null;
  setSelectedId: Dispatch<SetStateAction<string | null>>;
}

export function PolicyReadinessSection({
  list,
  openGate,
  readiness,
  selected,
  selectedId,
  setSelectedId,
}: PolicyReadinessSectionProps) {
  return (
    <div className="split-grid">
      <Panel
        title="政策版本"
        subtitle={`${list.length} published or seeded version${list.length === 1 ? "" : "s"}`}
        flush
      >
        <div className="table-wrap">
          <table className="data-table table-clickable">
            <thead>
              <tr>
                <th>政策</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {list.map((version) => (
                <tr
                  key={version.policyVersionId}
                  className={
                    version.policyVersionId === selectedId ? "is-selected" : ""
                  }
                  {...clickableRowProps(() =>
                    setSelectedId(version.policyVersionId),
                  )}
                >
                  <td>
                    <span className="cell-primary" style={{ overflowWrap: "anywhere" }}>
                      {version.code}
                    </span>
                    <span className="cell-sub">
                      v{version.version}
                      {version.effectiveFrom
                        ? ` · effective ${formatDate(version.effectiveFrom)}`
                        : ""}
                    </span>
                    <span className="cell-sub mono">
                      {shortId(version.policyVersionId, 10)}
                    </span>
                  </td>
                  <td>
                    <Badge status={version.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="政策就绪度"
        subtitle={
          selected
            ? `${selected.code} v${selected.version} · ${formatDateTime(readiness.data?.generatedAt)}`
            : undefined
        }
        action={
          <div className="row-actions">
            <Button
              size="sm"
              variant="secondary"
              onClick={openGate}
              disabled={!selectedId}
            >
              记录门禁
            </Button>
            {readiness.data ? (
              <Badge
                tone={readiness.data.ready ? "success" : "danger"}
              >
                {readiness.data.ready ? "Ready" : "已阻断"}
              </Badge>
            ) : null}
          </div>
        }
      >
        {readiness.error ? (
          <ErrorNotice error={readiness.error} onRetry={readiness.reload} />
        ) : readiness.loading || !readiness.data ? (
          <LoadingRows rows={4} />
        ) : (
          <>
            {selected?.applicability ? (
              <div className="chip-row" style={{ marginBottom: 14 }}>
                <span className="chip">
                  {selected.applicability.legalEntity}
                </span>
                <span className="chip">
                  {selected.applicability.jurisdictions.join(", ")}
                </span>
                <span className="chip">
                  {selected.applicability.workLocations.join(", ")}
                </span>
                <span className="chip">
                  {selected.applicability.employeeCategories.join(", ")}
                </span>
                <span className="chip">
                  {selected.applicability.workTimeTypes.join(", ")}
                </span>
              </div>
            ) : (
              <InfoNotice tone="warning">
                该政策未记录适用范围。新发布政策必须声明法人、法域、工作地、
                员工类别与工时类型。
              </InfoNotice>
            )}
            <div className="coverage-grid">
              <div className="coverage-cell">
                <div className="coverage-cell__label">法律门禁</div>
                <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                  {readiness.data.legalGate.approved ? (
                    <Badge tone="success">已批准</Badge>
                  ) : readiness.data.legalGate.recorded ? (
                    <Badge tone="warning">已记录</Badge>
                  ) : (
                    <Badge tone="danger">缺失</Badge>
                  )}
                </div>
                <div className="coverage-cell__sub">
                  {readiness.data.legalGate.blockers.length} 项阻断
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">用例通过</div>
                <div className="coverage-cell__value">
                  {readiness.data.tests.passed}/{readiness.data.tests.active}
                </div>
                <div className="coverage-cell__sub">
                  {readiness.data.tests.failed} 失败 ·{" "}
                  {readiness.data.tests.notRun} 未运行
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">告知完成</div>
                <div className="coverage-cell__value">
                  {readiness.data.notices.complete}/{readiness.data.notices.linked}
                </div>
                <div className="coverage-cell__sub">
                  {readiness.data.notices.acknowledgementRequired} 需签收
                </div>
              </div>
              <div className="coverage-cell">
                <div className="coverage-cell__label">DPIA</div>
                <div className="coverage-cell__value" style={{ fontSize: 15 }}>
                  {readiness.data.dpia.approved ? (
                    <Badge tone="success">已批准</Badge>
                  ) : readiness.data.dpia.referenced ? (
                    <Badge tone="warning">
                      {titleCase(readiness.data.dpia.status ?? "referenced")}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">未引用</Badge>
                  )}
                </div>
                <div className="coverage-cell__sub">
                  {readiness.data.consultations.concluded} consultation
                  {readiness.data.consultations.concluded === 1 ? "" : "s"} concluded
                </div>
              </div>
            </div>

            {readiness.data.blockers.length > 0 ? (
              <div className="notice notice--danger section-gap">
                <Icon name="alert-circle" size={18} />
                <div>
                  <strong>{readiness.data.blockers.length} readiness blocker(s)</strong>
                  <div className="chip-row" style={{ marginTop: 6 }}>
                    {readiness.data.blockers.map((blocker) => (
                      <span className="chip" key={blocker}>
                        {blocker}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="notice notice--success section-gap">
                <Icon name="check-circle" size={18} />
                <div>
                  <strong>无就绪度阻断</strong>
                  <p>本版本可用于正式计算。</p>
                </div>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
