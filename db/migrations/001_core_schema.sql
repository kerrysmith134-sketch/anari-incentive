-- N-Perform core schema
-- PostgreSQL 16+
-- This migration is the first vertical-slice baseline. It implements the
-- canonical state names from packages/domain/src/states.ts and the core
-- objects required by PRD V4.1. Governance and money-path hardening live in
-- 002_governance_schema.sql, 003_money_path_invariants.sql,
-- 004_policy_succession.sql, 005_ledger_sequence.sql,
-- 006_settlement_rls.sql, 007_agent_task_state.sql,
-- 008_evaluation_rls.sql, 009_data_quality_rls.sql,
-- 010_evidence_submitter_rls.sql, 011_notifications.sql and
-- 012_recovery_settlement.sql.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE work_package_status AS ENUM (
  'DRAFT','COMMITTED','IN_PROGRESS','BLOCKED','SUBMITTED','ACCEPTED','REJECTED','CANCELLED','REOPENED'
);
CREATE TYPE contribution_claim_status AS ENUM (
  'DRAFT','SUBMITTED','NEEDS_EVIDENCE','UNDER_REVIEW','ACCEPTED','PARTIALLY_ACCEPTED','REJECTED','APPEALED','WITHDRAWN'
);
CREATE TYPE attribution_decision_status AS ENUM (
  'DRAFT','UNDER_REVIEW','CONFIRMED','PARTIALLY_CONFIRMED','REJECTED','APPEALED','SUPERSEDED'
);
CREATE TYPE calculation_run_status AS ENUM (
  'CREATED','RUNNING','CALCULATED','BLOCKED','NEEDS_REVIEW','RECONCILIATION_REQUIRED','APPROVED','LOCKED','REVERSED'
);
CREATE TYPE settlement_batch_status AS ENUM (
  'DRAFT','RECONCILING','PENDING_APPROVAL','APPROVED','LOCKED','EXPORTED','ACKNOWLEDGED','CANCELLED','ADJUSTMENT_REQUIRED'
);
CREATE TYPE appeal_case_status AS ENUM (
  'OPEN','TRIAGED','UNDER_REVIEW','DECIDED','RECALCULATION_REQUIRED','CLOSED'
);
CREATE TYPE data_quality_issue_status AS ENUM (
  'OPEN','ASSIGNED','IN_PROGRESS','RESOLVED','WAIVED_WITH_APPROVAL','REOPENED'
);
CREATE TYPE ledger_entry_type AS ENUM ('INCENTIVE','ADJUSTMENT','REVERSAL','RECOVERY');
CREATE TYPE ledger_status AS ENUM ('PROVISIONAL','APPROVED','LOCKED','REVERSED');
CREATE TYPE quality_status AS ENUM ('VALID','MISSING','STALE','CONFLICTED','UNVERIFIED','INVALID');
CREATE TYPE policy_status AS ENUM ('DRAFT','VALIDATED','PENDING_APPROVAL','APPROVED','PUBLISHED','RETIRED');
CREATE TYPE approval_status AS ENUM ('PENDING','APPROVED','REJECTED','EXPIRED','CANCELLED');

-- ---------------------------------------------------------------------------
-- Identity, tenancy, organisation
-- ---------------------------------------------------------------------------

CREATE TABLE tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE',
  default_timezone text NOT NULL DEFAULT 'UTC',
  default_currency char(3) NOT NULL DEFAULT 'CNY',
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email citext,
  display_name text NOT NULL,
  auth_subject text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'ACTIVE',
  last_login_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'INVITED',
  role_codes text[] NOT NULL DEFAULT '{}',
  joined_at timestamptz,
  left_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, id)
);

CREATE TABLE people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  user_id uuid REFERENCES users(id),
  employee_code text NOT NULL,
  display_name text NOT NULL,
  employment_status text NOT NULL DEFAULT 'ACTIVE',
  manager_person_id uuid,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, employee_code),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from),
  FOREIGN KEY (tenant_id, manager_person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE org_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  parent_id uuid,
  node_type text NOT NULL,
  name text NOT NULL,
  path text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, parent_id) REFERENCES org_nodes(tenant_id, id)
);

