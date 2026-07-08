ALTER TABLE seed_queries ADD COLUMN source TEXT NOT NULL DEFAULT 'ngram';
ALTER TABLE seed_queries ADD COLUMN generated_at TEXT;
ALTER TABLE seed_queries ADD COLUMN latest_video_at TEXT;
ALTER TABLE seed_queries ADD COLUMN video_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_seed_queries_source
  ON seed_queries(source);
