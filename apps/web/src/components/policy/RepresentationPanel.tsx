import { Badge, Button, EmptyState, ErrorNotice, LoadingRows, Panel } from "../ui.js";
import { titleCase } from "../../lib/format.js";
import type { EmployeeRepresentationView } from "../../lib/ops-types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface RepresentationPanelProps {
  openRepresentation: () => void;
  representations: QueryState<EmployeeRepresentationView[]>;
}

export function RepresentationPanel({
  openRepresentation,
  representations,
}: RepresentationPanelProps) {
  return (
    <Panel
      title="员工代表"
      subtitle="法律门禁引用的职工代表大会、工会与职工代表"
      flush
      action={
        <Button
          size="sm"
          variant="primary"
          icon="plus"
          onClick={openRepresentation}
        >
          添加员工代表
        </Button>
      }
    >
      {representations.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice
            error={representations.error}
            onRetry={representations.reload}
          />
        </div>
      ) : representations.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={2} />
        </div>
      ) : (representations.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="people"
          title="暂无员工代表记录"
          description="记录政策变更咨询的职工机构。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>机构</th>
                <th>类型</th>
                <th>法域</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {(representations.data ?? []).map((body) => (
                <tr key={body.id}>
                  <td>{body.bodyName}</td>
                  <td>{titleCase(body.bodyType)}</td>
                  <td>{body.jurisdiction}</td>
                  <td>
                    <Badge
                      tone={body.active ? "success" : "neutral"}
                    >
                      {body.active ? "生效中" : "未启用"}
                    </Badge>
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
