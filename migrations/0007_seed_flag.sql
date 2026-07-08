ALTER TABLE channels ADD COLUMN is_seed INTEGER NOT NULL DEFAULT 0;

UPDATE channels
SET is_seed = 1,
    status = 'candidate',
    updated_at = CURRENT_TIMESTAMP
WHERE status = 'seed';

CREATE INDEX IF NOT EXISTS idx_channels_is_seed ON channels(is_seed);
