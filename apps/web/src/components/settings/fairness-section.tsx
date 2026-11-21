/**
 * NP-032 阶段 2（2026-11-21 审计）：公平性与赋能治理域——
 * 信任调查 / 无报复承诺 / 经理赋能（培训+校准）/ 试点登记四个面板
 * 及其表单模态。自持查询与状态；仅接收会话/目录/治理路径。
 */
import { useState } from "react";
import type { FormEvent } from "react";
import {
  Badge,
  Button,
  DefinitionList,
  EmptyState,
  ErrorNotice,
  FormField,
  InfoNotice,
  LoadingRows,
  Modal,
  Panel,
  Select,
  TextInput,
  Textarea,
} from "../ui.js";
import { useApiQuery } from "../../lib/hooks.js";
import { api, ApiError } from "../../lib/api.js";
import { useToast } from "../../contexts/ToastContext.js";
import { PersonSelect } from "../PersonSelect.js";
import { BarChart } from "../charts.js";
import {
  displayName,
  formatDate,
  formatDateTime,
  shortId,
  titleCase,
} from "../../lib/format.js";
import type {
  CalibrationSession,
  FairnessCommitment,
  ManagerTrainingRecord,
  PilotEnrollment,
  TrustSurveyReport,
  TrustSurveyRun,
} from "../../lib/types.js";

export function FairnessGovernanceSection({
  session,
  governPath,
  people,
  canGovern,
}: {
  session: { personId: string };
  governPath: (path: string) => string | null;
  /** 人员目录（展示名解析）。 */
  people: Array<{ id: string; displayName: string }>;
  canGovern: boolean;
}) {
  const toast = useToast();
  const trustSurveys = useApiQuery<TrustSurveyRun[]>(
    governPath("/api/v1/trust-surveys"),
  );
  const commitments = useApiQuery<FairnessCommitment[]>(
    governPath("/api/v1/fairness-commitments"),
  );
  const training = useApiQuery<ManagerTrainingRecord[]>(
    governPath("/api/v1/manager-training-records"),
  );
  const calibrations = useApiQuery<CalibrationSession[]>(
    governPath("/api/v1/calibration-sessions"),
  );
  const pilots = useApiQuery<PilotEnrollment[]>("/api/v1/pilot-enrollments");

const [surveyOpen, setSurveyOpen] = useState(false);
const [surveySaving, setSurveySaving] = useState(false);
const [surveyError, setSurveyError] = useState<string | null>(null);
const [surveyCode, setSurveyCode] = useState("TRUST_QUARTERLY");
const [surveyPeriod, setSurveyPeriod] = useState("2026-Q4");
const [surveyTitle, setSurveyTitle] = useState(
  "季度信任与程序公平调查",
);
const [surveyQuestions, setSurveyQuestions] = useState<
  Array<{ code: string; prompt: string; dimension: string }>
>([{ code: "FAIRNESS", prompt: "", dimension: "FAIRNESS" }]);
const [respondTarget, setRespondTarget] = useState<TrustSurveyRun | null>(
  null,
);
const [respondentId, setRespondentId] = useState(session.personId);
const [responseScores, setResponseScores] = useState<
  Record<string, string>
>({});
const [responseError, setResponseError] = useState<string | null>(null);
const [reportTarget, setReportTarget] = useState<TrustSurveyRun | null>(
  null,
);
const report = useApiQuery<TrustSurveyReport>(
  reportTarget
    ? `/api/v1/trust-surveys/${reportTarget.id}/report`
    : null,
);
const [commitmentOpen, setCommitmentOpen] = useState(false);
const [commitmentSaving, setCommitmentSaving] = useState(false);
const [commitmentError, setCommitmentError] = useState<string | null>(null);
const [commitmentStatement, setCommitmentStatement] = useState("");
const [commitmentOwner, setCommitmentOwner] = useState(session.personId);
const [commitmentChannels, setCommitmentChannels] = useState(
  "INTRANET, TOWN_HALL",
);
const [trainingOpen, setTrainingOpen] = useState(false);
const [trainingSaving, setTrainingSaving] = useState(false);
const [trainingError, setTrainingError] = useState<string | null>(null);
const [trainingPerson, setTrainingPerson] = useState(session.personId);
const [trainingCode, setTrainingCode] = useState("FAIRNESS_101");
const [trainingTitle, setTrainingTitle] = useState(
  "公平激励沟通",
);
const [trainingCompletedAt, setTrainingCompletedAt] = useState(
  new Date().toISOString().slice(0, 10),
);
const [trainingExpiresAt, setTrainingExpiresAt] = useState("");
const [trainingEvidence, setTrainingEvidence] = useState("");
const [calibrationOpen, setCalibrationOpen] = useState(false);
const [calibrationSaving, setCalibrationSaving] = useState(false);
const [calibrationError, setCalibrationError] = useState<string | null>(
  null,
);
const [calibrationCode, setCalibrationCode] = useState("CAL-2026-Q4");
const [calibrationTitle, setCalibrationTitle] = useState(
  "评级校准",
);
const [calibrationHeldAt, setCalibrationHeldAt] = useState(
  new Date().toISOString().slice(0, 10),
);
const [calibrationFacilitator, setCalibrationFacilitator] = useState(
  session.personId,
);
const [calibrationAttendees, setCalibrationAttendees] = useState<string[]>(
  [],
);
const [calibrationNotes, setCalibrationNotes] = useState("");
const [pilotOpen, setPilotOpen] = useState(false);
const [pilotSaving, setPilotSaving] = useState(false);
const [pilotError, setPilotError] = useState<string | null>(null);
const [pilotPerson, setPilotPerson] = useState(session.personId);
const [pilotCode, setPilotCode] = useState("PILOT-2026");
const [pilotScope, setPilotScope] = useState("");
const [pilotConsent, setPilotConsent] = useState("");

function openCommitmentForm() {
  setCommitmentStatement("");
  setCommitmentOwner(session.personId);
  setCommitmentChannels("INTRANET, TOWN_HALL");
  setCommitmentError(null);
  setCommitmentOpen(true);
}

async function publishCommitment(event: FormEvent) {
  event.preventDefault();
  setCommitmentSaving(true);
  setCommitmentError(null);
  try {
    await api("/api/v1/fairness-commitments", {
      method: "POST",
      body: {
        statement: commitmentStatement.trim(),
        ownerPersonId: commitmentOwner,
        channels: commitmentChannels
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean),
      },
    });
    toast.success(
      "承诺已发布",
      "The prior version is retained as superseded.",
    );
    setCommitmentOpen(false);
    commitments.reload();
  } catch (error) {
    setCommitmentError(
      error instanceof Error
        ? error.message
        : "Could not publish the commitment.",
    );
  } finally {
    setCommitmentSaving(false);
  }
}

