import { timingSafeEqual } from 'node:crypto';
import { FUNCTION_PREFIX, RELAY_PREFIX, WORKER_HOST, FUNCTION_METHODS, isProduction } from './migration-policy.mjs';

export function relayAuthenticated(headers, secret) {
  if (typeof secret !== 'string' || secret.length < 32) return false;
  const actual = Buffer.from(headers.get('x-gm-relay-authorization') || '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

// The dispatch callback is private module wiring, never chosen by request headers.
export async function handleRelay(request, env, ctx, dispatch) {
  const incoming = new URL(request.url);
  if (incoming.hostname !== WORKER_HOST || env.MIGRATION_RELAY_ENABLED !== 'true') return new Response('Not found', { status: 404 });
  if (!relayAuthenticated(request.headers, env.MIGRATION_RELAY_SECRET)) return new Response('Unauthorized', { status: 401 });
  const name = incoming.pathname.slice(RELAY_PREFIX.length);
  if (!Object.hasOwn(FUNCTION_METHODS, name)) return new Response('Not found', { status: 404 });
  if (!FUNCTION_METHODS[name].includes(request.method)) return new Response('Method not allowed', { status: 405 });
  let original;
  try { original = new URL(request.headers.get('x-gm-original-url')); } catch { return new Response('Invalid original URL', { status: 400 }); }
  const stableHost = env.MIGRATION_NETLIFY_HOST;
  const trustedHost = isProduction(original.hostname) || (
    typeof stableHost === 'string' && /^[a-z0-9-]+\.netlify\.app$/.test(stableHost) && original.hostname === stableHost
  );
  if (!trustedHost || original.protocol !== 'https:' || original.port || original.username || original.password || original.hash || original.pathname !== FUNCTION_PREFIX + name) {
    return new Response('Invalid original URL', { status: 400 });
  }
  // Keep origin validation in the original handler. Never silently rewrite Origin.
  const ip = request.headers.get('x-gm-client-ip') || 'unknown';
  if (ip.length > 64 || /[\r\n]/.test(ip)) return new Response('Invalid client address', { status: 400 });
  if (Number(request.headers.get('content-length')) > 65536) return new Response('Request too large', { status: 413 });
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer();
  if (body && body.byteLength > 65536) return new Response('Request too large', { status: 413 });
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()]) {
    if (key.startsWith('x-gm-') || ['host', 'content-length', 'cf-connecting-ip', 'x-forwarded-for', 'forwarded'].includes(key)) headers.delete(key);
  }
  const restored = new Request(original, { method: request.method, headers, body });
  return dispatch(restored, env, ctx, { ip });
}
