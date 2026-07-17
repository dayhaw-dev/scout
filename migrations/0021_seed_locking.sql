ALTER TABLE channels ADD COLUMN seed_locked INTEGER NOT NULL DEFAULT 0
  CHECK (seed_locked IN (0, 1));

UPDATE channels
SET seed_locked = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE is_seed = 1
  AND channel_id IN (
    'UCn5fhcGRrCvrmFibPbT6q1A',
    'UCyEA3vUnlpg0xzkECEq1rOA'
  );
