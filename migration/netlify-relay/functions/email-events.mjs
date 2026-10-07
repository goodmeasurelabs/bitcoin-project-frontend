import { createRelay } from '../relay.mjs';
export default createRelay('email-events');
// No schedule: Cloudflare takes over scheduling only after the data handoff.
