ALTER TABLE channels ADD COLUMN seed_lock_reason TEXT
  CHECK (
    seed_lock_reason IS NULL
    OR seed_lock_reason IN ('DEMO FENCE', 'DEMO RESERVE')
  )
  CHECK (seed_lock_reason IS NULL OR seed_locked = 1);

UPDATE channels
SET seed_locked = 1,
    seed_lock_reason = 'DEMO FENCE',
    updated_at = CURRENT_TIMESTAMP
WHERE is_seed = 1
  AND channel_id IN (
    'UCn5fhcGRrCvrmFibPbT6q1A',
    'UCyEA3vUnlpg0xzkECEq1rOA'
  );

UPDATE channels
SET seed_locked = 1,
    seed_lock_reason = 'DEMO RESERVE',
    updated_at = CURRENT_TIMESTAMP
WHERE is_seed = 1
  AND channel_id IN (
    'UCGEDbg1EKT7HCqbT7OAsLKA',
    'UCpnuadQ_w3r6f4Q_NRlqd-w'
  );