CREATE TABLE person_org_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  org_node_id uuid NOT NULL,
  valid_from date NOT NULL,
  valid_to date,
  allocation numeric(8,5),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (allocation IS NULL OR (allocation >= 0 AND allocation <= 1)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, org_node_id) REFERENCES org_nodes(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Integrations and ingestion
-- ---------------------------------------------------------------------------

CREATE TABLE integration_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  provider text NOT NULL,
  connection_name text NOT NULL,
  credential_ref text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE',
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);

CREATE TABLE sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  connection_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED',
  started_at timestamptz,
  finished_at timestamptz,
  cursor_before jsonb,
  cursor_after jsonb,
  records_seen integer NOT NULL DEFAULT 0,
  records_upserted integer NOT NULL DEFAULT 0,
  error_summary text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, connection_id) REFERENCES integration_connections(tenant_id, id)
);

CREATE TABLE external_identity_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  external_id text NOT NULL,
  person_id uuid,
  object_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, external_id, object_type),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE webhook_inbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  message_id text NOT NULL,
  payload_hash text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'RECEIVED',
  error_code text,
  UNIQUE (tenant_id, source_system, message_id)
);

-- ---------------------------------------------------------------------------
-- Evidence graph
-- ---------------------------------------------------------------------------

CREATE TABLE raw_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_system text NOT NULL,
  source_record_id text NOT NULL,
  source_event_version text NOT NULL DEFAULT '1',
  event_type text NOT NULL,
  occurred_at timestamptz,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, source_system, source_record_id, source_event_version),
  UNIQUE (tenant_id, id)
);

CREATE TABLE evidence_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  raw_event_id uuid,
  evidence_type text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  source_system text NOT NULL,
  source_uri text,
  observed_at timestamptz NOT NULL,
  quality_status quality_status NOT NULL DEFAULT 'UNVERIFIED',
  confidence numeric(5,4),
  normalized_payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, raw_event_id) REFERENCES raw_events(tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES evidence_nodes(tenant_id, id)
);
CREATE INDEX idx_evidence_subject ON evidence_nodes(tenant_id, subject_type, subject_id, observed_at DESC);

CREATE TABLE evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  from_evidence_id uuid NOT NULL,
  to_evidence_id uuid NOT NULL,
  relation_type text NOT NULL CHECK (relation_type IN ('SUPPORTS','CONTRADICTS','DEPENDS_ON','CORRECTS','CONTEXT')),
  rationale text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, from_evidence_id, to_evidence_id, relation_type),
  FOREIGN KEY (tenant_id, from_evidence_id) REFERENCES evidence_nodes(tenant_id, id),
  FOREIGN KEY (tenant_id, to_evidence_id) REFERENCES evidence_nodes(tenant_id, id),
  CHECK (from_evidence_id <> to_evidence_id)
);

-- ---------------------------------------------------------------------------
-- Work packages, deliverables, acceptances
-- ---------------------------------------------------------------------------

CREATE TABLE work_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  source_object_type text NOT NULL,
  source_object_id text NOT NULL,
  title text NOT NULL,
  objective text NOT NULL,
  package_type text NOT NULL DEFAULT 'ORDER_DELIVERY',
  owner_person_id uuid NOT NULL,
  status work_package_status NOT NULL DEFAULT 'DRAFT',
  acceptance_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  due_at timestamptz,
  current_snapshot_id uuid,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, owner_person_id) REFERENCES people(tenant_id, id)
);
CREATE INDEX idx_work_packages_status_due ON work_packages(tenant_id, status, due_at);
CREATE INDEX idx_work_packages_source ON work_packages(tenant_id, source_object_type, source_object_id);

CREATE TABLE work_package_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_package_id uuid NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  content_hash text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by uuid,
  UNIQUE (tenant_id, work_package_id, version),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, work_package_id) REFERENCES work_packages(tenant_id, id),
  FOREIGN KEY (tenant_id, captured_by) REFERENCES people(tenant_id, id)
);
ALTER TABLE work_packages
  ADD CONSTRAINT fk_work_package_current_snapshot
  FOREIGN KEY (tenant_id, current_snapshot_id) REFERENCES work_package_versions(tenant_id, id);

