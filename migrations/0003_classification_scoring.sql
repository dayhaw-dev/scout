ALTER TABLE channels ADD COLUMN kind TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE channels ADD COLUMN kind_reason TEXT;
ALTER TABLE channels ADD COLUMN kind_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE channels ADD COLUMN score REAL;
ALTER TABLE channels ADD COLUMN score_breakdown TEXT;

UPDATE channels
SET
  subscriber_count = CASE
    WHEN subscriber_count IS NULL THEN NULL
    ELSE ROUND(subscriber_count)
  END,
  video_count = CASE
    WHEN video_count IS NULL THEN NULL
    ELSE ROUND(video_count)
  END,
  view_count = CASE
    WHEN view_count IS NULL THEN NULL
    ELSE ROUND(view_count)
  END,
  mention_count = CASE
    WHEN mention_count IS NULL THEN 0
    ELSE ROUND(mention_count)
  END;

UPDATE videos
SET view_count = CASE
  WHEN view_count IS NULL THEN NULL
  ELSE ROUND(view_count)
END;

CREATE INDEX IF NOT EXISTS idx_channels_kind ON channels(kind);
CREATE INDEX IF NOT EXISTS idx_channels_score ON channels(score);