function openSurveyForm() {
  setSurveyCode("TRUST_QUARTERLY");
  setSurveyPeriod("2026-Q4");
  setSurveyTitle("季度信任与程序公平调查");
  setSurveyQuestions([{ code: "FAIRNESS", prompt: "", dimension: "FAIRNESS" }]);
  setSurveyError(null);
  setSurveyOpen(true);
}

async function saveSurvey(event: FormEvent) {
  event.preventDefault();
  setSurveySaving(true);
  setSurveyError(null);
  try {
    await api("/api/v1/trust-surveys", {
      method: "POST",
      body: {
        code: surveyCode.trim(),
        period: surveyPeriod.trim(),
        title: surveyTitle.trim(),
        questions: surveyQuestions
          .filter(
            (question) =>
              question.code.trim() &&
              question.prompt.trim() &&
              question.dimension.trim(),
          )
          .map((question) => ({
            code: question.code.trim(),
            prompt: question.prompt.trim(),
            dimension: question.dimension.trim(),
          })),
      },
    });
    toast.success("信任度调研已创建", "题目准备好后即可发布。");
    setSurveyOpen(false);
    trustSurveys.reload();
  } catch (error) {
    setSurveyError(
      error instanceof Error
        ? error.message
        : "Could not create the survey.",
    );
  } finally {
    setSurveySaving(false);
  }
}

async function changeSurveyStatus(
  survey: TrustSurveyRun,
  action: "open" | "close",
) {
  try {
    await api(`/api/v1/trust-surveys/${survey.id}/${action}`, {
      method: "POST",
    });
    toast.success(
      action === "open" ? "Survey opened" : "Survey closed",
      survey.title,
    );
    trustSurveys.reload();
  } catch (error) {
    toast.error(
      action === "open" ? "Could not open survey" : "Could not close survey",
      error instanceof Error ? error.message : "操作失败。",
    );
  }
}

function openRespond(survey: TrustSurveyRun) {
  setRespondTarget(survey);
  setRespondentId(session.personId);
  setResponseScores(
    Object.fromEntries(survey.questions.map((question) => [question.code, ""])),
  );
  setResponseError(null);
}

