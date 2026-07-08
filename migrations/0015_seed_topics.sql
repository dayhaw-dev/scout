CREATE TABLE IF NOT EXISTS seed_topics (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  rank INTEGER NOT NULL,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, term)
);

CREATE INDEX IF NOT EXISTS idx_seed_topics_rank
  ON seed_topics(rank);
