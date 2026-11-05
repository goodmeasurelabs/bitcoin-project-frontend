import { argumentsOf, requireFlags, valueOf, apiClient, readJSON, privateJSON, digest, assertClosed, ACCOUNT, DATABASE, SITE, run } from './common.mjs';
import { fileURLToPath } from 'node:url';
export function validateSnapshot(snapshot, drain, now = Date.now()) {
  if (!snapshot.stable || !Array.isArray(snapshot.records) || snapshot.count !== snapshot.records.length) throw new Error('Snapshot is incomplete or unstable');
  if (snapshot.siteId !== SITE || snapshot.store !== 'daily-bitcoin-v1' || snapshot.count < 1) throw new Error('Unexpected source store');
  if (drain.account !== ACCOUNT || drain.database !== DATABASE || !drain.historicalWritersFenced || !drain.schedulersDisabled || !drain.relayPublished) throw new Error('Unverified drain');
  if (!Number.isFinite(Date.parse(drain.drainedAt)) || !Number.isFinite(Date.parse(snapshot.at)) || Date.parse(snapshot.at) < Date.parse(drain.drainedAt) || now - Date.parse(snapshot.at) > 300000 || Date.parse(snapshot.at) > now + 1000) throw new Error('Fresh post-drain snapshot required');
  const keys = new Set();
  for (const record of snapshot.records) {
    if (typeof record.key !== 'string' || keys.has(record.key) || typeof record.etag !== 'string' || record.metadata === null || typeof record.metadata !== 'object') throw new Error('Invalid snapshot record');
    keys.add(record.key);
    const bytes = Buffer.from(record.base64, 'base64');
    if (bytes.length !== record.bytes || digest(bytes) !== record.sha256 || !Buffer.from(bytes.toString('utf8')).equals(bytes)) throw new Error('Snapshot content validation failed');
  }
  return snapshot.records;
}
export function exactParity(records, rows) {
  if (rows.length !== records.length) return false;
  const actual = new Map(rows.map(row => [row.key, row]));
  return records.every(record => {
    const row = actual.get(record.key);
    return row && digest(row.value) === record.sha256 && row.etag === record.etag && row.metadata === JSON.stringify(record.metadata);
  });
}
export async function reconcile(query, snapshot, drain) {
  const records = validateSnapshot(snapshot, drain);
  await assertClosed(query);
  const namespace = `handoff-${Date.now()}`;
  for (const record of records) await query('INSERT INTO objects (namespace,key,value,metadata,etag) VALUES (?1,?2,?3,?4,?5)', [namespace, record.key, Buffer.from(record.base64, 'base64').toString('utf8'), JSON.stringify(record.metadata), record.etag]);
  const staged = await query('SELECT key,value,metadata,etag FROM objects WHERE namespace=?1', [namespace]);
  if (!exactParity(records, staged)) throw new Error('Staging parity failed');
  const extras = await query("SELECT key FROM objects WHERE namespace='production' AND key NOT IN (SELECT key FROM objects WHERE namespace=?1)", [namespace]);
  if (extras.length) throw new Error('Production contains records absent from the snapshot; explicit review required');
  await assertClosed(query);
  // One SQLite statement atomically upserts ALL snapshot values, including changed existing keys.
  await query("INSERT INTO objects (namespace,key,value,metadata,etag) SELECT 'production',key,value,metadata,etag FROM objects WHERE namespace=?1 ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,metadata=excluded.metadata,etag=excluded.etag", [namespace]);
  const live = await query("SELECT key,value,metadata,etag FROM objects WHERE namespace='production'");
  if (!exactParity(records, live)) throw new Error('Production parity failed; keep writes closed');
  return { account: ACCOUNT, database: DATABASE, at: new Date().toISOString(), snapshotAt: snapshot.at, objects: records.length, exactParity: true, namespace, productionWritesOpened: false };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run(async () => {
  const args = argumentsOf();
  requireFlags(args, ['--ack-historical-writers-fenced', '--ack-production-remains-closed']);
  const snapshot = await readJSON(valueOf(args, '--snapshot'));
  const drain = await readJSON(valueOf(args, '--drain-evidence'));
  const output = valueOf(args, '--evidence');
  const result = await reconcile(apiClient(), snapshot, drain);
  await privateJSON(output, result);
  console.log(`Exact parity verified for ${result.objects} objects. Production writes remain closed.`);
});