CREATE TABLE work_package_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_package_id uuid NOT NULL,
  person_id uuid NOT NULL,
  responsibility_code text NOT NULL,
  expected_output text NOT NULL,
  allocation_hint numeric(8,5),
  active_from timestamptz NOT NULL DEFAULT now(),
  active_to timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, work_package_id) REFERENCES work_packages(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  CHECK (allocation_hint IS NULL OR (allocation_hint >= 0 AND allocation_hint <= 1)),
  CHECK (active_to IS NULL OR active_to >= active_from)
);

CREATE TABLE deliverables (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  work_package_id uuid NOT NULL,
  title text NOT NULL,
  deliverable_type text NOT NULL,
  owner_person_id uuid NOT NULL,
  due_at timestamptz,
  status text NOT NULL DEFAULT 'DRAFT',
  artifact_ref text,
  content_hash text,
  submitted_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, work_package_id) REFERENCES work_packages(tenant_id, id),
  FOREIGN KEY (tenant_id, owner_person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  deliverable_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('ACCEPT','REJECT','ACCEPT_WITH_ISSUES')),
  reviewer_person_id uuid NOT NULL,
  criteria_results jsonb NOT NULL DEFAULT '{}'::jsonb,
  comments text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, deliverable_id) REFERENCES deliverables(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES acceptances(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Contribution claims and attribution
-- ---------------------------------------------------------------------------

CREATE TABLE contribution_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid,
  work_package_id uuid NOT NULL,
  claimant_person_id uuid NOT NULL,
  claim_type text NOT NULL,
  claimed_contribution jsonb NOT NULL,
  rationale text NOT NULL,
  status contribution_claim_status NOT NULL DEFAULT 'DRAFT',
  submitted_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, work_package_id) REFERENCES work_packages(tenant_id, id),
  FOREIGN KEY (tenant_id, claimant_person_id) REFERENCES people(tenant_id, id)
);
CREATE INDEX idx_claims_status_submitted ON contribution_claims(tenant_id, status, submitted_at DESC);

CREATE TABLE claim_evidence_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  claim_id uuid NOT NULL,
  evidence_ref text NOT NULL,
  link_role text NOT NULL CHECK (link_role IN ('SUPPORTING','COUNTER_EVIDENCE','CONTEXT')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, claim_id, evidence_ref, link_role),
  FOREIGN KEY (tenant_id, claim_id) REFERENCES contribution_claims(tenant_id, id)
);

CREATE TABLE attribution_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  claim_id uuid NOT NULL,
  decision_version integer NOT NULL,
  status attribution_decision_status NOT NULL DEFAULT 'DRAFT',
  adjudicator_person_id uuid NOT NULL,
  accepted_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  rejected_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  contribution_dimensions jsonb NOT NULL DEFAULT '{}'::jsonb,
  rationale text NOT NULL,
  confidence_band text,
  effective_at timestamptz NOT NULL DEFAULT now(),
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, claim_id, decision_version),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, claim_id) REFERENCES contribution_claims(tenant_id, id),
  FOREIGN KEY (tenant_id, adjudicator_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES attribution_decisions(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Evaluation
-- ---------------------------------------------------------------------------

CREATE TABLE evaluation_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  cycle_type text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL DEFAULT 'DRAFT',
  policy_version_id uuid,
  rubric_version_id uuid,
  opened_at timestamptz,
  locked_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  CHECK (ends_at > starts_at)
);

CREATE TABLE metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  version integer NOT NULL,
  name text NOT NULL,
  description text,
  data_type text NOT NULL,
  unit text,
  aggregation_method text,
  source_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE rubrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  code text NOT NULL,
  name text NOT NULL,
  dimensions jsonb NOT NULL,
  scoring_anchors jsonb NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  version integer NOT NULL,
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, code, version),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE TABLE policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  policy_code text NOT NULL,
  version integer NOT NULL,
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  status policy_status NOT NULL DEFAULT 'DRAFT',
  effective_from timestamptz NOT NULL,
  effective_to timestamptz,
  rule_ast jsonb NOT NULL,
  rule_schema_version text NOT NULL,
  approved_by uuid,
  approved_at timestamptz,
  published_at timestamptz,
  publicized_at timestamptz,
  content_hash text NOT NULL,
  approval_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, policy_code, version),
  UNIQUE (tenant_id, id),
  CHECK (effective_to IS NULL OR effective_to > effective_from),
  CHECK (status NOT IN ('APPROVED','PUBLISHED') OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE evaluation_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  person_id uuid NOT NULL,
  generated_by_type text NOT NULL CHECK (generated_by_type IN ('AGENT','USER','SYSTEM')),
  generated_by_id uuid,
  model_provider text,
  model_name text,
  prompt_version text,
  agent_task_id uuid,
  evidence_snapshot_hash text NOT NULL,
  draft_payload jsonb NOT NULL,
  strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  counter_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  missing_information jsonb NOT NULL DEFAULT '[]'::jsonb,
  uncertainty jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'DRAFT',
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE evaluation_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  person_id uuid NOT NULL,
  decision_version integer NOT NULL,
  status text NOT NULL CHECK (status IN ('APPROVED','SUPERSEDED','WITHDRAWN')),
  rubric_version_id uuid NOT NULL,
  evidence_snapshot_hash text NOT NULL,
  scores jsonb NOT NULL,
  rationale text NOT NULL,
  reviewer_person_id uuid NOT NULL,
  approved_at timestamptz,
  supersedes_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, cycle_id, person_id, decision_version),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, rubric_version_id) REFERENCES rubrics(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES evaluation_decisions(tenant_id, id)
);

