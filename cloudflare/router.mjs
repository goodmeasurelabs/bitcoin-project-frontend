import { handleFunction, handleRelayedFunction, handleSchedule, isProduction } from './functions.mjs';
import { handleRelay } from './relay.mjs';
import { RELAY_PREFIX, FUNCTION_PREFIX } from './migration-policy.mjs';

export function createWorker(next) {
  return {
    async fetch(request, env, ctx) {
      const url = new URL(request.url);
      const preview = !isProduction(url.hostname);
      let response;
      // Function URLs must preserve methods and bodies on www too.
      if (url.pathname.startsWith(RELAY_PREFIX)) response = await handleRelay(request, env, ctx, handleRelayedFunction);
      else if (url.pathname.startsWith(FUNCTION_PREFIX)) response = await handleFunction(request, env, ctx);
      else if (url.hostname === 'www.whatsbitcoinsprice.com') {
        url.hostname = 'whatsbitcoinsprice.com';
        return Response.redirect(url, 308);
      } else if (preview && url.pathname === '/robots.txt') {
        response = new Response('User-agent: *\nDisallow: /\n', { headers: { 'Content-Type': 'text/plain' } });
      } else response = await next.fetch(request, env, ctx);
      if (!preview) return response;
      // Do not flatten multiple Set-Cookie values when adding the preview header.
      const result = new Response(response.body, response);
      result.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
      return result;
    },
    scheduled: handleSchedule,
  };
}
