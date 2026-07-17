ALTER TABLE channels ADD COLUMN email_confirmed INTEGER NOT NULL DEFAULT 0
  CHECK (email_confirmed IN (0, 1));

ALTER TABLE channels ADD COLUMN email_confirmed_at TEXT;
