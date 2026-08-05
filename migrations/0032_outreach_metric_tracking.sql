ALTER TABLE snapshots ADD COLUMN median_recent_views INTEGER;
ALTER TABLE snapshots ADD COLUMN job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL;

ALTER TABLE jobs ADD COLUMN scheduled_for TEXT;
ALTER TABLE jobs ADD COLUMN targets_considered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN channels_succeeded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN channels_failed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN channels_partial INTEGER NOT NULL DEFAULT 0;
ALTER TABLE jobs ADD COLUMN status TEXT NOT NULL DEFAULT 'completed'
  CHECK (status IN ('running', 'completed', 'completed_with_errors', 'failed'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_kind_scheduled_for
  ON jobs(kind, scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_snapshots_job_channel
  ON snapshots(job_id, channel_id)
  WHERE job_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS job_channel_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'partial', 'failed')),
  get_channel_status TEXT NOT NULL CHECK (get_channel_status IN ('success', 'failed')),
  get_channel_credits INTEGER NOT NULL DEFAULT 0,
  get_channel_error TEXT,
  get_videos_status TEXT NOT NULL CHECK (get_videos_status IN ('success', 'failed')),
  get_videos_credits INTEGER NOT NULL DEFAULT 0,
  get_videos_error TEXT,
  persistence_error TEXT,
  credits_spent INTEGER NOT NULL DEFAULT 0,
  snapshot_id INTEGER REFERENCES snapshots(id) ON DELETE SET NULL,
  score_recomputed INTEGER NOT NULL DEFAULT 0 CHECK (score_recomputed IN (0, 1)),
  score_note TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT NOT NULL,
  UNIQUE(job_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_job_channel_results_job
  ON job_channel_results(job_id, id);
