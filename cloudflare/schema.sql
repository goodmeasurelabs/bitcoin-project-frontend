CREATE TABLE IF NOT EXISTS objects (
  namespace TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  metadata TEXT NOT NULL DEFAULT '{}',
  etag TEXT NOT NULL,
  PRIMARY KEY (namespace, key)
);
CREATE TABLE IF NOT EXISTS migration_control (
  id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('closed', 'open')),
  updated_at TEXT NOT NULL
);
INSERT INTO migration_control (id, state, updated_at)
VALUES ('production-writes', 'closed', 'not-activated') ON CONFLICT(id) DO NOTHING;
