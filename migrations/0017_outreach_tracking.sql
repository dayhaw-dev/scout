ALTER TABLE channels ADD COLUMN outreach_status TEXT NOT NULL DEFAULT 'none'
  CHECK (outreach_status IN ('none', 'sent', 'replied', 'in_talks', 'signed', 'passed', 'ghosted'));
ALTER TABLE channels ADD COLUMN contacted_at TEXT;
ALTER TABLE channels ADD COLUMN last_touch_at TEXT;
ALTER TABLE channels ADD COLUMN next_followup_at TEXT;

CREATE TABLE IF NOT EXISTS outreach_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  note TEXT NOT NULL,
  FOREIGN KEY (channel_id) REFERENCES channels(channel_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_channels_outreach_status ON channels(outreach_status);
CREATE INDEX IF NOT EXISTS idx_channels_next_followup ON channels(next_followup_at);
CREATE INDEX IF NOT EXISTS idx_outreach_log_channel_created ON outreach_log(channel_id, created_at);
