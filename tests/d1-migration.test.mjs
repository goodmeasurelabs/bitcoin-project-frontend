import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { createD1Store } from '../cloudflare/d1-store.mjs';
import { handleFunction } from '../cloudflare/functions.mjs';

test('D1 preserves blob values, isolates preview data and rejects racing/stale writes', async () => {
  const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: 'export default { fetch() { return new Response("ok"); } }', compatibilityDate: '2026-10-04', d1Databases: ['BITCOIN_DB'] }));
  try {
    const db = await mf.getD1Database('BITCOIN_DB');
    await db.exec((await readFile(new URL('../cloudflare/schema.sql', import.meta.url), 'utf8')).replaceAll('\n', ' '));
    const live = createD1Store(db, 'production');
    const preview = createD1Store(db, 'preview');
    assert.equal(await live.get('missing'), null);
    await live.set('tokens/example', 'synthetic-subscriber');
    await live.setJSON('subscribers/example', { email: 'migration-test@example.invalid', status: 'pending' }, { metadata: { test: true } });
    assert.equal(await live.get('tokens/example'), 'synthetic-subscriber');
    assert.equal((await live.get('subscribers/example', { type: 'json' })).status, 'pending');
    assert.deepEqual((await live.getWithMetadata('subscribers/example')).metadata, { test: true });
    assert.equal(await preview.get('tokens/example'), null);
    assert.deepEqual((await preview.list()).blobs, []);
    await live.set('editions/2026-10-04', 'one');
    await live.set('editions/2026-10-05', 'two');
    assert.deepEqual((await live.list({ prefix: 'editions/' })).blobs.map(x => x.key), ['editions/2026-10-04', 'editions/2026-10-05']);
    await live.set('prefix_%/literal', 'ok');
    assert.equal((await live.list({ prefix: 'prefix_%/' })).blobs.length, 1);
    const creates = await Promise.all([live.setJSON('game-runs/race', { score: 1 }, { onlyIfNew: true }), live.setJSON('game-runs/race', { score: 2 }, { onlyIfNew: true })]);
    assert.equal(creates.filter(x => x.modified).length, 1);
    const saved = await live.getWithMetadata('game-runs/race', { type: 'json' });
    const updates = await Promise.all([live.setJSON('game-runs/race', { score: 3 }, { onlyIfMatch: saved.etag }), live.setJSON('game-runs/race', { score: 4 }, { onlyIfMatch: saved.etag })]);
    assert.equal(updates.filter(x => x.modified).length, 1);
    assert.equal((await live.setJSON('game-runs/race', { score: 0 }, { onlyIfMatch: saved.etag })).modified, false);
    assert.notEqual((await live.getWithMetadata('game-runs/race')).etag, saved.etag);
    assert.equal((await live.set('absent', 'x', { onlyIfMatch: 'stale' })).modified, false);
    const env = { BITCOIN_DB: db };
    const request = new Request('https://gm-bitcoin-price.david-ee6.workers.dev/.netlify/functions/daily-feed');
    assert.deepEqual(await (await handleFunction(request, env, {})).json(), { editions: [] });
    assert.equal((await handleFunction(new Request('https://whatsbitcoinsprice.com/.netlify/functions/daily-publish'), env, {})).status, 401);
    assert.equal((await handleFunction(new Request('https://whatsbitcoinsprice.com/.netlify/functions/toString'), env, {})).status, 404);
  } finally { await mf.dispose(); }
});