ALTER TABLE evaluation_cycles
  ADD CONSTRAINT fk_cycle_policy FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, id);
ALTER TABLE evaluation_cycles
  ADD CONSTRAINT fk_cycle_rubric FOREIGN KEY (tenant_id, rubric_version_id) REFERENCES rubrics(tenant_id, id);

-- ---------------------------------------------------------------------------
-- Calculation and ledger
-- ---------------------------------------------------------------------------

CREATE TABLE calculation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  policy_version_id uuid NOT NULL,
  mode text NOT NULL DEFAULT 'SHADOW' CHECK (mode IN ('SHADOW','FORMAL')),
  engine_version text NOT NULL,
  input_snapshot_hash text NOT NULL,
  input_snapshot jsonb NOT NULL,
  status calculation_run_status NOT NULL DEFAULT 'CREATED',
  result_hash text,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  requested_by uuid NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  locked_at timestamptz,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id),
  FOREIGN KEY (tenant_id, policy_version_id) REFERENCES policy_versions(tenant_id, id),
  FOREIGN KEY (tenant_id, requested_by) REFERENCES people(tenant_id, id),
  CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at),
  CHECK (status <> 'LOCKED' OR locked_at IS NOT NULL)
);
CREATE INDEX idx_calc_cycle_created ON calculation_runs(tenant_id, cycle_id, created_at DESC);

CREATE TABLE calculation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  calculation_run_id uuid NOT NULL,
  line_key text NOT NULL,
  person_id uuid NOT NULL,
  work_package_id uuid NOT NULL,
  incentive_type text NOT NULL,
  base_amount numeric(20,6) NOT NULL,
  multiplier numeric(20,8) NOT NULL DEFAULT 1,
  raw_amount numeric(20,6) NOT NULL,
  rounded_amount numeric(20,6) NOT NULL,
  currency char(3) NOT NULL,
  trace jsonb NOT NULL,
  result_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, calculation_run_id, person_id, incentive_type, line_key),
  FOREIGN KEY (tenant_id, calculation_run_id) REFERENCES calculation_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, work_package_id) REFERENCES work_packages(tenant_id, id)
);