async function submitSurveyResponse(event: FormEvent) {
  event.preventDefault();
  if (!respondTarget) return;
  setSurveySaving(true);
  setResponseError(null);
  try {
    const scores: Record<string, number> = {};
    for (const question of respondTarget.questions) {
      const value = Number(responseScores[question.code]);
      if (!Number.isFinite(value) || value < 1 || value > 5) {
        throw new Error(
          `Enter a score from 1 to 5 for ${question.prompt}`,
        );
      }
      scores[question.code] = value;
    }
    await api(`/api/v1/trust-surveys/${respondTarget.id}/responses`, {
      method: "POST",
      body: { personId: respondentId, scores },
    });
    toast.success(
      "响应已记录",
      "Only a pseudonymous hash is stored with the scores.",
    );
    setRespondTarget(null);
    trustSurveys.reload();
  } catch (error) {
    setResponseError(
      error instanceof Error
        ? error.message
        : "Could not record the response.",
    );
  } finally {
    setSurveySaving(false);
  }
}

function openPilotForm() {
  setPilotPerson(session.personId);
  setPilotCode("PILOT-2026");
  setPilotScope("");
  setPilotConsent("");
  setPilotError(null);
  setPilotOpen(true);
}

async function savePilot(event: FormEvent) {
  event.preventDefault();
  setPilotSaving(true);
  setPilotError(null);
  try {
    await api("/api/v1/pilot-enrollments", {
      method: "POST",
      body: {
        personId: pilotPerson,
        pilotCode: pilotCode.trim(),
        scope: pilotScope.trim(),
        consentSignatureRef: pilotConsent.trim(),
      },
    });
    toast.success("试点登记已记录");
    setPilotOpen(false);
    pilots.reload();
  } catch (error) {
    setPilotError(
      error instanceof Error
        ? error.message
        : "Could not record the enrollment.",
    );
  } finally {
    setPilotSaving(false);
  }
}

async function withdrawPilot(enrollment: PilotEnrollment) {
  setPilotSaving(true);
  try {
    await api(`/api/v1/pilot-enrollments/${enrollment.id}/withdraw`, {
      method: "POST",
      body: {
        personId: enrollment.personId,
        reason: "Voluntary withdrawal from the console",
      },
    });
    toast.success("试点登记已撤回");
    pilots.reload();
  } catch (error) {
    toast.error(
      "撤回试点登记失败",
      error instanceof Error ? error.message : "操作失败。",
    );
  } finally {
    setPilotSaving(false);
  }
}

function openTrainingForm() {
  setTrainingPerson(session.personId);
  setTrainingCode("FAIRNESS_101");
  setTrainingTitle("公平激励沟通");
  setTrainingCompletedAt(new Date().toISOString().slice(0, 10));
  setTrainingExpiresAt("");
  setTrainingEvidence("");
  setTrainingError(null);
  setTrainingOpen(true);
}

async function saveTraining(event: FormEvent) {
  event.preventDefault();
  setTrainingSaving(true);
  setTrainingError(null);
  try {
    await api("/api/v1/manager-training-records", {
      method: "POST",
      body: {
        personId: trainingPerson,
        trainingCode: trainingCode.trim(),
        title: trainingTitle.trim(),
        completedAt: new Date(`${trainingCompletedAt}T00:00:00Z`).toISOString(),
        expiresAt: trainingExpiresAt
          ? new Date(`${trainingExpiresAt}T00:00:00Z`).toISOString()
          : undefined,
        evidenceRef: trainingEvidence.trim() || undefined,
      },
    });
    toast.success("培训已记录");
    setTrainingOpen(false);
    training.reload();
  } catch (error) {
    setTrainingError(
      error instanceof Error
        ? error.message
        : "Could not record the training.",
    );
  } finally {
    setTrainingSaving(false);
  }
}

function openCalibrationForm() {
  setCalibrationCode("CAL-2026-Q4");
  setCalibrationTitle("评级校准");
  setCalibrationHeldAt(new Date().toISOString().slice(0, 10));
  setCalibrationFacilitator(session.personId);
  setCalibrationAttendees([]);
  setCalibrationNotes("");
  setCalibrationError(null);
  setCalibrationOpen(true);
}

