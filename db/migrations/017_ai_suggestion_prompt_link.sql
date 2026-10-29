-- ---------------------------------------------------------------------------
-- AI suggestion prompt linkage
--
-- Suggestions may reference the exact ACTIVE prompt version used to produce
-- them, making prompt/model provenance queryable instead of free text.
-- ---------------------------------------------------------------------------

ALTER TABLE ai_suggestion_logs
  ADD COLUMN model_prompt_id uuid;

ALTER TABLE ai_suggestion_logs
  ADD CONSTRAINT ai_suggestion_logs_prompt_fk
  FOREIGN KEY (tenant_id, model_prompt_id)
  REFERENCES model_prompts(tenant_id, id);