CREATE TABLE amount_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  person_id uuid NOT NULL,
  cycle_id uuid NOT NULL,
  calculation_run_id uuid NOT NULL,
  calculation_line_id uuid,
  entry_type ledger_entry_type NOT NULL,
  amount numeric(20,6) NOT NULL,
  currency char(3) NOT NULL,
  status ledger_status NOT NULL DEFAULT 'PROVISIONAL',
  source_entry_id uuid,
  idempotency_key text NOT NULL,
  entry_hash text NOT NULL,
  prev_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id),
  FOREIGN KEY (tenant_id, calculation_run_id) REFERENCES calculation_runs(tenant_id, id),
  FOREIGN KEY (tenant_id, calculation_line_id) REFERENCES calculation_lines(tenant_id, id),
  FOREIGN KEY (tenant_id, source_entry_id) REFERENCES amount_ledger(tenant_id, id),
  CHECK (entry_type = 'INCENTIVE' OR source_entry_id IS NOT NULL),
  CHECK (status <> 'LOCKED' OR locked_at IS NOT NULL)
);
CREATE INDEX idx_ledger_person_created ON amount_ledger(tenant_id, person_id, created_at DESC);
CREATE INDEX idx_ledger_cycle_status ON amount_ledger(tenant_id, cycle_id, status);

CREATE UNIQUE INDEX uq_ledger_calculation_line
  ON amount_ledger(tenant_id, calculation_line_id, entry_type)
  WHERE calculation_line_id IS NOT NULL;

CREATE TABLE adjustment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  original_ledger_id uuid NOT NULL,
  adjustment_ledger_id uuid NOT NULL,
  reason_code text NOT NULL,
  explanation text NOT NULL,
  approved_by uuid NOT NULL,
  approved_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, adjustment_ledger_id),
  FOREIGN KEY (tenant_id, original_ledger_id) REFERENCES amount_ledger(tenant_id, id),
  FOREIGN KEY (tenant_id, adjustment_ledger_id) REFERENCES amount_ledger(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Settlement and appeals
-- ---------------------------------------------------------------------------

CREATE TABLE settlement_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  cycle_id uuid NOT NULL,
  batch_no text NOT NULL,
  status settlement_batch_status NOT NULL DEFAULT 'DRAFT',
  currency char(3),
  total_amount numeric(20,6) NOT NULL DEFAULT 0,
  line_count integer NOT NULL DEFAULT 0,
  approved_by uuid,
  approved_at timestamptz,
  locked_at timestamptz,
  exported_at timestamptz,
  acknowledged_at timestamptz,
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, batch_no),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, cycle_id) REFERENCES evaluation_cycles(tenant_id, id),
  FOREIGN KEY (tenant_id, approved_by) REFERENCES people(tenant_id, id),
  CHECK (total_amount >= 0),
  CHECK (line_count >= 0),
  CHECK (status NOT IN ('APPROVED','LOCKED','EXPORTED','ACKNOWLEDGED') OR approved_by IS NOT NULL)
);

CREATE TABLE settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  batch_id uuid NOT NULL,
  ledger_id uuid NOT NULL,
  person_id uuid NOT NULL,
  amount numeric(20,6) NOT NULL,
  currency char(3) NOT NULL,
  status text NOT NULL DEFAULT 'PENDING',
  active boolean NOT NULL DEFAULT true,
  external_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, batch_id, ledger_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, batch_id) REFERENCES settlement_batches(tenant_id, id),
  FOREIGN KEY (tenant_id, ledger_id) REFERENCES amount_ledger(tenant_id, id),
  FOREIGN KEY (tenant_id, person_id) REFERENCES people(tenant_id, id)
);
CREATE UNIQUE INDEX uq_settlement_active_ledger
  ON settlement_lines(tenant_id, ledger_id)
  WHERE active;

CREATE TABLE appeal_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  appellant_person_id uuid NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('ATTRIBUTION','EVALUATION','LEDGER','CALCULATION')),
  target_id uuid NOT NULL,
  appeal_reason_code text NOT NULL,
  statement text NOT NULL,
  evidence_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  status appeal_case_status NOT NULL DEFAULT 'OPEN',
  reviewer_person_id uuid,
  resolution text,
  resolved_at timestamptz,
  supersedes_decision_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, appellant_person_id) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, reviewer_person_id) REFERENCES people(tenant_id, id)
);

-- ---------------------------------------------------------------------------
-- Data quality, agents, approvals, audit, events
-- ---------------------------------------------------------------------------

