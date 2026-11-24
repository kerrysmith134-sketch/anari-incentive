import type { Dispatch, SetStateAction } from "react";
import {
  Badge,
  Button,
  DefinitionList,
  FormField,
  InfoNotice,
  Modal,
  Select,
  TextInput,
  Textarea,
} from "../ui.js";
import type { PolicyVersionSummary } from "../../lib/types.js";
import type { MarginalSimulationView } from "../../lib/ops-types.js";

export interface SimulationModalProps {
  list: PolicyVersionSummary[];
  runSimulation: () => void;
  setSimCurrentId: Dispatch<SetStateAction<string>>;
  setSimOpen: Dispatch<SetStateAction<boolean>>;
  setSimProposed: Dispatch<SetStateAction<string>>;
  setSimSamples: Dispatch<SetStateAction<string>>;
  simCurrentId: string;
  simError: string | null;
  simOpen: boolean;
  simProposed: string;
  simRunning: boolean;
  simSamples: string;
}

export function SimulationModal({
  list,
  runSimulation,
  setSimCurrentId,
  setSimOpen,
  setSimProposed,
  setSimSamples,
  simCurrentId,
  simError,
  simOpen,
  simProposed,
  simRunning,
  simSamples,
}: SimulationModalProps) {
  return (
    <Modal
      open={simOpen}
      title="政策模拟"
      description="当前政策从所选版本载入；粘贴拟议定义与代表性输入即可模拟。"
      onClose={() => setSimOpen(false)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => setSimOpen(false)}>
            关闭
          </Button>
          <Button
            variant="primary"
            onClick={runSimulation}
            loading={simRunning}
            disabled={!simCurrentId}
          >
            模拟
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {simError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{simError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="当前政策版本" htmlFor="sim-current">
          <Select
            id="sim-current"
            value={simCurrentId}
            onChange={(event) => setSimCurrentId(event.target.value)}
            required
          >
            <option value="">选择版本…</option>
            {list.map((version) => (
              <option
                key={version.policyVersionId}
                value={version.policyVersionId}
              >
                {version.code} v{version.version}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField
          label="拟议政策（JSON）"
          htmlFor="sim-proposed"
          className="field--full"
        >
          <Textarea
            id="sim-proposed"
            value={simProposed}
            onChange={(event) => setSimProposed(event.target.value)}
            rows={12}
            spellCheck={false}
          />
        </FormField>
        <FormField
          label="Samples (JSON: [{ personId, input }])"
          htmlFor="sim-samples"
          className="field--full"
          hint="使用计算批次输入结构；至少一个样本。"
        >
          <Textarea
            id="sim-samples"
            value={simSamples}
            onChange={(event) => setSimSamples(event.target.value)}
            rows={8}
            spellCheck={false}
          />
        </FormField>
      </div>
    </Modal>
  );
}

export interface MarginalSweepModalProps {
  marginalError: string | null;
  marginalField: "attributionWeight" | "evaluationMultiplier";
  marginalFrom: string;
  marginalIndex: string;
  marginalOpen: boolean;
  marginalResult: MarginalSimulationView | null;
  marginalRunning: boolean;
  marginalSample: string;
  marginalStep: string;
  marginalTo: string;
  runMarginal: () => void;
  setMarginalField: Dispatch<SetStateAction<"attributionWeight" | "evaluationMultiplier">>;
  setMarginalFrom: Dispatch<SetStateAction<string>>;
  setMarginalIndex: Dispatch<SetStateAction<string>>;
  setMarginalOpen: Dispatch<SetStateAction<boolean>>;
  setMarginalSample: Dispatch<SetStateAction<string>>;
  setMarginalStep: Dispatch<SetStateAction<string>>;
  setMarginalTo: Dispatch<SetStateAction<string>>;
}

export function MarginalSweepModal({
  marginalError,
  marginalField,
  marginalFrom,
  marginalIndex,
  marginalOpen,
  marginalResult,
  marginalRunning,
  marginalSample,
  marginalStep,
  marginalTo,
  runMarginal,
  setMarginalField,
  setMarginalFrom,
  setMarginalIndex,
  setMarginalOpen,
  setMarginalSample,
  setMarginalStep,
  setMarginalTo,
}: MarginalSweepModalProps) {
  return (
    <Modal
      open={marginalOpen}
      title="边际阈值扫描"
      description="对参与人字段做小幅步进，暴露金额跳档效应。"
      onClose={() => setMarginalOpen(false)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => setMarginalOpen(false)}>
            关闭
          </Button>
          <Button
            variant="primary"
            onClick={runMarginal}
            loading={marginalRunning}
          >
            扫描
          </Button>
        </>
      }
    >
      <div className="form-grid">
        {marginalError ? (
          <div className="field--full">
            <InfoNotice tone="warning">{marginalError}</InfoNotice>
          </div>
        ) : null}
        <FormField label="参与人序号" htmlFor="marginal-index">
          <TextInput
            id="marginal-index"
            value={marginalIndex}
            onChange={(event) => setMarginalIndex(event.target.value)}
          />
        </FormField>
        <FormField label="字段" htmlFor="marginal-field">
          <Select
            id="marginal-field"
            value={marginalField}
            onChange={(event) =>
              setMarginalField(
                event.target.value as
                  | "attributionWeight"
                  | "evaluationMultiplier",
              )
            }
          >
            <option value="attributionWeight">认定权重</option>
            <option value="evaluationMultiplier">评价乘数</option>
          </Select>
        </FormField>
        <FormField label="From" htmlFor="marginal-from">
          <TextInput
            id="marginal-from"
            value={marginalFrom}
            onChange={(event) => setMarginalFrom(event.target.value)}
            required
          />
        </FormField>
        <FormField label="To" htmlFor="marginal-to">
          <TextInput
            id="marginal-to"
            value={marginalTo}
            onChange={(event) => setMarginalTo(event.target.value)}
            required
          />
        </FormField>
        <FormField label="Step" htmlFor="marginal-step">
          <TextInput
            id="marginal-step"
            value={marginalStep}
            onChange={(event) => setMarginalStep(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="样本（JSON）"
          htmlFor="marginal-sample"
          className="field--full"
        >
          <Textarea
            id="marginal-sample"
            value={marginalSample}
            onChange={(event) => setMarginalSample(event.target.value)}
            rows={8}
            spellCheck={false}
          />
        </FormField>
      </div>
      {marginalResult ? (
        <div className="detail-section">
          <DefinitionList
            items={[
              {
                label: "扫描",
                value: `${marginalResult.field} ${marginalResult.from} → ${marginalResult.to} (step ${marginalResult.step})`,
              },
              {
                label: "Max target delta",
                value: marginalResult.maxDelta,
              },
            ]}
          />
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>值</th>
                  <th>合计</th>
                  <th>目标金额</th>
                  <th>目标差额</th>
                </tr>
              </thead>
              <tbody>
                {marginalResult.points.map((point) => (
                  <tr key={point.value}>
                    <td className="mono">{point.value}</td>
                    <td>{point.total}</td>
                    <td>{point.targetAmount}</td>
                    <td>
                      <Badge
                        tone={
                          point.targetDelta === "0" ? "neutral" : "warning"
                        }
                      >
                        {point.targetDelta}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="subtle" style={{ fontSize: 11.5 }}>
            {marginalResult.note}
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
