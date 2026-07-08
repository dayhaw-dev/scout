CREATE TABLE IF NOT EXISTS auth_failures (
  ip TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  window_start TEXT NOT NULL
);
