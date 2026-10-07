import { argumentsOf, requireFlags, valueOf, apiClient, readJSON, assertClosed, ACCOUNT, DATABASE, run } from './common.mjs';
run(async () => {
  const args = argumentsOf();
  requireFlags(args, ['--ack-single-d1-authority', '--ack-historical-writers-fenced', '--ack-relay-and-production-tested']);
  const proof = await readJSON(valueOf(args, '--reconciliation-evidence'));
  if (proof.account !== ACCOUNT || proof.database !== DATABASE || proof.exactParity !== true || !/^handoff-\d+$/.test(proof.namespace) || !Number.isInteger(proof.objects) || proof.objects < 1 || !Number.isFinite(Date.parse(proof.at)) || Date.parse(proof.at) > Date.now() + 1000 || Date.now() - Date.parse(proof.at) > 300000) throw new Error('Fresh exact reconciliation evidence required');
  const query = apiClient();
  await assertClosed(query);
  const counts = await query("SELECT count(*) AS total FROM objects WHERE namespace='production'");
  if (counts[0]?.total !== proof.objects) throw new Error('Production count changed; keep writes closed');
  const mismatches = await query("SELECT key,value,metadata,etag FROM objects WHERE namespace='production' EXCEPT SELECT key,value,metadata,etag FROM objects WHERE namespace=?1", [proof.namespace]);
  const missing = await query("SELECT key,value,metadata,etag FROM objects WHERE namespace=?1 EXCEPT SELECT key,value,metadata,etag FROM objects WHERE namespace='production'", [proof.namespace]);
  if (mismatches.length || missing.length) throw new Error('Production diverged; keep writes closed');
  await query("UPDATE migration_control SET state='open',updated_at=?1 WHERE id='production-writes' AND state='closed'", [new Date().toISOString()]);
  console.log('D1 write gate opened. Release-level writes permission must also be true. Email and cron settings were not changed.');
});
