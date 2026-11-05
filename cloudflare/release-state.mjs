import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const account = 'ee641897681cddb2b23b18fb4b639034';
const worker = 'gm-bitcoin-price';
const databaseId = '74f8cb0b-6a5f-47fd-9152-ef725eb9f998';
const crons = ['0 13 * * *', '0 6 * * *'];
const policy = {
  NEWSLETTER_ENV: 'production', NEWSLETTER_SEND_ENABLED: 'false',
  MIGRATION_CRON_ENABLED: 'true', MIGRATION_RELAY_ENABLED: 'true',
  MIGRATION_PRODUCTION_WRITES_ENABLED: 'true', URL: 'https://whatsbitcoinsprice.com',
  MIGRATION_NETLIFY_HOST: 'whatsbitcoinsprice.netlify.app',
};
const token = process.env.CLOUDFLARE_DEPLOY_TOKEN;
const forbiddenConfig = value => value && typeof value === 'object' && Object.entries(value)
  .some(([key, child]) => ['route', 'routes', 'custom_domain', 'zone_id', 'zone_name', 'migrations', 'migrations_dir', 'migrations_table'].includes(key) || forbiddenConfig(child));

async function main() {
  const inspect = process.argv.includes('--inspect');
  assert.equal(process.env.GITHUB_REPOSITORY, 'goodmeasurelabs/bitcoin-project-frontend');
  if (!inspect) assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Production release checks require main');
  assert(!(inspect && process.argv.includes('--after')), 'Inspection cannot verify a publication');
  assert(/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || ''), 'Missing exact source commit');
  const config = JSON.parse(await readFile('wrangler.ci.jsonc', 'utf8'));
  assert.equal(config.name, worker);
  assert(!forbiddenConfig(config), 'CI must not manage routes, custom domains or database migrations');
  assert.equal(config.compatibility_date, '2026-10-04');
  assert.deepEqual(config.compatibility_flags, ['nodejs_compat']);
  assert.equal(config.assets?.binding, 'ASSETS');
  assert.deepEqual(config.d1_databases, [{ binding: 'BITCOIN_DB', database_name: 'gm-bitcoin-data', database_id: databaseId }]);
  assert.deepEqual([...(config.triggers?.crons || [])].sort(), crons, 'Reviewed schedules changed');
  assert.deepEqual(config.vars, policy, 'Reviewed environment policy changed');
  assert(token, 'Missing existing CLOUDFLARE_DEPLOY_TOKEN');
  async function api(path) {
    const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
      headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(30000),
    });
    const body = await response.json();
    assert(response.ok && body.success, `Worker metadata read ${path} failed: HTTP ${response.status}; codes ${(body.errors || []).map(error => error.code).join(',')}`);
    return body.result;
  }
  const base = `/accounts/${account}/workers/scripts/${worker}`;
  const [settings, deployments, schedules, subdomain] = await Promise.all([
    api(base + '/settings'), api(base + '/deployments'), api(base + '/schedules'), api(base + '/subdomain'),
  ]);
  const bindings = (settings.bindings || []).map(({ name, type }) => ({ name, type }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const databases = (settings.bindings || []).filter(binding => binding.type === 'd1');
  const databaseIdentityMatchesReviewed = databases.length === 1 && databases[0].name === 'BITCOIN_DB' && databases[0].id === databaseId;
  const runtimePolicyMatchesReviewed = Object.entries(policy).every(([name, expected]) => {
    const binding = (settings.bindings || []).find(binding => binding.name === name);
    return binding?.type === 'plain_text' && binding.text === expected;
  });
  const active = deployments.deployments?.[0];
  const snapshot = {
    checkedAt: new Date().toISOString(), accountId: account, workerName: worker,
    requestedSourceSha: process.env.GITHUB_SHA,
    mode: inspect ? 'read-only-inspection' : 'production-release',
    deployment: { id: active?.id, versions: active?.versions || [] }, bindings,
    databaseIdentityMatchesReviewed, runtimePolicyMatchesReviewed,
    schedules: (schedules.schedules || []).map(({ cron }) => cron).sort(),
    workersDev: { enabled: subdomain.enabled, previewsEnabled: subdomain.previews_enabled },
    compatibilityDate: settings.compatibility_date, compatibilityFlags: settings.compatibility_flags,
    routingVerification: 'Separate authenticated UI before/after capture; this scoped CI does not manage domains or zone routes.',
    dataVerification: 'Worker binding identity only: no D1 queries, migrations, imports, gate changes or application mutations.',
    environmentVerification: 'Exact reviewed policy checked in memory. Other plaintext values remain unrecorded and are preserved by --keep-vars; artifacts contain no values or hashes.',
  };
  await mkdir('release-evidence', { recursive: true });
  const after = process.argv.includes('--after');
  const file = `release-evidence/${inspect ? 'inspection' : after ? 'after' : 'before'}.json`;
  // Retain observed state before assertions, including failed post-upload comparisons.
  await writeFile(file, JSON.stringify(snapshot, null, 2) + '\n');
  assert(active?.id && active.versions?.length, 'Missing active deployment/rollback version');
  assert(bindings.every(binding => ['assets', 'plain_text', 'secret_text', 'd1'].includes(binding.type)), 'Unreviewed runtime binding type');
  assert(databaseIdentityMatchesReviewed, 'Existing D1 identity differs from the reviewed database');
  assert(bindings.some(binding => binding.name === 'ASSETS' && binding.type === 'assets'), 'Missing existing asset binding');
  assert(bindings.some(binding => binding.name === 'MIGRATION_RELAY_SECRET' && binding.type === 'secret_text'), 'Missing encrypted existing relay secret');
  for (const [name, expected] of Object.entries(policy)) {
    const binding = settings.bindings.find(binding => binding.name === name);
    assert(binding?.type === 'plain_text' && binding.text === expected, `Existing policy requires review: ${name}`);
  }
  assert.equal(snapshot.compatibilityDate, config.compatibility_date);
  assert.deepEqual([...(snapshot.compatibilityFlags || [])].sort(), [...config.compatibility_flags].sort());
  assert.deepEqual(snapshot.schedules, crons, 'Existing schedules require review');
  assert.equal(snapshot.workersDev.enabled, config.workers_dev, 'Existing workers.dev state requires review');
  if (after) {
    const before = JSON.parse(await readFile('release-evidence/before.json', 'utf8'));
    assert.deepEqual(snapshot.bindings, before.bindings, 'Runtime binding names/types or secret names changed');
    assert.deepEqual(snapshot.schedules, before.schedules, 'Schedules changed');
    assert.deepEqual(snapshot.workersDev, before.workersDev, 'Preview/worker URL state changed');
    assert.equal(active.versions.length, 1, 'Unexpected traffic split');
    assert.equal(active.versions[0].percentage, 100, 'New version must serve all traffic');
    const version = await api(base + '/versions/' + encodeURIComponent(active.versions[0].version_id));
    assert.equal(version.annotations?.['workers/message'], `GitHub commit ${process.env.GITHUB_SHA}`, 'Published version does not identify this exact source');
    snapshot.sourceCommit = process.env.GITHUB_SHA;
    await writeFile(file, JSON.stringify(snapshot, null, 2) + '\n');
  }
  console.log(JSON.stringify(snapshot, null, 2));
}
main().catch(error => {
  console.error(token ? String(error.message).replaceAll(token, '[REDACTED]') : String(error.message));
  process.exitCode = 1;
});
