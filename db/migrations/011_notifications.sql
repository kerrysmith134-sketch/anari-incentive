-- ---------------------------------------------------------------------------
-- In-app notifications
--
-- Agent actions (request evidence, notify owner/finance, escalation) persist a
-- notification instead of only returning a synthetic id.
-- ---------------------------------------------------------------------------

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id),
  recipient_person_id uuid,
  audience text NOT NULL DEFAULT 'PERSON'
    CHECK (audience IN ('PERSON','MANAGER','FINANCE','ADMIN')),
  title text NOT NULL,
  body text NOT NULL,
  source_type text,
  source_id uuid,
  status text NOT NULL DEFAULT 'UNREAD'
    CHECK (status IN ('UNREAD','READ')),
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, recipient_person_id) REFERENCES people(tenant_id, id)
);
CREATE INDEX idx_notifications_recipient
  ON notifications(tenant_id, recipient_person_id, status, created_at DESC);
CREATE INDEX idx_notifications_audience
  ON notifications(tenant_id, audience, status, created_at DESC);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notifications
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
