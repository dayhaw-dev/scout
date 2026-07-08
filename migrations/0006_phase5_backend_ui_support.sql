PRAGMA foreign_keys = off;

CREATE TABLE failed_refs_new (
  ref_text TEXT NOT NULL,
  source_channel_id TEXT NOT NULL,
  error TEXT NOT NULL,
  failure_reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ref_text, source_channel_id)
);

INSERT INTO failed_refs_new (
  ref_text,
  source_channel_id,
  error,
  failure_reason,
  created_at
)
SELECT
  ref_text,
  source_channel_id,
  error,
  'legacy expansion failure',
  created_at
FROM failed_refs;

DROP TABLE failed_refs;
ALTER TABLE failed_refs_new RENAME TO failed_refs;

PRAGMA foreign_keys = on;
