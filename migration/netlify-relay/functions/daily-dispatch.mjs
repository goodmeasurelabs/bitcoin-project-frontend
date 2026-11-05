import { createRelay } from '../relay.mjs';
export default createRelay('daily-dispatch');
// No schedule: Cloudflare takes over scheduling only after the data handoff.
