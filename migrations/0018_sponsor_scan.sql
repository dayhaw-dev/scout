CREATE TABLE IF NOT EXISTS video_scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  video_title TEXT,
  published_at TEXT,
  scanned_at TEXT NOT NULL,
  sponsorblock_has_sponsor INTEGER,
  sponsorblock_segments_json TEXT,
  error TEXT,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id)
);

CREATE INDEX IF NOT EXISTS idx_video_scans_channel_scanned_at
  ON video_scans(channel_id, scanned_at);

CREATE INDEX IF NOT EXISTS idx_video_scans_video_id
  ON video_scans(video_id);
