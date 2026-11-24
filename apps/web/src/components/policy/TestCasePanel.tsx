import type { Dispatch, SetStateAction } from "react";
import { Badge, Button, EmptyState, ErrorNotice, LoadingRows, Panel } from "../ui.js";
import { formatDateTime, shortId, titleCase } from "../../lib/format.js";
import type { PolicyTestCase } from "../../lib/types.js";
import type { QueryState } from "../../lib/hooks.js";

export interface TestCasePanelProps {
  retireTestCase: (testCase: PolicyTestCase) => void;
  runSuite: () => void;
  runTestCase: (testCase: PolicyTestCase) => void;
  running: boolean;
  selectedId: string | null;
  setTestError: Dispatch<SetStateAction<string | null>>;
  setTestOpen: Dispatch<SetStateAction<boolean>>;
  testBusy: string | null;
  tests: QueryState<PolicyTestCase[]>;
}

export function TestCasePanel({
  retireTestCase,
  runSuite,
  runTestCase,
  running,
  selectedId,
  setTestError,
  setTestOpen,
  testBusy,
  tests,
}: TestCasePanelProps) {
  return (
    <Panel
      title="回归用例集"
      subtitle="所选版本的边界/异常/历史用例"
      action={
        <div className="row-actions">
          <Button
            size="sm"
            variant="secondary"
            icon="plus"
            onClick={() => {
              setTestError(null);
              setTestOpen(true);
            }}
            disabled={!selectedId}
          >
            新建用例
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon="play"
            onClick={runSuite}
            loading={running}
            disabled={!selectedId}
          >
            运行用例集
          </Button>
        </div>
      }
      flush
    >
      {tests.error ? (
        <div style={{ padding: 16 }}>
          <ErrorNotice error={tests.error} onRetry={tests.reload} />
        </div>
      ) : tests.loading ? (
        <div style={{ padding: 16 }}>
          <LoadingRows rows={4} />
        </div>
      ) : (tests.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon="policy"
          title="暂无用例"
          description="没有回归用例的政策无法自证行为；请为本版本补充测试用例。"
        />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>案件</th>
                <th>类别</th>
                <th>状态</th>
                <th>结果</th>
                <th>最近运行</th>
                <th>哈希</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {tests.data?.map((testCase) => (
                <tr key={testCase.id}>
                  <td>
                    <span className="cell-primary">{testCase.caseCode}</span>
                    <span className="cell-sub mono">
                      {shortId(testCase.id, 10)}
                    </span>
                  </td>
                  <td>{titleCase(testCase.category)}</td>
                  <td>
                    <Badge status={testCase.status} />
                  </td>
                  <td>
                    {testCase.lastRunPassed === undefined ? (
                      <Badge tone="neutral">未运行</Badge>
                    ) : testCase.lastRunPassed ? (
                      <Badge tone="success">通过</Badge>
                    ) : (
                      <Badge tone="danger">失败</Badge>
                    )}
                  </td>
                  <td className="nowrap">
                    {testCase.lastRunAt
                      ? formatDateTime(testCase.lastRunAt)
                      : "—"}
                  </td>
                  <td>
                    <span className="chip mono">
                      {testCase.lastRunResultHash
                        ? shortId(testCase.lastRunResultHash, 10)
                        : "—"}
                    </span>
                  </td>
                  <td className="cell-actions">
                    <div className="row-actions">
                      {testCase.status !== "RETIRED" ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={testBusy === testCase.id}
                            onClick={() => void runTestCase(testCase)}
                          >
                            运行
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            loading={testBusy === testCase.id}
                            onClick={() => void retireTestCase(testCase)}
                          >
                            停用
                          </Button>
                        </>
                      ) : null}
                    </div>
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
