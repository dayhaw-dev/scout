ALTER TABLE channels ADD COLUMN outreach_stage TEXT NOT NULL DEFAULT 'none'
  CHECK (outreach_stage IN ('none', 'sent', 'replied', 'in_talks', 'pitched', 'signed', 'passed'));

ALTER TABLE channels ADD COLUMN is_active INTEGER NOT NULL DEFAULT 0
  CHECK (is_active IN (0, 1));

-- Preserve every live value exactly. The retired `ghosted` state maps to
-- `passed`, whose new definition explicitly includes creators who went dark.
-- Rows at `none` retain the additive column default and are not updated.
UPDATE channels
SET outreach_stage = CASE outreach_status
  WHEN 'ghosted' THEN 'passed'
  ELSE outreach_status
END
WHERE outreach_status <> 'none';

CREATE INDEX IF NOT EXISTS idx_channels_outreach_stage ON channels(outreach_stage);
CREATE INDEX IF NOT EXISTS idx_channels_is_active ON channels(is_active);
