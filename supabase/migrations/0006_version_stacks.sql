-- Version stacks: the Versions feature stores 2-4 model stacks per run in the versions array.
-- Each version carries a VersionStack (id, label, description, models: Stage -> model id, estimatedCostUsd)
-- and render results (shots, videoUrl, usd, ms, score).
--
-- No schema change needed: sheet_runs.data is already jsonb and can hold the updated shape.
-- This migration documents the structure and adds a comment for clarity.

comment on table gtm.sheet_runs is 'Sheet-based Studio runs. data.versions[] holds 2-4 version stacks (preview/final tiers) with model picks and render results.';

-- Add an index on the updated_at column for listing runs efficiently
create index if not exists sheet_runs_updated_at_idx on gtm.sheet_runs (updated_at desc);
