ALTER TABLE outreach_watchers ADD COLUMN baseline_state TEXT NOT NULL DEFAULT 'pending'
  CHECK (baseline_state IN ('pending', 'ready', 'error'));

ALTER TABLE outreach_watchers ADD COLUMN baseline_cutoff_at TEXT NOT NULL DEFAULT ''
  CHECK (baseline_cutoff_at <> '');

ALTER TABLE outreach_watchers ADD COLUMN baseline_newest_video_id TEXT;
ALTER TABLE outreach_watchers ADD COLUMN baseline_newest_published_at TEXT;
ALTER TABLE outreach_watchers ADD COLUMN deactivated_at TEXT;

CREATE TRIGGER outreach_watchers_baseline_cutoff_immutable
BEFORE UPDATE OF baseline_cutoff_at ON outreach_watchers
WHEN NEW.baseline_cutoff_at <> OLD.baseline_cutoff_at
BEGIN
  SELECT RAISE(ABORT, 'baseline_cutoff_at is immutable');
END;

CREATE TRIGGER outreach_trigger_events_require_ready_watcher
BEFORE INSERT ON outreach_trigger_events
WHEN NOT EXISTS (
  SELECT 1
  FROM outreach_watchers
  WHERE id = NEW.watcher_id
    AND active = 1
    AND baseline_state = 'ready'
)
BEGIN
  SELECT RAISE(ABORT, 'watcher baseline is not ready');
END;
