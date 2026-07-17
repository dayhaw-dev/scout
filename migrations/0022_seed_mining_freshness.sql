CREATE TABLE IF NOT EXISTS seed_mining_freshness (
  channel_id TEXT PRIMARY KEY,
  latest_upload_at TEXT,
  newest_stored_video_at TEXT,
  stored_video_count INTEGER NOT NULL DEFAULT 0 CHECK (stored_video_count >= 0),
  unmined_count INTEGER CHECK (unmined_count IS NULL OR unmined_count >= 0),
  unmined_is_lower_bound INTEGER NOT NULL DEFAULT 0
    CHECK (unmined_is_lower_bound IN (0, 1)),
  never_mined INTEGER NOT NULL DEFAULT 0 CHECK (never_mined IN (0, 1)),
  rss_entry_count INTEGER NOT NULL DEFAULT 0 CHECK (rss_entry_count >= 0),
  status TEXT NOT NULL CHECK (status IN ('ok', 'empty', 'error')),
  error TEXT,
  checked_at TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_seed_mining_freshness_checked_at
  ON seed_mining_freshness(checked_at);
