import { randomUUID } from 'node:crypto';

// Preserve the subset of Netlify Blobs used by the existing functions.
// Every conditional write is one atomic SQLite statement.
export function createD1Store(db, namespace) {
  if (!db) throw new Error('Storage is not configured');
  const decode = (value, type) => type === 'json' ? JSON.parse(value) : value;
  const store = {
    async get(key, options = {}) {
      const row = await db.prepare('SELECT value FROM objects WHERE namespace = ?1 AND key = ?2').bind(namespace, key).first();
      return row ? decode(row.value, options.type) : null;
    },
    async getWithMetadata(key, options = {}) {
      const row = await db.prepare('SELECT value, metadata, etag FROM objects WHERE namespace = ?1 AND key = ?2').bind(namespace, key).first();
      return row ? { data: decode(row.value, options.type), metadata: JSON.parse(row.metadata), etag: row.etag } : null;
    },
    async set(key, value, options = {}) {
      const etag = randomUUID();
      const metadata = JSON.stringify(options.metadata ?? {});
      let statement;
      if (options.onlyIfMatch !== undefined) {
        statement = db.prepare('UPDATE objects SET value = ?1, metadata = ?2, etag = ?3 WHERE namespace = ?4 AND key = ?5 AND etag = ?6')
          .bind(String(value), metadata, etag, namespace, key, options.onlyIfMatch);
      } else if (options.onlyIfNew) {
        statement = db.prepare('INSERT INTO objects (namespace, key, value, metadata, etag) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(namespace, key) DO NOTHING')
          .bind(namespace, key, String(value), metadata, etag);
      } else {
        statement = db.prepare('INSERT INTO objects (namespace, key, value, metadata, etag) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(namespace, key) DO UPDATE SET value = excluded.value, metadata = excluded.metadata, etag = excluded.etag')
          .bind(namespace, key, String(value), metadata, etag);
      }
      const result = await statement.run();
      return { modified: result.meta.changes > 0, etag: result.meta.changes > 0 ? etag : undefined };
    },
    setJSON(key, value, options = {}) { return store.set(key, JSON.stringify(value), options); },
    async list({ prefix = '' } = {}) {
      const result = await db.prepare('SELECT key, etag FROM objects WHERE namespace = ?1 AND key >= ?2 AND key < ?3 ORDER BY key')
        .bind(namespace, prefix, prefix + '\uffff').all();
      return { blobs: result.results, directories: [] };
    },
  };
  return store;
}
