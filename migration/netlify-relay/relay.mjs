// Copy this directory beside the eight relay wrappers in a separate original-source checkout.
// Never deploy this folder alone: Netlify's original frontend and Next server artifacts are required.
const BASE = 'https://gm-bitcoin-price.david-ee6.workers.dev/__gm-migration/relay/';
const METHODS = Object.freeze({ 'daily-feed': ['GET', 'HEAD'], 'daily-vote': ['POST'], newsletter: ['GET', 'POST'], game: ['POST'], 'email-events': ['POST'], 'daily-publish': ['POST'], 'daily-dispatch': ['POST'], 'daily-send-background': ['POST'] });
export function createRelay(name, { env = process.env, send = fetch } = {}) {
  if (!Object.hasOwn(METHODS, name)) throw new Error('Unknown relay function');
  return async (request, context) => {
    if (env.MIGRATION_NETLIFY_RELAY_ENABLED !== 'true' || typeof env.MIGRATION_RELAY_SECRET !== 'string' || env.MIGRATION_RELAY_SECRET.length < 32) {
      return Response.json({ error: 'Updates are temporarily unavailable.' }, { status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' } });
    }
    if (!METHODS[name].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    const headers = new Headers();
    // Explicitly exclude client-controlled relay/proxy headers. Keep raw webhook auth and body.
    for (const key of ['content-type', 'origin', 'cookie', 'authorization', 'svix-id', 'svix-timestamp', 'svix-signature', 'accept']) {
      const value = request.headers.get(key); if (value !== null) headers.set(key, value);
    }
    headers.set('x-gm-relay-authorization', `Bearer ${env.MIGRATION_RELAY_SECRET}`);
    headers.set('x-gm-original-url', request.url);
    headers.set('x-gm-client-ip', context?.ip || 'unknown');
    if (Number(request.headers.get('content-length')) > 65536) return new Response('Request too large', { status: 413 });
    const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
    if (body && body.byteLength > 65536) return new Response('Request too large', { status: 413 });
    try {
      // Exactly one attempt. A network error after a write has an ambiguous outcome.
      const response = await send(BASE + name, { method: request.method, headers, body, redirect: 'manual', signal: AbortSignal.timeout(45000) });
      const result = new Response(response.body, response);
      result.headers.set('Cache-Control', 'no-store');
      return result;
    } catch {
      return Response.json({ error: 'The result could not be confirmed. Reload to check the current state before trying again.' }, { status: 502, headers: { 'Cache-Control': 'no-store' } });
    }
  };
}
