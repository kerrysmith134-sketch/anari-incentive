import { Link } from "react-router-dom";
import { PageHeader, Panel } from "../components/ui.js";
import { useDocumentTitle } from "../lib/hooks.js";

const SECTIONS = [
  {
    to: "/approvals",
    title: "Approvals",
    description: "T2/T3 human approval queue and one-time consumption.",
  },
  {
    to: "/cycles",
    title: "Cycles & calculations",
    description: "Readiness, formal/shadow runs, approve and lock.",
  },
  {
    to: "/policy",
    title: "Policy governance",
    description: "Rule changes, notices, consultations and representation.",
  },
  {
    to: "/contribution",
    title: "Contribution & deliverables",
    description: "Work packages, claims, evidence and acceptance.",
  },
  {
    to: "/settlements",
    title: "Settlements & budgets",
    description: "Batches, ledger, budget pools, cash gates and financial facts.",
  },
  {
    to: "/payroll",
    title: "Payroll & contracts",
    description: "Runs, exports, contracts, e-sign and tax studio.",
  },
  {
    to: "/rewards",
    title: "Equity & bounties",
    description: "Grants, vesting, exercises and reward-backed bounties.",
  },
  {
    to: "/settings",
    title: "Privacy & assurance",
    description: "DSAR, DPIA, retention, trust surveys, conflicts and break-glass.",
  },
  {
    to: "/integrations",
    title: "Integrations",
    description: "Connections, mappings, schedules, runs and identities.",
  },
  {
    to: "/ai",
    title: "AI assurance",
    description: "Evaluation gate, proposals, gold sets, canary and red team.",
  },
  {
    to: "/agent-ops",
    title: "Agent operations",
    description: "Agent tasks, approval gates, workflows and suggestion logs.",
  },
  {
    to: "/audit",
    title: "Audit",
    description: "Hash chain, anchor manifest and durability readiness.",
  },
  {
    to: "/field-access",
    title: "Field access",
    description: "Role and predicate-based field policies, audited on write.",
  },
  {
    to: "/registries",
    title: "Registries",
    description: "Metric definitions and compensation templates.",
  },
];

export function GovernanceHubPage() {
  useDocumentTitle("Governance");
  return (
    <>
      <PageHeader
        eyebrow="Governance"
        title="Governance console"
        description="Entry point for the governance and money-path modules. Every action is available in its dedicated, role-aware page; this hub replaces the legacy server-rendered governance page."
      />
      <Panel title="Modules" subtitle="Role-aware navigation is enforced by the API">
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
