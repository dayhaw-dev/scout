PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS channels (
  channel_id TEXT PRIMARY KEY,
  handle TEXT,
  title TEXT,
  description TEXT,
  subscriber_count INTEGER,
  video_count INTEGER,
  view_count INTEGER,
  country TEXT,
  published_at TEXT,
  thumbnail_url TEXT,
  discovered_via TEXT NOT NULL CHECK (discovered_via IN ('seed', 'mention', 'collab', 'search', 'manual')),
  source_channel_id TEXT REFERENCES channels(channel_id) ON DELETE SET NULL,
  status TEXT NOT NULL CHECK (status IN ('seed', 'candidate', 'shortlisted', 'rejected')),
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL REFERENCES channels(channel_id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  view_count INTEGER,
  published_at TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS api_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT NOT NULL,
  credits_estimated INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);
CREATE INDEX IF NOT EXISTS idx_channels_discovered_via ON channels(discovered_via);
CREATE INDEX IF NOT EXISTS idx_videos_channel_id ON videos(channel_id);
