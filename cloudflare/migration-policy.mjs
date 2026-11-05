export const FUNCTION_PREFIX = '/.netlify/functions/';
export const RELAY_PREFIX = '/__gm-migration/relay/';
export const WORKER_HOST = 'gm-bitcoin-price.david-ee6.workers.dev';
export const FUNCTION_METHODS = Object.freeze({
  'daily-feed': ['GET', 'HEAD'], 'daily-vote': ['POST'], newsletter: ['GET', 'POST'],
  game: ['POST'], 'email-events': ['POST'], 'daily-publish': ['POST'],
  'daily-dispatch': ['POST'], 'daily-send-background': ['POST'],
});
export const isProduction = hostname => ['whatsbitcoinsprice.com', 'www.whatsbitcoinsprice.com'].includes(hostname);
export const isMutation = method => !['GET', 'HEAD', 'OPTIONS'].includes(method);
export function unavailable() {
  return Response.json({ error: 'Updates are temporarily paused for migration. Please try again shortly.' }, {
    status: 503, headers: { 'Retry-After': '60', 'Cache-Control': 'no-store' },
  });
}
export async function productionWritesEnabled(env) {
  // A release must permit opening, then the live drain gate must be opened separately.
  if (env.MIGRATION_PRODUCTION_WRITES_ENABLED !== 'true' || !env.BITCOIN_DB) return false;
  try {
    const row = await env.BITCOIN_DB.prepare("SELECT state FROM migration_control WHERE id = 'production-writes'").first();
    return row?.state === 'open';
  } catch {
    // Databases without the migration table also fail closed.
    return false;
  }
}
