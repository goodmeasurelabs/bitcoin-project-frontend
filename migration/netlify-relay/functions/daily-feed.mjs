import { createRelay } from '../relay.mjs';
export default createRelay('daily-feed');
// No schedule: Cloudflare takes over scheduling only after the data handoff.
