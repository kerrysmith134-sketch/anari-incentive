import { Link } from "react-router-dom";
import { PageHeader, Panel } from "../components/ui.js";
import { useDocumentTitle } from "../lib/hooks.js";

const SECTIONS = [
  {
    to: "/approvals",
    title: "审批",
    description: "T2/T3 人工审批队列与一次性消费。",
  },
  {
    to: "/cycles",
    title: "周期与计算",
    description: "就绪度、正式/影子计算、批准与锁定。",
  },
  {
    to: "/policy",
    title: "政策治理",
    description: "规则变更、告知、咨询与员工代表。",
  },
  {
    to: "/contribution",
    title: "贡献与交付物",
    description: "工作包、申报、证据与验收。",
  },
  {
    to: "/settlements",
    title: "结算与预算",
    description: "结算批次、账本、预算池、现金门禁与财务事实。",
  },
  {
    to: "/payroll",
    title: "薪酬与合同",
    description: "批次、导出、合同、电子签与个税工作台。",
  },
  {
    to: "/rewards",
    title: "股权与悬赏",
    description: "授予、归属、行权与悬赏。",
  },
  {
    to: "/settings",
    title: "隐私与保障",
    description: "DSAR、DPIA、保留、信任调查、冲突申报与紧急授权。",
  },
  {
    to: "/integrations",
    title: "集成",
    description: "连接、映射、计划、同步运行与身份映射。",
  },
  {
    to: "/ai",
    title: "AI 保障",
    description: "评测门禁、提案、金标集、金丝雀与红队。",
  },
  {
    to: "/agent-ops",
    title: "Agent 运维",
    description: "Agent 任务、审批门禁、工作流与建议日志。",
  },
  {
    to: "/audit",
    title: "审计",
    description: "哈希链、锚点清单与耐久性就绪。",
  },
  {
    to: "/field-access",
    title: "字段权限",
    description: "基于角色与谓词的字段策略，写入即审计。",
  },
  {
    to: "/registries",
    title: "登记簿",
    description: "指标定义与薪酬模板。",
  },
];

export function GovernanceHubPage() {
  useDocumentTitle("治理中心");
  return (
    <>
      <PageHeader
        eyebrow="治理"
        title="治理中心"
        description="治理与资金路径模块的入口；所有操作都在各自按角色隔离的专属页面，本页替代旧服务端渲染治理页。"
      />
      <Panel title="模块" subtitle="按角色的导航由 API 强制">
        <div className="split-grid">
          {SECTIONS.map((section) => (
            <Link
              key={section.to}
              to={section.to}
              className="detail-section"
              style={{ display: "block", textDecoration: "none" }}
            >
              <div className="detail-section__title">{section.title}</div>
              <p className="muted">{section.description}</p>
            </Link>
          ))}
        </div>
      </Panel>
    </>
  );
}
