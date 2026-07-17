PRAGMA defer_foreign_keys = on;

CREATE TABLE channels_new (
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
  status TEXT NOT NULL CHECK (status IN ('candidate', 'shortlisted', 'watchlist', 'snoozed', 'rejected')),
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  mention_count INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL CHECK (kind IN ('creator', 'brand', 'alt')),
  kind_reason TEXT,
  kind_locked INTEGER NOT NULL DEFAULT 0,
  score REAL,
  score_breakdown TEXT,
  search_query TEXT,
  is_seed INTEGER NOT NULL DEFAULT 0,
  last_upload_at TEXT,
  uploads_last_90d INTEGER,
  median_recent_views INTEGER,
  enriched_at TEXT,
  recent_velocity REAL,
  outreach_status TEXT NOT NULL DEFAULT 'none'
    CHECK (outreach_status IN ('none', 'sent', 'replied', 'in_talks', 'signed', 'passed', 'ghosted')),
  contacted_at TEXT,
  last_touch_at TEXT,
  next_followup_at TEXT,
  snoozed_until TEXT,
  snooze_reason TEXT,
  snoozed_at TEXT,
  snoozed_from_status TEXT
    CHECK (snoozed_from_status IS NULL OR snoozed_from_status IN ('candidate', 'watchlist')),
  woke_at TEXT
);

INSERT INTO channels_new (
  channel_id,
  handle,
  title,
  description,
  subscriber_count,
  video_count,
  view_count,
  country,
  published_at,
  thumbnail_url,
  discovered_via,
  source_channel_id,
  status,
  raw_json,
  created_at,
  updated_at,
  mention_count,
  kind,
  kind_reason,
  kind_locked,
  score,
  score_breakdown,
  search_query,
  is_seed,
  last_upload_at,
  uploads_last_90d,
  median_recent_views,
  enriched_at,
  recent_velocity,
  outreach_status,
  contacted_at,
  last_touch_at,
  next_followup_at,
  snoozed_until,
  snooze_reason,
  snoozed_at,
  snoozed_from_status,
  woke_at
)
SELECT
  channel_id,
  handle,
  title,
  description,
  subscriber_count,
  video_count,
  view_count,
  country,
  published_at,
  thumbnail_url,
  discovered_via,
  source_channel_id,
  status,
  raw_json,
  created_at,
  updated_at,
  mention_count,
  kind,
  kind_reason,
  kind_locked,
  score,
  score_breakdown,
  search_query,
  is_seed,
  last_upload_at,
  uploads_last_90d,
  median_recent_views,
  enriched_at,
  recent_velocity,
  outreach_status,
  contacted_at,
  last_touch_at,
  next_followup_at,
  NULL,
  NULL,
  NULL,
  NULL,
  NULL
FROM channels;

DROP TABLE channels;
ALTER TABLE channels_new RENAME TO channels;

CREATE INDEX IF NOT EXISTS idx_channels_status ON channels(status);
CREATE INDEX IF NOT EXISTS idx_channels_discovered_via ON channels(discovered_via);
CREATE INDEX IF NOT EXISTS idx_channels_kind ON channels(kind);
CREATE INDEX IF NOT EXISTS idx_channels_score ON channels(score);
CREATE INDEX IF NOT EXISTS idx_channels_search_query ON channels(search_query);
CREATE INDEX IF NOT EXISTS idx_channels_is_seed ON channels(is_seed);
CREATE INDEX IF NOT EXISTS idx_channels_enriched_at ON channels(enriched_at);
CREATE INDEX IF NOT EXISTS idx_channels_recent_velocity ON channels(recent_velocity);
CREATE INDEX IF NOT EXISTS idx_channels_outreach_status ON channels(outreach_status);
CREATE INDEX IF NOT EXISTS idx_channels_next_followup ON channels(next_followup_at);
CREATE INDEX IF NOT EXISTS idx_channels_snoozed_until ON channels(status, snoozed_until);

PRAGMA defer_foreign_keys = off;
