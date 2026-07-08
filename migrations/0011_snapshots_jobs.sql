CREATE TABLE IF NOT EXISTS snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  subscriber_count INTEGER,
  view_count INTEGER,
  video_count INTEGER,
  taken_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
);

CREATE INDEX IF NOT EXISTS idx_snapshots_channel_taken_at
  ON snapshots(channel_id, taken_at);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at TEXT,
  channels_snapshotted INTEGER NOT NULL DEFAULT 0,
  credits_spent INTEGER NOT NULL DEFAULT 0,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_kind_started_at
  ON jobs(kind, started_at);