async function saveCalibration(event: FormEvent) {
  event.preventDefault();
  setCalibrationSaving(true);
  setCalibrationError(null);
  try {
    await api("/api/v1/calibration-sessions", {
      method: "POST",
      body: {
        code: calibrationCode.trim(),
        title: calibrationTitle.trim(),
        heldAt: new Date(`${calibrationHeldAt}T00:00:00Z`).toISOString(),
        facilitatorPersonId: calibrationFacilitator,
        attendeePersonIds: calibrationAttendees,
        notes: calibrationNotes.trim() || undefined,
      },
    });
    toast.success("校准会已记录");
    setCalibrationOpen(false);
    calibrations.reload();
  } catch (error) {
    setCalibrationError(
      error instanceof Error
        ? error.message
        : "Could not record the calibration session.",
    );
  } finally {
    setCalibrationSaving(false);
  }
}

  return (
    <>
    {canGovern ? (<>
    <Panel
      title="信任调查"
      subtitle="关于公平、发声与流程信心的匿名季度调查"
      className="section-gap"
      action={
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          onClick={openSurveyForm}
        >
          创建调查
        </Button>
      }
      flush
    >
      {trustSurveys.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice
            error={trustSurveys.error}
            onRetry={trustSurveys.reload}
          />
        </div>
      ) : trustSurveys.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={3} />
        </div>
      ) : (trustSurveys.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="people"
          title="暂无信任调查"
          description="创建调查→开放作答→关闭后与上期对比维度均值。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>调查</th>
                <th>周期</th>
                <th>状态</th>
                <th className="cell-num">题目</th>
                <th>窗口</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {trustSurveys.data?.map((survey) => (
                <tr key={survey.id}>
                  <td>
                    <span className="cell-primary">{survey.title}</span>
                    <span className="cell-sub mono">{survey.code}</span>
                  </td>
                  <td>{survey.period}</td>
                  <td>
                    <Badge status={survey.status} />
                  </td>
                  <td className="cell-num">{survey.questions.length}</td>
                  <td className="nowrap">
                    {survey.openedAt
                      ? formatDate(survey.openedAt)
                      : "Not opened"}
                    {survey.closedAt
                      ? ` – ${formatDate(survey.closedAt)}`
                      : ""}
                  </td>
                  <td className="cell-actions">
                    <div className="row-actions">
                      {survey.status === "DRAFT" ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void changeSurveyStatus(survey, "open")}
                        >
                          待处理
                        </Button>
                      ) : null}
                      {survey.status === "OPEN" ? (
                        <>
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => openRespond(survey)}
                          >
                            作答
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              void changeSurveyStatus(survey, "close")
                            }
                          >
                            关闭
                          </Button>
                        </>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setReportTarget(survey)}
                      >
                        报告
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
    </>) : null}

    <Modal
      open={surveyOpen}
      title="创建调查"
      description="题目按 1–5 分作答；响应仅存假名哈希与得分。"
      onClose={() => setSurveyOpen(false)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={() => setSurveyOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="survey-form"
            loading={surveySaving}
          >
            创建调查
          </Button>
        </>
      }
    >
      <form id="survey-form" className="stack" onSubmit={saveSurvey}>
        {surveyError ? (
          <InfoNotice tone="warning">{surveyError}</InfoNotice>
        ) : null}
        <div className="form-grid">
          <FormField label="编码" htmlFor="survey-code">
            <TextInput
              id="survey-code"
              value={surveyCode}
              onChange={(event) => setSurveyCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="周期" htmlFor="survey-period">
            <TextInput
              id="survey-period"
              value={surveyPeriod}
              onChange={(event) => setSurveyPeriod(event.target.value)}
              required
            />
          </FormField>
          <FormField
            label="标题"
            htmlFor="survey-title"
            className="field--full"
          >
            <TextInput
              id="survey-title"
              value={surveyTitle}
              onChange={(event) => setSurveyTitle(event.target.value)}
              required
            />
          </FormField>
        </div>
        <div className="detail-section">
          <div className="detail-section__title">题目</div>
          <div className="stack">
            {surveyQuestions.map((question, index) => (
              <div className="form-grid" key={index}>
                <FormField
                  label="编码"
                  htmlFor={`survey-question-code-${index}`}
                >
                  <TextInput
                    id={`survey-question-code-${index}`}
                    value={question.code}
                    onChange={(event) =>
                      setSurveyQuestions((current) =>
                        current.map((candidate, position) =>
                          position === index
                            ? { ...candidate, code: event.target.value }
                            : candidate,
                        ),
                      )
                    }
                    required
                  />
                </FormField>
                <FormField
                  label="提示词"
                  htmlFor={`survey-question-prompt-${index}`}
                >
                  <TextInput
                    id={`survey-question-prompt-${index}`}
                    value={question.prompt}
                    onChange={(event) =>
                      setSurveyQuestions((current) =>
                        current.map((candidate, position) =>
                          position === index
                            ? {
                                ...candidate,
                                prompt: event.target.value,
                              }
                            : candidate,
                        ),
                      )
                    }
                    required
                  />
                </FormField>
                <FormField
                  label="维度"
                  htmlFor={`survey-question-dimension-${index}`}
                >
                  <TextInput
                    id={`survey-question-dimension-${index}`}
                    value={question.dimension}
                    onChange={(event) =>
                      setSurveyQuestions((current) =>
                        current.map((candidate, position) =>
                          position === index
                            ? {
                                ...candidate,
                                dimension: event.target.value,
                              }
                            : candidate,
                        ),
                      )
                    }
                    required
                  />
                </FormField>
                <Button
                  variant="ghost"
                  size="sm"
                  type="button"
                  disabled={surveyQuestions.length === 1}
                  onClick={() =>
                    setSurveyQuestions((current) =>
                      current.filter((_, position) => position !== index),
                    )
                  }
                >
                  移除
                </Button>
              </div>
            ))}
          </div>
          <Button
            variant="secondary"
            size="sm"
            type="button"
            icon="plus"
            onClick={() =>
              setSurveyQuestions((current) => [
                ...current,
                { code: "", prompt: "", dimension: "" },
              ])
            }
          >
            添加题目
          </Button>
        </div>
      </form>
    </Modal>

    <Modal
      open={Boolean(respondTarget)}
      title="参与调查"
      onClose={() => setRespondTarget(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setRespondTarget(null)}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="survey-response-form"
            loading={surveySaving}
          >
            提交作答
          </Button>
        </>
      }
    >
      {respondTarget ? (
        <form
          id="survey-response-form"
          className="stack"
          onSubmit={submitSurveyResponse}
        >
          {responseError ? (
            <InfoNotice tone="warning">{responseError}</InfoNotice>
          ) : null}
          <DefinitionList
            items={[
              { label: "调查", value: respondTarget.title },
              { label: "周期", value: respondTarget.period },
              {
                label: "Anonymity",
                value: "Only a pseudonymous hash is stored with scores.",
              },
            ]}
          />
          <FormField label="作答人" htmlFor="survey-respondent">
            <PersonSelect
              id="survey-respondent"
              value={respondentId}
              onChange={setRespondentId}
            />
          </FormField>
          <div className="form-grid">
            {respondTarget.questions.map((question) => (
              <FormField
                key={question.code}
                label={question.prompt}
                htmlFor={`survey-score-${question.code}`}
                hint="1 = 非常不同意 · 5 = 非常同意"
              >
                <TextInput
                  id={`survey-score-${question.code}`}
                  type="number"
                  min={1}
                  max={5}
                  step={1}
                  value={responseScores[question.code] ?? ""}
                  onChange={(event) =>
                    setResponseScores((current) => ({
                      ...current,
                      [question.code]: event.target.value,
                    }))
                  }
                  required
                />
              </FormField>
            ))}
          </div>
        </form>
      ) : null}
    </Modal>

    <Modal
      open={Boolean(reportTarget)}
      title={reportTarget ? `${reportTarget.title} · report` : "Survey report"}
      onClose={() => setReportTarget(null)}
      wide
    >
      {report.error ? (
        <ErrorNotice error={report.error} onRetry={report.reload} />
      ) : report.loading || !report.data ? (
        <LoadingRows rows={4} />
      ) : (
        <div className="stack">
          <DefinitionList
            items={[
              { label: "周期", value: report.data.survey.period },
              {
                label: "Responses",
                value: report.data.responseCount,
              },
              {
                label: "状态",
                value: <Badge status={report.data.survey.status} />,
              },
            ]}
          />
          <div className="detail-section">
            <div className="detail-section__title">维度均值</div>
            <div className="stack" style={{ gap: 6 }}>
              {Object.entries(report.data.dimensions).map(
                ([dimension, score]) => {
                  const baseline =
                    report.data?.baseline?.dimensions[dimension];
                  return (
                    <div
                      key={dimension}
                      className="inline"
                      style={{ justifyContent: "space-between", width: "100%" }}
                    >
                      <span>{titleCase(dimension)}</span>
                      <span className="muted">
                        {score.toFixed(2)} / 5
                        {baseline !== undefined
                          ? ` · baseline ${baseline.toFixed(2)}`
                          : " · no baseline"}
                      </span>
                    </div>
                  );
                },
              )}
            </div>
          </div>
          <div className="detail-section">
            <div className="detail-section__title">题目均值</div>
            <div className="stack" style={{ gap: 6 }}>
              {report.data.survey.questions.map((question) => (
                <div
                  key={question.code}
                  className="inline"
                  style={{ justifyContent: "space-between", width: "100%" }}
                >
                  <span>{question.prompt}</span>
                  <span className="muted">
                    {report.data?.averages[question.code]?.toFixed(2) ?? "—"} /
                    5
                  </span>
                </div>
              ))}
            </div>
          </div>
          {report.data.baseline ? (
            (() => {
              // NP-035：公平性漂移——当期维度均分 vs 基线调查（1–5 分制）。
              const dimensions = Object.keys(report.data!.dimensions);
              const bars = dimensions.flatMap((dimension) => [
                {
                  label: `当期 ${dimension}`,
                  value:
                    Math.round((report.data!.dimensions[dimension] ?? 0) * 100) / 100,
                },
                {
                  label: `基线 ${dimension}`,
                  value:
                    Math.round(
                      (report.data!.baseline!.dimensions[dimension] ?? 0) * 100,
                    ) / 100,
                },
              ]);
              return (
                <BarChart
                  title="公平性漂移（当期 vs 基线）"
                  summary={`当期调查（${report.data!.responseCount} 份响应）与基线调查（${report.data!.baseline.period}，${report.data!.baseline.responseCount} 份）的维度均分对比；1–5 分制，漂移即公平信号。`}
                  bars={bars}
                  table={{
                    caption: "公平性漂移数据表（NP-035）",
                    headers: ["系列", "维度", "均分"],
                    rows: bars.map((bar) => [
                      bar.label.startsWith("当期") ? "当期" : "基线",
                      bar.label.replace(/^(当期|基线) /, ""),
                      bar.value,
                    ]),
                  }}
                />
              );
            })()
          ) : (
            <InfoNotice>
              公平性漂移图需要基线调查（最近一次同代码已关闭调查）——当前无基线可对比。
            </InfoNotice>
          )}
          <InfoNotice>
            Result aggregation suppresses individual responses. Baseline
            compares the most recent closed survey with the same code.
          </InfoNotice>
        </div>
      )}
    </Modal>

    {canGovern ? (<>
    <Panel
      title="无报复承诺"
      subtitle="已发布的公平声明；新版本发布即替代旧版"
      className="section-gap"
      action={
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          onClick={openCommitmentForm}
        >
          发布承诺
        </Button>
      }
      flush
    >
      {commitments.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice error={commitments.error} onRetry={commitments.reload} />
        </div>
      ) : commitments.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={2} />
        </div>
      ) : (commitments.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="shield"
          title="暂无公平承诺"
          description="发布声明：善意反馈不受报复。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>版本</th>
                <th>声明</th>
                <th>渠道</th>
                <th>状态</th>
                <th>已发布</th>
              </tr>
            </thead>
            <tbody>
              {commitments.data?.map((commitment) => (
                <tr key={commitment.id}>
                  <td className="mono">v{commitment.version}</td>
                  <td>
                    <span className="cell-primary">{commitment.statement}</span>
                    <span className="cell-sub mono">
                      {shortId(commitment.ownerPersonId, 10)}
                    </span>
                  </td>
                  <td>{commitment.channels.join(", ") || "—"}</td>
                  <td>
                    <Badge status={commitment.status} />
                  </td>
                  <td className="nowrap">
                    {formatDate(commitment.publishedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
    </>) : null}

    <Modal
      open={commitmentOpen}
      title="发布公平承诺"
      description="员工应能看到本声明及配套的申诉统计。"
      onClose={() => setCommitmentOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setCommitmentOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="commitment-form"
            loading={commitmentSaving}
          >
            发布
          </Button>
        </>
      }
    >
      <form id="commitment-form" className="stack" onSubmit={publishCommitment}>
        {commitmentError ? (
          <InfoNotice tone="warning">{commitmentError}</InfoNotice>
        ) : null}
        <FormField label="声明" htmlFor="commitment-statement">
          <Textarea
            id="commitment-statement"
            value={commitmentStatement}
            onChange={(event) => setCommitmentStatement(event.target.value)}
            required
          />
        </FormField>
        <FormField label="负责人" htmlFor="commitment-owner">
          <PersonSelect
            id="commitment-owner"
            value={commitmentOwner}
            onChange={setCommitmentOwner}
          />
        </FormField>
        <FormField
          label="发布渠道（逗号分隔）"
          htmlFor="commitment-channels"
        >
          <TextInput
            id="commitment-channels"
            value={commitmentChannels}
            onChange={(event) => setCommitmentChannels(event.target.value)}
          />
        </FormField>
      </form>
    </Modal>

    {canGovern ? (<>
    <Panel
      title="经理赋能"
      subtitle="支持一致复核的培训完成与校准会"
      className="section-gap"
      flush
    >
      <div className="split-grid" style={{ padding: 16 }}>
        <div className="detail-section" style={{ marginTop: 0 }}>
          <div className="detail-section__title">
            培训记录
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={openTrainingForm}
            >
              记录
            </Button>
          </div>
          {training.error ? (
            <ErrorNotice error={training.error} onRetry={training.reload} />
          ) : training.loading ? (
            <LoadingRows rows={2} />
          ) : (training.data?.length ?? 0) === 0 ? (
            <p className="muted">暂无经理培训记录。</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {training.data?.map((record) => (
                <div
                  key={record.id}
                  className="inline"
                  style={{ justifyContent: "space-between", width: "100%" }}
                >
                  <span>
                    {record.title}
                    <span className="cell-sub">
                      {displayName(record.personId, people)} ·{" "}
                      {record.trainingCode}
                    </span>
                  </span>
                  <span className="muted nowrap">
                    {formatDate(record.completedAt)}
                    {record.expiresAt
                      ? ` → ${formatDate(record.expiresAt)}`
                      : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="detail-section" style={{ marginTop: 0 }}>
          <div className="detail-section__title">
            校准会
            <Button
              size="sm"
              variant="secondary"
              icon="plus"
              onClick={openCalibrationForm}
            >
              记录
            </Button>
          </div>
          {calibrations.error ? (
            <ErrorNotice
              error={calibrations.error}
              onRetry={calibrations.reload}
            />
          ) : calibrations.loading ? (
            <LoadingRows rows={2} />
          ) : (calibrations.data?.length ?? 0) === 0 ? (
            <p className="muted">暂无校准会记录。</p>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {calibrations.data?.map((session) => (
                <div
                  key={session.id}
                  className="inline"
                  style={{ justifyContent: "space-between", width: "100%" }}
                >
                  <span>
                    {session.title}
                    <span className="cell-sub">
                      {session.attendeePersonIds.length} attendees ·{" "}
                      {session.code}
                    </span>
                  </span>
                  <span className="muted nowrap">
                    {formatDate(session.heldAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
    </>) : null}

    <Modal
      open={trainingOpen}
      title="记录经理培训"
      onClose={() => setTrainingOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setTrainingOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="training-form"
            loading={trainingSaving}
          >
            记录
          </Button>
        </>
      }
    >
      <form id="training-form" className="stack" onSubmit={saveTraining}>
        {trainingError ? (
          <InfoNotice tone="warning">{trainingError}</InfoNotice>
        ) : null}
        <FormField label="人员" htmlFor="training-person">
          <PersonSelect
            id="training-person"
            value={trainingPerson}
            onChange={setTrainingPerson}
          />
        </FormField>
        <div className="form-grid">
          <FormField label="培训编码" htmlFor="training-code">
            <TextInput
              id="training-code"
              value={trainingCode}
              onChange={(event) => setTrainingCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="标题" htmlFor="training-title">
            <TextInput
              id="training-title"
              value={trainingTitle}
              onChange={(event) => setTrainingTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="已完成" htmlFor="training-completed">
            <TextInput
              id="training-completed"
              type="date"
              value={trainingCompletedAt}
              onChange={(event) =>
                setTrainingCompletedAt(event.target.value)
              }
              required
            />
          </FormField>
          <FormField label="到期（可选）" htmlFor="training-expires">
            <TextInput
              id="training-expires"
              type="date"
              value={trainingExpiresAt}
              onChange={(event) => setTrainingExpiresAt(event.target.value)}
            />
          </FormField>
          <FormField
            label="证据引用"
            htmlFor="training-evidence"
          >
            <TextInput
              id="training-evidence"
              value={trainingEvidence}
              onChange={(event) => setTrainingEvidence(event.target.value)}
            />
          </FormField>
        </div>
      </form>
    </Modal>

    <Modal
      open={calibrationOpen}
      title="记录校准会"
      description="选择共同校准评分锚点的参加人。"
      onClose={() => setCalibrationOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setCalibrationOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="calibration-form"
            loading={calibrationSaving}
          >
            记录
          </Button>
        </>
      }
    >
      <form
        id="calibration-form"
        className="stack"
        onSubmit={saveCalibration}
      >
        {calibrationError ? (
          <InfoNotice tone="warning">{calibrationError}</InfoNotice>
        ) : null}
        <div className="form-grid">
          <FormField label="编码" htmlFor="calibration-code">
            <TextInput
              id="calibration-code"
              value={calibrationCode}
              onChange={(event) => setCalibrationCode(event.target.value)}
              required
            />
          </FormField>
          <FormField label="标题" htmlFor="calibration-title">
            <TextInput
              id="calibration-title"
              value={calibrationTitle}
              onChange={(event) => setCalibrationTitle(event.target.value)}
              required
            />
          </FormField>
          <FormField label="举办于" htmlFor="calibration-held">
            <TextInput
              id="calibration-held"
              type="date"
              value={calibrationHeldAt}
              onChange={(event) => setCalibrationHeldAt(event.target.value)}
              required
            />
          </FormField>
          <FormField label="主持人" htmlFor="calibration-facilitator">
            <PersonSelect
              id="calibration-facilitator"
              value={calibrationFacilitator}
              onChange={setCalibrationFacilitator}
            />
          </FormField>
        </div>
        <div className="detail-section">
          <div className="detail-section__title">参加人</div>
          <div className="stack">
            {people.map((person) => (
              <label className="checkbox" key={person.id}>
                <input
                  type="checkbox"
                  checked={calibrationAttendees.includes(person.id)}
                  onChange={(event) =>
                    setCalibrationAttendees((current) =>
                      event.target.checked
                        ? [...current, person.id]
                        : current.filter((id) => id !== person.id),
                    )
                  }
                />
                <span>{person.displayName}</span>
              </label>
            ))}
          </div>
        </div>
        <FormField label="Notes" htmlFor="calibration-notes">
          <Textarea
            id="calibration-notes"
            value={calibrationNotes}
            onChange={(event) => setCalibrationNotes(event.target.value)}
          />
        </FormField>
      </form>
    </Modal>

    <Panel
      title="试点登记"
      subtitle="有同意凭证与范围的自愿群体"
      className="section-gap"
      action={
        <Button
          size="sm"
          variant="secondary"
          icon="plus"
          onClick={openPilotForm}
        >
          加入试点
        </Button>
      }
      flush
    >
      {pilots.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice error={pilots.error} onRetry={pilots.reload} />
        </div>
      ) : pilots.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={2} />
        </div>
      ) : (pilots.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="people"
          title="暂无试点登记"
          description="以同意签名引用与明确的试点范围登记自愿者。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>人员</th>
                <th>试点</th>
                <th>范围</th>
                <th>同意</th>
                <th>状态</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {pilots.data?.map((enrollment) => (
                <tr key={enrollment.id}>
                  <td>{displayName(enrollment.personId, people)}</td>
                  <td className="mono">{enrollment.pilotCode}</td>
                  <td>{enrollment.scope}</td>
                  <td className="mono">
                    {shortId(enrollment.consentSignatureRef, 12)}
                  </td>
                  <td>
                    <Badge status={enrollment.status} />
                  </td>
                  <td className="cell-actions">
                    {enrollment.status === "ACTIVE" ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void withdrawPilot(enrollment)}
                        loading={pilotSaving}
                      >
                        撤回
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

    <Modal
      open={pilotOpen}
      title="加入试点"
      description="仅接受有同意引用记录的自愿参与。"
      onClose={() => setPilotOpen(false)}
      footer={
        <>
          <Button variant="ghost" onClick={() => setPilotOpen(false)}>
            取消
          </Button>
          <Button
            variant="primary"
            type="submit"
            form="pilot-form"
            loading={pilotSaving}
          >
            加入试点
          </Button>
        </>
      }
    >
      <form id="pilot-form" className="stack" onSubmit={savePilot}>
        {pilotError ? (
          <InfoNotice tone="warning">{pilotError}</InfoNotice>
        ) : null}
        <FormField label="人员" htmlFor="pilot-person">
          <PersonSelect
            id="pilot-person"
            value={pilotPerson}
            onChange={setPilotPerson}
          />
        </FormField>
        <FormField label="试点编码" htmlFor="pilot-code">
          <TextInput
            id="pilot-code"
            value={pilotCode}
            onChange={(event) => setPilotCode(event.target.value)}
            required
          />
        </FormField>
        <FormField label="范围" htmlFor="pilot-scope">
          <TextInput
            id="pilot-scope"
            value={pilotScope}
            onChange={(event) => setPilotScope(event.target.value)}
            required
          />
        </FormField>
        <FormField
          label="同意/电子签引用"
          htmlFor="pilot-consent"
        >
          <TextInput
            id="pilot-consent"
            value={pilotConsent}
            onChange={(event) => setPilotConsent(event.target.value)}
            required
          />
        </FormField>
      </form>
    </Modal>
    </>
  );
}
