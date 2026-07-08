ALTER TABLE channels ADD COLUMN search_query TEXT;

CREATE TABLE IF NOT EXISTS searches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  pages_used INTEGER NOT NULL,
  refs_found INTEGER NOT NULL,
  resolved INTEGER NOT NULL,
  credits_spent INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_channels_search_query ON channels(search_query);
CREATE INDEX IF NOT EXISTS idx_searches_created_at ON searches(created_at);
