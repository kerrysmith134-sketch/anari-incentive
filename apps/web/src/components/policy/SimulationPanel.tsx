import { Button, Panel } from "../ui.js";
import { shortId } from "../../lib/format.js";
import type { PolicySimulationResultView } from "../../lib/ops-types.js";

export interface SimulationPanelProps {
  openMarginal: () => void;
  openSimulation: () => void;
  simResult: PolicySimulationResultView | null;
}

export function SimulationPanel({
  openMarginal,
  openSimulation,
  simResult,
}: SimulationPanelProps) {
  return (
    <Panel
      title="政策模拟"
      subtitle="以代表性输入重放当前与拟议政策；仅作决策支持"
      action={
        <div className="row-actions">
          <Button
            size="sm"
            variant="secondary"
            icon="play"
            onClick={openMarginal}
          >
            边际扫描
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="play"
            onClick={openSimulation}
          >
            运行模拟
          </Button>
        </div>
      }
    >
      {simResult ? (
        <>
          <div className="coverage-grid">
            <div className="coverage-cell">
              <div className="coverage-cell__label">当前总额</div>
              <div className="coverage-cell__value">
                {simResult.currentTotal}
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">拟调整总额</div>
              <div className="coverage-cell__value">
                {simResult.proposedTotal}
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">差额</div>
              <div className="coverage-cell__value">
                {simResult.deltaTotal}
              </div>
            </div>
            <div className="coverage-cell">
              <div className="coverage-cell__label">影响人数</div>
              <div className="coverage-cell__value">
                {simResult.affectedPeople}
              </div>
            </div>
          </div>
          {simResult.blockers.length > 0 ? (
            <div className="chip-row section-gap">
              {simResult.blockers.map((blocker) => (
                <span className="chip" key={blocker}>
                  {blocker}
                </span>
              ))}
            </div>
          ) : null}
          <div className="table-wrap section-gap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>人员</th>
                  <th>当前</th>
                  <th>拟调整</th>
                  <th>差额</th>
                </tr>
              </thead>
              <tbody>
                {simResult.lines.map((line) => (
                  <tr key={line.personId}>
                    <td className="mono">
                      {shortId(line.personId, 10)}
                    </td>
                    <td>{line.currentAmount}</td>
                    <td>{line.proposedAmount}</td>
                    <td>{line.delta}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <p className="muted">
          Paste representative calculation inputs to compare the current
          policy with a proposed definition. No ledger or policy is
          written.
        </p>
      )}
    </Panel>
  );
}
