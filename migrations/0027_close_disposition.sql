ALTER TABLE channels ADD COLUMN close_disposition TEXT
  CHECK (
    close_disposition IS NULL
    OR close_disposition IN ('declined', 'no_reply')
  );

ALTER TABLE outreach_log ADD COLUMN event_type TEXT NOT NULL DEFAULT 'note';
ALTER TABLE outreach_log ADD COLUMN from_stage TEXT;
ALTER TABLE outreach_log ADD COLUMN to_stage TEXT;
ALTER TABLE outreach_log ADD COLUMN close_disposition TEXT
  CHECK (
    close_disposition IS NULL
    OR close_disposition IN ('declined', 'no_reply')
  );
