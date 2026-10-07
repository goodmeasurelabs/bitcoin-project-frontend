import { createRelay } from '../relay.mjs';
export default createRelay('daily-send-background');
// No schedule: Cloudflare takes over scheduling only after the data handoff.
