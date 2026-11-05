import { createRelay } from '../relay.mjs';
export default createRelay('newsletter');
// No schedule: Cloudflare takes over scheduling only after the data handoff.
