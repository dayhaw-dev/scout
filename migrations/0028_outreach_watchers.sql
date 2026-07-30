CREATE TABLE outreach_watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL,
  close_outreach_log_id INTEGER,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  attached_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  next_check_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_checked_at TEXT,
  last_error TEXT,
  fired_at TEXT,
  fire_reason TEXT,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE RESTRICT,
  FOREIGN KEY (close_outreach_log_id) REFERENCES outreach_log(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_outreach_watchers_active_channel_trigger
  ON outreach_watchers(channel_id, trigger_type)
  WHERE active = 1;

CREATE INDEX idx_outreach_watchers_due
  ON outreach_watchers(active, next_check_at);

CREATE TABLE outreach_watcher_videos (
  watcher_id INTEGER NOT NULL,
  video_id TEXT NOT NULL,
  title TEXT,
  published_at TEXT,
  is_baseline INTEGER NOT NULL DEFAULT 0 CHECK (is_baseline IN (0, 1)),
  sponsorblock_has_sponsor INTEGER
    CHECK (sponsorblock_has_sponsor IS NULL OR sponsorblock_has_sponsor IN (0, 1)),
  sponsorblock_checked_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (watcher_id, video_id),
  FOREIGN KEY (watcher_id) REFERENCES outreach_watchers(id) ON DELETE RESTRICT
);

CREATE TABLE outreach_trigger_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watcher_id INTEGER NOT NULL,
  trigger_type TEXT NOT NULL,
  fired_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fire_reason TEXT NOT NULL,
  video_id TEXT,
  video_title TEXT,
  video_published_at TEXT,
  resolved_at TEXT,
  resolution TEXT,
  FOREIGN KEY (watcher_id) REFERENCES outreach_watchers(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX idx_outreach_trigger_events_one_open_per_watcher
  ON outreach_trigger_events(watcher_id)
  WHERE resolved_at IS NULL;

CREATE INDEX idx_outreach_trigger_events_open
  ON outreach_trigger_events(resolved_at, fired_at);
