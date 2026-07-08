CREATE TABLE IF NOT EXISTS seed_queries (
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  phrase TEXT NOT NULL,
  rank INTEGER NOT NULL,
  computed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (channel_id, phrase)
);

CREATE INDEX IF NOT EXISTS idx_seed_queries_rank
  ON seed_queries(rank);

CREATE INDEX IF NOT EXISTS idx_channels_source_channel_id
  ON channels(source_channel_id);
