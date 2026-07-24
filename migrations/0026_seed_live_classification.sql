ALTER TABLE seed_rss_entries
  ADD COLUMN is_live INTEGER
  CHECK (is_live IS NULL OR is_live IN (0, 1));

ALTER TABLE seed_rss_entries
  ADD COLUMN live_classification_attempted_at TEXT;

ALTER TABLE seed_rss_entries
  ADD COLUMN live_classified_at TEXT;

ALTER TABLE seed_rss_entries
  ADD COLUMN live_classification_error TEXT;

ALTER TABLE seed_mining_freshness
  ADD COLUMN live_count INTEGER NOT NULL DEFAULT 0
  CHECK (live_count >= 0);

ALTER TABLE seed_mining_freshness
  ADD COLUMN pending_live_classification_count INTEGER NOT NULL DEFAULT 0
  CHECK (pending_live_classification_count >= 0);

ALTER TABLE seed_mining_freshness
  ADD COLUMN live_classification_version INTEGER NOT NULL DEFAULT 0
  CHECK (live_classification_version >= 0);
