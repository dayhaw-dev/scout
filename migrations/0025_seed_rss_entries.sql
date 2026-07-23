CREATE TABLE IF NOT EXISTS seed_rss_entries (
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  published_at TEXT,
  feed_position INTEGER NOT NULL
    CHECK (feed_position BETWEEN 0 AND 14),
  is_short INTEGER
    CHECK (is_short IS NULL OR is_short IN (0, 1)),
  classification_attempted_at TEXT,
  classified_at TEXT,
  classification_error TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (channel_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_seed_rss_entries_current_feed
  ON seed_rss_entries(channel_id, last_seen_at, feed_position);

CREATE INDEX IF NOT EXISTS idx_seed_rss_entries_pending
  ON seed_rss_entries(channel_id, is_short, last_seen_at);

ALTER TABLE seed_mining_freshness
  ADD COLUMN shorts_count INTEGER NOT NULL DEFAULT 0
  CHECK (shorts_count >= 0);

ALTER TABLE seed_mining_freshness
  ADD COLUMN pending_classification_count INTEGER NOT NULL DEFAULT 0
  CHECK (pending_classification_count >= 0);
