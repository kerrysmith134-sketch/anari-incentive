-- AI-02: persist gold-set samples for datasetRef-only re-evaluation.
BEGIN;
ALTER TABLE model_evaluation_datasets
  ADD COLUMN samples jsonb NOT NULL DEFAULT '[]'::jsonb;
COMMIT;
