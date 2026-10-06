import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createWorker } from '../cloudflare/router.mjs';
import { createD1Store } from '../cloudflare/d1-store.mjs';
import { handleRelay } from '../cloudflare/relay.mjs';
import { createRelay } from '../migration/netlify-relay/relay.mjs';
import { productionWritesEnabled, WORKER_HOST, RELAY_PREFIX } from '../cloudflare/migration-policy.mjs';
import { reconcile, validateSnapshot } from '../migration/operations/reconcile.mjs';
import { ACCOUNT, DATABASE, SITE, digest } from '../migration/operations/common.mjs';

process.env.NEWSLETTER_ENV = 'migration-local-test';
process.env.NEWSLETTER_PROVIDER = 'resend';
const SECRET = 'synthetic-local-relay-secret-not-a-credential';
const HOST = 'synthetic-bitcoin.netlify.app';
const LIVE = 'https://whatsbitcoinsprice.com';
const STAGE = `https://${WORKER_HOST}`;
const request = (origin, name, body, headers = {}) => new Request(`${origin}/.netlify/functions/${name}`, {
  method: body === undefined ? 'GET' : 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...headers },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
async function database(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: '2026-10-04', d1Databases: ['BITCOIN_DB'] }));
  t.after(() => mf.dispose());
  const db = await mf.getD1Database('BITCOIN_DB');
  await db.exec((await readFile(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8')).replaceAll('\n', ' '));
  return db;
}
const relayEnv = db => ({ BITCOIN_DB: db, MIGRATION_RELAY_ENABLED: 'true', MIGRATION_PRODUCTION_WRITES_ENABLED: 'true', MIGRATION_RELAY_SECRET: SECRET, MIGRATION_NETLIFY_HOST: HOST });
const open = db => db.prepare("UPDATE migration_control SET state='open' WHERE id='production-writes'").run();

test('production mutation gate fails closed without changing preview access; www POST is not redirected', async t => {
  const db = await database(t), live = createD1Store(db, 'production'), preview = createD1Store(db, 'preview');
  await live.setJSON('editions/2026-10-05', { date: '2026-10-05', headline: 'live' });
  await preview.setJSON('editions/2026-10-05', { date: '2026-10-05', headline: 'preview' });
  const worker = createWorker({ fetch: () => new Response('page') });
  const env = relayEnv(db);
  for (const origin of [LIVE, 'https://www.whatsbitcoinsprice.com']) {
    const result = await worker.fetch(request(origin, 'daily-vote', { edition: '2026-10-05', choice: 'hold' }), env, {});
    assert.equal(result.status, 503); assert.equal(result.headers.get('Retry-After'), '60'); assert.equal(result.headers.get('location'), null);
  }
  const spoofed = await worker.fetch(request(STAGE, 'daily-vote', { edition: '2026-10-05', choice: 'hold' }, { 'x-gm-production': 'true', 'x-gm-original-url': LIVE, 'x-gm-relay-authorization': `Bearer ${SECRET}` }), env, {});
  assert.equal(spoofed.status, 200); assert.match(spoofed.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await live.list({ prefix: 'votes/' })).blobs.length, 0);
  assert.equal((await preview.list({ prefix: 'votes/' })).blobs.length, 1);
  const feed = await worker.fetch(request(LIVE, 'daily-feed'), env, {});
  assert.equal((await feed.json()).editions[0].headline, 'live');
  await open(db);
  assert.equal(await productionWritesEnabled({ BITCOIN_DB: db }), false);
  const accepted = await worker.fetch(request('https://www.whatsbitcoinsprice.com', 'daily-vote', { edition: '2026-10-05', choice: 'trade' }), env, {});
  assert.equal(accepted.status, 200); assert.ok(accepted.headers.get('set-cookie'));
  assert.equal((await live.list({ prefix: 'votes/' })).blobs.length, 1);
  const page = await worker.fetch(new Request('https://www.whatsbitcoinsprice.com/daily', { method: 'POST', body: 'keep-me' }), env, {});
  assert.equal(page.status, 308); assert.equal(page.headers.get('location'), `${LIVE}/daily`);
  await db.exec('DROP TABLE migration_control');
  assert.equal(await productionWritesEnabled(env), false);
});

test('authenticated relay selects production only after strict endpoint, URL, method and auth checks', async t => {
  const db = await database(t), env = relayEnv(db), worker = createWorker({ fetch: () => new Response('page') });
  const make = (name = 'newsletter', extra = {}, body = '{}', method = 'POST') => new Request(STAGE + RELAY_PREFIX + name, {
    method, headers: { 'x-gm-relay-authorization': `Bearer ${SECRET}`, 'x-gm-original-url': `https://${HOST}/.netlify/functions/${name}`, origin: `https://${HOST}`, ...extra }, ...(method === 'GET' ? {} : { body }),
  });
  assert.equal((await worker.fetch(make(), { ...env, MIGRATION_RELAY_ENABLED: 'false' }, {})).status, 404);
  assert.equal((await worker.fetch(make('newsletter', { 'x-gm-relay-authorization': 'Bearer invalid' }), env, {})).status, 401);
  assert.equal((await worker.fetch(make('toString'), env, {})).status, 404);
  assert.equal((await worker.fetch(make('game', {}, undefined, 'GET'), env, {})).status, 405);
  assert.equal((await worker.fetch(make('newsletter', { 'x-gm-original-url': 'https://attacker.netlify.app/.netlify/functions/newsletter' }), env, {})).status, 400);
  assert.equal((await worker.fetch(make('newsletter', { 'x-gm-original-url': `https://${HOST}/.netlify/functions/game` }), env, {})).status, 400);
  assert.equal((await worker.fetch(make('newsletter', {}, 'x'.repeat(65537)), env, {})).status, 413);
  assert.equal((await worker.fetch(make(), env, {})).status, 503);
  await open(db);
  assert.equal((await worker.fetch(make('newsletter', { origin: 'https://evil.example' }), env, {})).status, 403);
  assert.equal((await worker.fetch(make('daily-publish'), env, {})).status, 401, 'relay auth must not replace scheduled-job auth');
  assert.equal((await worker.fetch(make('daily-publish', { authorization: 'Bearer local-job' }), { ...env, NEWSLETTER_JOB_SECRET: 'local-job', MIGRATION_PRODUCTION_WRITES_ENABLED: 'false' }, {})).status, 503);
});

test('Netlify relay reaches one D1 authority with trusted original client IP, cookies and origin', async t => {
  const db = await database(t), env = relayEnv(db), worker = createWorker({ fetch: () => new Response('page') });
  await open(db);
  const live = createD1Store(db, 'production'), preview = createD1Store(db, 'preview');
  const forwarding = { env: { MIGRATION_NETLIFY_RELAY_ENABLED: 'true', MIGRATION_RELAY_SECRET: SECRET }, send: (url, init) => worker.fetch(new Request(url, init), env, {}) };
  const newsletter = createRelay('newsletter', forwarding);
  const address = '192.0.2.35';
  const signup = await newsletter(request(`https://${HOST}`, 'newsletter', { email: 'relay@example.invalid', btc: 1, frequency: 'daily', consent: true }, { 'x-gm-client-ip': 'forged', 'cf-connecting-ip': 'forged' }), { ip: address });
  assert.equal(signup.status, 200); assert.equal((await signup.json()).outcome, 'early_access');
  assert.equal((await live.list({ prefix: 'subscribers/' })).blobs.length, 1);
  assert.equal((await preview.list()).blobs.length, 0);
  assert.equal((await live.list({ prefix: `limits/${digest(address)}/` })).blobs.length, 1);
  await live.setJSON('editions/2026-10-05', { date: '2026-10-05' });
  const cookie = 'a'.repeat(64), vote = createRelay('daily-vote', forwarding);
  const result = await vote(request(LIVE, 'daily-vote', { edition: '2026-10-05', choice: 'hold' }, { cookie: `daily_voter=${cookie}` }), { ip: address });
  assert.equal(result.status, 200); assert.match(result.headers.get('set-cookie'), new RegExp(cookie));
  assert.deepEqual(await live.get(`votes/2026-10-05/${digest(cookie)}`, { type: 'json' }), { choice: 'hold' });
});

test('relay preserves raw webhook/query/auth/response cookies and never retries an uncertain write', async () => {
  const original = `https://${HOST}/.netlify/functions/email-events?event=one%2Btwo`;
  const raw = '{ "type": "test", "spacing":  true }';
  let calls = 0;
  const relay = createRelay('email-events', { env: { MIGRATION_NETLIFY_RELAY_ENABLED: 'true', MIGRATION_RELAY_SECRET: SECRET }, send: async (url, init) => {
    calls++;
    return handleRelay(new Request(url, init), relayEnv({}), {}, async (req, _env, _ctx, context) => {
      assert.equal(req.url, original); assert.equal(req.method, 'POST'); assert.equal(await req.text(), raw);
      assert.equal(req.headers.get('svix-signature'), 'synthetic-signature'); assert.equal(req.headers.get('authorization'), 'Bearer original-job');
      assert.equal(req.headers.get('cookie'), 'one=1'); assert.equal(req.headers.get('x-gm-relay-authorization'), null); assert.equal(context.ip, '2001:db8::4');
      const headers = new Headers(); headers.append('set-cookie', 'a=1; Path=/'); headers.append('set-cookie', 'b=2; Path=/'); headers.set('Content-Encoding', 'gzip'); headers.set('Content-Length', '999');
      return new Response('original response', { status: 202, headers });
    });
  } });
  const response = await relay(new Request(original, { method: 'POST', headers: { 'svix-signature': 'synthetic-signature', authorization: 'Bearer original-job', cookie: 'one=1' }, body: raw }), { ip: '2001:db8::4' });
  assert.equal(calls, 1); assert.equal(response.status, 202); assert.equal(await response.text(), 'original response');
  assert.deepEqual(response.headers.getSetCookie(), ['a=1; Path=/', 'b=2; Path=/']);
  assert.equal(response.headers.get('Content-Encoding'), null); assert.equal(response.headers.get('Content-Length'), null);
  let attempts = 0;
  const failing = createRelay('game', { env: { MIGRATION_NETLIFY_RELAY_ENABLED: 'true', MIGRATION_RELAY_SECRET: SECRET }, send: () => { attempts++; throw new Error('ambiguous network failure'); } });
  assert.equal((await failing(request(LIVE, 'game', { action: 'lock' }), { ip: '192.0.2.1' })).status, 502);
  assert.equal(attempts, 1);
  const disabled = createRelay('game', { env: {}, send: () => { throw new Error('must not send'); } });
  assert.equal((await disabled(request(LIVE, 'game', {}), {})).status, 503);
});

test('final reconciliation replaces stale values exactly, isolates preview, and refuses unexplained records', async t => {
  const db = await database(t), live = createD1Store(db, 'production'), preview = createD1Store(db, 'preview');
  await live.set('game-runs/synthetic', 'old'); await preview.set('game-runs/synthetic', 'preview');
  const now = Date.now();
  const drain = { account: ACCOUNT, database: DATABASE, drainedAt: new Date(now - 1000).toISOString(), historicalWritersFenced: true, schedulersDisabled: true, relayPublished: true };
  const records = [['game-runs/synthetic', 'new'], ['tokens/synthetic', 'synthetic-id']].map(([key, value]) => ({ key, base64: Buffer.from(value).toString('base64'), bytes: Buffer.byteLength(value), sha256: digest(value), metadata: { synthetic: true }, etag: 'final-etag' }));
  const snapshot = { stable: true, siteId: SITE, store: 'daily-bitcoin-v1', at: new Date(now).toISOString(), count: records.length, records };
  const query = async (sql, params = []) => (await db.prepare(sql).bind(...params).all()).results;
  assert.throws(() => validateSnapshot({ ...snapshot, stable: false }, drain));
  assert.throws(() => validateSnapshot({ ...snapshot, siteId: 'another-site' }, drain));
  assert.throws(() => validateSnapshot(snapshot, { ...drain, drainedAt: 'invalid' }));
  assert.throws(() => validateSnapshot({ ...snapshot, at: new Date(now - 301000).toISOString() }, drain));
  const proof = await reconcile(query, snapshot, drain);
  assert.equal(proof.exactParity, true); assert.equal(proof.productionWritesOpened, false);
  assert.equal(await live.get('game-runs/synthetic'), 'new'); assert.equal(await preview.get('game-runs/synthetic'), 'preview');
  assert.equal((await live.getWithMetadata('tokens/synthetic')).etag, 'final-etag');
  await live.set('extra/external', 'preserve');
  await assert.rejects(() => reconcile(query, snapshot, drain), /absent from the snapshot/);
  assert.equal(await live.get('extra/external'), 'preserve');
  await open(db); await assert.rejects(() => reconcile(query, snapshot, drain), /explicitly closed/);
});

test('operational scripts refuse execution without explicit flags before any network access', () => {
  for (const script of ['drain.mjs', 'reconcile.mjs', 'open-writes.mjs', 'deploy.mjs']) {
    const result = spawnSync(process.execPath, [new URL(`../migration/operations/${script}`, import.meta.url).pathname], { encoding: 'utf8', env: { PATH: process.env.PATH } });
    assert.equal(result.status, 1, `${script} must refuse`);
    assert.match(result.stderr, /refused or failed/); assert.equal(result.stdout, '');
  }
});
