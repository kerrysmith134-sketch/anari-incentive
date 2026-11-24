import { Badge, Button, EmptyState, ErrorNotice, LoadingRows, Panel } from "../ui.js";
import { formatDateTime, titleCase } from "../../lib/format.js";
import type { PolicyConsultationView } from "../../lib/ops-types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface ConsultationPanelProps {
  consultations: QueryState<PolicyConsultationView[]>;
  openConclude: (consultation: PolicyConsultationView) => void;
  openConsultation: () => void;
}

export function ConsultationPanel({
  consultations,
  openConclude,
  openConsultation,
}: ConsultationPanelProps) {
  return (
    <Panel
      title="政策咨询"
      subtitle="与员工代表的讨论、意见征集与协商"
      flush
      action={
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          onClick={openConsultation}
        >
          记录咨询
        </Button>
      }
    >
      {consultations.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice
            error={consultations.error}
            onRetry={consultations.reload}
          />
        </div>
      ) : consultations.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={2} />
        </div>
      ) : (consultations.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="people"
          title="暂无咨询记录"
          description="记录法律门禁引用的民主程序证据。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>类型</th>
                <th>已开始</th>
                <th>结论</th>
                <th>纪要</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(consultations.data ?? []).map((consultation) => (
                <tr key={consultation.id}>
                  <td>{titleCase(consultation.consultationType)}</td>
                  <td className="nowrap">
                    {formatDateTime(consultation.startedAt)}
                  </td>
                  <td>
                    <Badge status={consultation.outcome} />
                  </td>
                  <td className="mono">
                    {consultation.minutesRef ?? "—"}
                  </td>
                  <td className="cell-actions">
                    {consultation.outcome === "PENDING" ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => openConclude(consultation)}
                      >
                        结论
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
