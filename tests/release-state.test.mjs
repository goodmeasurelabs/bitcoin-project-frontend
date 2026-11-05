import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const config = JSON.parse(readFileSync('wrangler.ci.jsonc', 'utf8'));
const script = resolve('cloudflare/release-state.mjs');
const sha = 'a'.repeat(40);
const fixture = () => ({
  settings: {
    bindings: [
      { name: 'ASSETS', type: 'assets' },
      { name: 'BITCOIN_DB', type: 'd1', id: config.d1_databases[0].database_id },
      { name: 'MIGRATION_RELAY_SECRET', type: 'secret_text' },
      { name: 'EXISTING_SECRET', type: 'secret_text' },
      ...Object.entries(config.vars).map(([name, text]) => ({ name, text, type: 'plain_text' })),
      { name: 'EXISTING_VARIABLE', type: 'plain_text', text: 'private-value-never-output' },
    ],
    compatibility_date: config.compatibility_date,
    compatibility_flags: config.compatibility_flags,
  },
  deployments: { deployments: [{ id: 'rollback-deployment', versions: [{ version_id: 'active-version', percentage: 100 }] }] },
  version: { annotations: { 'workers/message': `GitHub commit ${sha}` } },
  schedules: { schedules: config.triggers.crons.map(cron => ({ cron })) },
  subdomain: { enabled: true, previews_enabled: true },
});
function run(cwd, values, args = [], ref = 'refs/heads/main') {
  const program = `const values = ${JSON.stringify(values)}; globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname;
    if (options.method && options.method !== 'GET') throw new Error('Unexpected mutation');
    const base = '/client/v4/accounts/ee641897681cddb2b23b18fb4b639034/workers/scripts/gm-bitcoin-price/';
    if (!path.startsWith(base)) throw new Error('Unexpected broad/D1 metadata request: ' + path);
    const suffix = path.slice(base.length);
    if (!['settings','deployments','schedules','subdomain','versions/active-version'].includes(suffix)) throw new Error('Unexpected endpoint: ' + path);
    const result = suffix.startsWith('versions/') ? values.version : values[suffix];
    return new Response(JSON.stringify({success:true,result}), {status:200});
  }; process.argv.push(...${JSON.stringify(args)}); await import(${JSON.stringify('file://' + script)});`;
  return spawnSync(process.execPath, ['--input-type=module', '-e', program], { cwd, encoding: 'utf8', env: { ...process.env, GITHUB_REPOSITORY: 'goodmeasurelabs/bitcoin-project-frontend', GITHUB_REF: ref, GITHUB_SHA: sha, CLOUDFLARE_DEPLOY_TOKEN: 'fixture-token-never-output' } });
}
function temporary(check) {
  const cwd = mkdtempSync(join(tmpdir(), 'bitcoin-release-test-'));
  try { writeFileSync(join(cwd, 'wrangler.ci.jsonc'), JSON.stringify(config)); check(cwd); }
  finally { rmSync(cwd, { recursive: true, force: true }); }
}
test('inspection records only scoped Worker metadata and sanitized binding identity', () => temporary(cwd => {
  const result = run(cwd, fixture(), ['--inspect'], 'refs/heads/review');
  assert.equal(result.status, 0, result.stderr);
  const text = readFileSync(join(cwd, 'release-evidence/inspection.json'), 'utf8');
  const saved = JSON.parse(text);
  assert.equal(saved.mode, 'read-only-inspection');
  assert(saved.databaseIdentityMatchesReviewed);
  assert(saved.runtimePolicyMatchesReviewed);
  for (const value of ['private-value-never-output', 'fixture-token-never-output', config.d1_databases[0].database_id, 'valueSha256']) {
    assert(!text.includes(value)); assert(!result.stdout.includes(value)); assert(!result.stderr.includes(value));
  }
  assert.notEqual(run(cwd, fixture(), [], 'refs/heads/review').status, 0, 'a branch must not pass the publication guard');
}));
test('rejects route/migration configuration and unreviewed D1, schedules or policy before upload', () => temporary(cwd => {
  for (const key of ['routes', 'migrations']) {
    writeFileSync(join(cwd, 'wrangler.ci.jsonc'), JSON.stringify({ ...config, env: { production: { [key]: [] } } }));
    assert.notEqual(run(cwd, fixture()).status, 0);
  }
  writeFileSync(join(cwd, 'wrangler.ci.jsonc'), JSON.stringify(config));
  const wrongDb = fixture(); wrongDb.settings.bindings.find(binding => binding.type === 'd1').id = 'another-database';
  assert.notEqual(run(cwd, wrongDb).status, 0);
  const changedCron = fixture(); changedCron.schedules.schedules.pop();
  assert.notEqual(run(cwd, changedCron).status, 0);
  const changedPolicy = fixture(); changedPolicy.settings.bindings.find(binding => binding.name === 'NEWSLETTER_SEND_ENABLED').text = 'true';
  assert.notEqual(run(cwd, changedPolicy).status, 0);
}));
test('requires exact active-version source and retains failed after evidence for state drift', () => temporary(cwd => {
  assert.equal(run(cwd, fixture()).status, 0);
  assert.equal(run(cwd, fixture(), ['--after']).status, 0);
  const stale = fixture(); stale.version.annotations['workers/message'] = 'other source';
  stale.settings.annotations = { 'workers/message': `GitHub commit ${sha}` };
  assert.notEqual(run(cwd, stale, ['--after']).status, 0);
  const drift = fixture(); drift.settings.bindings.find(binding => binding.name === 'NEWSLETTER_SEND_ENABLED').text = 'true';
  assert.notEqual(run(cwd, drift, ['--after']).status, 0);
  const saved = JSON.parse(readFileSync(join(cwd, 'release-evidence/after.json'), 'utf8'));
  assert(!saved.sourceCommit, 'failed source/preservation checks must not claim verified source');
  assert.equal(saved.runtimePolicyMatchesReviewed, false);
}));