CREATE TABLE data_quality_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  issue_code text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('INFO','WARNING','BLOCKING')),
  status data_quality_issue_status NOT NULL DEFAULT 'OPEN',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_to uuid,
  waiver_reason text,
  waived_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, assigned_to) REFERENCES people(tenant_id, id),
  FOREIGN KEY (tenant_id, waived_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE agent_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_type text NOT NULL,
  trigger_type text NOT NULL,
  trigger_ref text,
  status text NOT NULL DEFAULT 'QUEUED',
  risk_tier text NOT NULL CHECK (risk_tier IN ('T0','T1','T2','T3')),
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('USER','AGENT','SYSTEM')),
  requested_by_id uuid,
  input_ref jsonb NOT NULL,
  output_ref jsonb,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  idempotency_key text NOT NULL,
  correlation_id uuid NOT NULL,
  last_error_code text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id)
);
CREATE INDEX idx_agent_tasks_ready ON agent_tasks(tenant_id, status, next_attempt_at);

CREATE TABLE workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_task_id uuid NOT NULL,
  workflow_name text NOT NULL,
  workflow_version text NOT NULL,
  status text NOT NULL,
  current_step text,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_task_id) REFERENCES agent_tasks(tenant_id, id)
);

CREATE TABLE ai_suggestion_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  agent_task_id uuid NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  suggestion_type text NOT NULL,
  model_provider text,
  model_name text,
  prompt_version text NOT NULL,
  input_hash text NOT NULL,
  output_json jsonb NOT NULL,
  validation_status text NOT NULL,
  accepted_by uuid,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, agent_task_id) REFERENCES agent_tasks(tenant_id, id),
  FOREIGN KEY (tenant_id, accepted_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  action_type text NOT NULL,
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  target_version bigint NOT NULL DEFAULT 1,
  requested_by_type text NOT NULL CHECK (requested_by_type IN ('USER','AGENT','SYSTEM')),
  requested_by_id uuid,
  risk_tier text NOT NULL CHECK (risk_tier IN ('T0','T1','T2','T3')),
  status approval_status NOT NULL DEFAULT 'PENDING',
  required_approvals integer NOT NULL DEFAULT 1 CHECK (required_approvals >= 1),
  approved_count integer NOT NULL DEFAULT 0 CHECK (approved_count >= 0),
  expires_at timestamptz,
  payload_hash text NOT NULL,
  idempotency_key text NOT NULL,
  consumed_at timestamptz,
  consumed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, idempotency_key),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, consumed_by) REFERENCES people(tenant_id, id)
);

CREATE TABLE approval_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  request_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('APPROVE','REJECT')),
  approver_person_id uuid NOT NULL,
  payload_hash text NOT NULL,
  reason text,
  decided_at timestamptz NOT NULL DEFAULT now(),
  auth_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, request_id, approver_person_id),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES approval_requests(tenant_id, id),
  FOREIGN KEY (tenant_id, approver_person_id) REFERENCES people(tenant_id, id)
);

CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  sequence bigint NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('USER','AGENT','SYSTEM','INTEGRATION')),
  actor_id uuid,
  action text NOT NULL,
  object_type text NOT NULL,
  object_id uuid,
  before_hash text,
  after_hash text,
  reason text,
  correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  source_ip inet,
  prev_hash text NOT NULL,
  event_hash text NOT NULL,
  UNIQUE (tenant_id, sequence),
  UNIQUE (tenant_id, id)
);
CREATE INDEX idx_audit_object_time ON audit_events(tenant_id, object_type, object_id, occurred_at DESC);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  aggregate_type text NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type text NOT NULL,
  schema_version text NOT NULL,
  payload jsonb NOT NULL,
  correlation_id uuid NOT NULL,
  causation_id uuid,
  actor_type text NOT NULL CHECK (actor_type IN ('USER','AGENT','SYSTEM','INTEGRATION')),
  actor_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempt_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id)
);
CREATE INDEX idx_outbox_unpublished ON outbox_events(next_attempt_at, occurred_at) WHERE published_at IS NULL;

CREATE TABLE inbox_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  consumer_name text NOT NULL,
  message_id text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  status text NOT NULL DEFAULT 'RECEIVED' CHECK (status IN ('RECEIVED','PROCESSED','FAILED','IGNORED')),
  error_code text,
  UNIQUE (tenant_id, consumer_name, message_id)
);

COMMIT;
