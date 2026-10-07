import dailyFeed from '../netlify/functions/daily-feed.mjs';
import dailyVote from '../netlify/functions/daily-vote.mjs';
import dailyPublish from '../netlify/functions/daily-publish.mjs';
import dailyDispatch from '../netlify/functions/daily-dispatch.mjs';
import dailySend from '../netlify/functions/daily-send-background.mjs';
import emailEvents from '../netlify/functions/email-events.mjs';
import game from '../netlify/functions/game.mjs';
import newsletter from '../netlify/functions/newsletter.mjs';
import { withStorage } from './context.mjs';
import { isProduction, isMutation, productionWritesEnabled, unavailable } from './migration-policy.mjs';
export { isProduction } from './migration-policy.mjs';

const handlers = { 'daily-feed': dailyFeed, 'daily-vote': dailyVote, 'email-events': emailEvents, game, newsletter };
const jobs = { 'daily-publish': dailyPublish, 'daily-dispatch': dailyDispatch, 'daily-send-background': dailySend };
export async function handleFunction(request, env, ctx) {
  return dispatchFunction(request, env, ctx, isProduction(new URL(request.url).hostname), request.headers.get('cf-connecting-ip') || 'unknown');
}

// Called only by the authenticated relay module, never from ordinary request input.
export async function handleRelayedFunction(request, env, ctx, { ip }) {
  return dispatchFunction(request, env, ctx, true, ip);
}

async function dispatchFunction(request, env, ctx, live, ip) {
  const url = new URL(request.url);
  const name = url.pathname.slice('/.netlify/functions/'.length);
  if (Object.hasOwn(jobs, name)) {
    if (!env.NEWSLETTER_JOB_SECRET || request.headers.get('authorization') !== `Bearer ${env.NEWSLETTER_JOB_SECRET}`) {
      return new Response('Unauthorized', { status: 401 });
    }
    if (!live) return new Response('Scheduled jobs are disabled on staging', { status: 403 });
    if (!await productionWritesEnabled(env)) return unavailable();
    return withStorage(env.BITCOIN_DB, 'production', async () => {
      if (name === 'daily-send-background') {
        ctx.waitUntil(dailySend(request));
        return new Response(null, { status: 202 });
      }
      return await jobs[name](request) ?? new Response(null, { status: 204 });
    });
  }
  const handler = Object.hasOwn(handlers, name) && handlers[name];
  if (!handler) return new Response('Not found', { status: 404 });
  if (live && isMutation(request.method) && !await productionWritesEnabled(env)) return unavailable();
  // Preview requests never access production subscriber or game records.
  return withStorage(env.BITCOIN_DB, live ? 'production' : 'preview', () => handler(request, { ip }));
}

export async function handleSchedule(event, env) {
  // Enabled only after the production data import and hosting cutover.
  if (env.MIGRATION_CRON_ENABLED !== 'true') return;
  if (!await productionWritesEnabled(env)) return;
  return withStorage(env.BITCOIN_DB, 'production', async () => {
    if (event.cron === '0 6 * * *') await dailyPublish();
    if (event.cron === '0 13 * * *') await dailyDispatch();
  });
}
