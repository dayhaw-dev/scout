ALTER TABLE channels ADD COLUMN mention_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS failed_refs (
  ref_text TEXT NOT NULL,
  source_channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  error TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ref_text, source_channel_id)
);

CREATE INDEX IF NOT EXISTS idx_failed_refs_source_channel_id
  ON failed_refs(source_channel_id);
