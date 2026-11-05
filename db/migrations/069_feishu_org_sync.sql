-- External identity on org nodes for idempotent directory sync (Feishu).
BEGIN;

ALTER TABLE org_nodes ADD COLUMN external_id text;

CREATE UNIQUE INDEX org_nodes_external_id_unique
  ON org_nodes(tenant_id, external_id)
  WHERE external_id IS NOT NULL;

COMMIT;
