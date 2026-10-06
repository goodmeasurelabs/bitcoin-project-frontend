# Bitcoin data handoff — local readiness only

No script in this directory has been run against production. Both Worker release flags default to false. A missing or closed `migration_control` row also rejects production mutations. Preview requests retain the separate `preview` namespace.

## Release boundaries

- The authenticated endpoint is fixed at `https://gm-bitcoin-price.david-ee6.workers.dev/__gm-migration/relay/<known-function>`.
- Configure a dedicated random secret of at least 32 characters on this Worker and the existing Netlify site's server runtime only. This implementation does not generate or upload it. Never use the Cloudflare deployment token as the relay secret.
- Worker variables: `MIGRATION_RELAY_ENABLED=true`, `MIGRATION_PRODUCTION_WRITES_ENABLED=true`, and `MIGRATION_NETLIFY_HOST` equal to the independently verified stable Netlify hostname. The D1 control row still starts closed. Keep email sending and Cloudflare cron disabled during the handoff.
- Netlify runtime variables: `MIGRATION_NETLIFY_RELAY_ENABLED=true` and `MIGRATION_RELAY_SECRET`. Netlify variables are deployment-time values; set them using the provider's supported secret configuration before building the relay release. Shell variables alone do not establish deployed Netlify runtime values.
- The relay preserves original URL, method, query, body, cookies, job authorization, webhook signature headers, and trusted `context.ip`. Original handlers still enforce their existing origin and job authentication. Normal preview requests cannot select production by headers.
- Requests make one upstream attempt. A timeout returns an uncertain-result message; it never replays a mutation automatically.

## Required cutover preparation

1. Inventory and fence historical Netlify deploy/branch/preview writers. Production redeployment does not alter their immutable functions. Keep original deploys; do not delete them. If existing free controls cannot fence those paths, stop before activating D1 writes and resolve that decision.
2. Preserve the current published Netlify deploy and record its ID. Create a separate checkout from its verified source revision. Copy the eight `netlify-relay/functions/*.mjs` wrappers over that checkout's eight backend entry points, and copy `netlify-relay/relay.mjs` to `netlify/relay.mjs`. Do not copy the Cloudflare-only `netlify/lib/storage.mjs` into the original checkout. Retain all original pages, assets, redirects, Next server handlers and configuration. Disable original schedules in both code and provider configuration.
3. Build and test that complete Netlify checkout. A functions-only deploy would drop needed Next artifacts and is forbidden. Test relay behavior with a separate synthetic namespace/local environment, not customer records. Verify secret configuration by names and runtime behavior without printing values.
4. Build/test the Worker with its two release flags deliberately enabled, while the D1 row remains closed. Deploy and verify the private relay rejects unauthenticated/unknown endpoints and the gate rejects mutations. Deploy the tested Netlify relay release and verify its public stable host/domain routes use the new wrappers.
5. Run `drain.mjs` with the flags below. It closes the D1 gate and waits 65 seconds if background work is explicitly verified inactive, otherwise 905 seconds. All old writers and schedulers must already be fenced. Read-only pages stay available; mutation responses ask visitors to retry. Do not accept mutations locally and then silently drop them.
6. Take a new strong-consistency Netlify snapshot using the existing backup process. Its two listings must be stable and its timestamp after drain completion. Run reconciliation within five minutes; it validates each byte hash, imports a new private handoff namespace, refuses unexplained extra production records, atomically upserts changed and new records, and verifies exact parity. This is not the original `ON CONFLICT DO NOTHING` import.
7. Open the D1 gate only with fresh reconciliation evidence and verified single authority. Confirm the Netlify frontend is functioning against D1, then change website hosting to the Cloudflare Worker. Preserve the Netlify relay release as rollback. Move the daily publisher schedule to Cloudflare exactly once after cutover; retain the existing disabled email policy.

## Operational commands (templates; do not execute as a batch)

All scripts require `--execute`. Missing flags fail before network calls. D1 scripts require `CLOUDFLARE_ACCOUNT_ID` equal to the approved account and its already approved temporary `CLOUDFLARE_API_TOKEN`. Do not paste credentials into commands. Commands never automatically retry uncertain writes.

```
node migration/operations/drain.mjs --execute \
  --ack-relay-is-published --ack-historical-writers-fenced --ack-schedulers-disabled \
  --ack-background-inactive --evidence /private/path/drain.json

node migration/operations/reconcile.mjs --execute \
  --ack-historical-writers-fenced --ack-production-remains-closed \
  --snapshot /private/path/fresh-snapshot.json --drain-evidence /private/path/drain.json \
  --evidence /private/path/reconciliation.json

node migration/operations/open-writes.mjs --execute \
  --ack-single-d1-authority --ack-historical-writers-fenced --ack-relay-and-production-tested \
  --reconciliation-evidence /private/path/reconciliation.json
```

`deploy.mjs` requires `--target worker|netlify`, `--source`, `--tested-source-digest`, `--private-log`, `--execute`, `--ack-exact-source-tested`, and `--ack-production-write-gate-closed`. Obtain the digest by calling exported `sourceDigest()` on the exact tested source. For Netlify it additionally requires `--netlify-cli-js`, `--ack-original-frontend-preserved`, `--ack-netlify-stage-built-and-tested`, `--ack-historical-writers-fenced`, `--ack-schedulers-disabled`, and existing `NETLIFY_AUTH_TOKEN` plus relay environment variables. Provider-side runtime secret configuration remains a separate prerequisite. Deploy logs are private and newly created; inspect provider state before retrying failures.

## Rollback and existing application risks

Before reopening writes, rollback to the preserved original Netlify deploy is safe because Netlify Blobs is still authoritative. After reopening, frontend rollback must use the Netlify relay release and retain D1 authority. A full D1-to-Blobs rollback requires another write drain, reverse reconciliation, exact verification, and coordinated backend change; do not simply restore the historical Blobs-backed deploy.

Existing newsletter code has read-modify-write races for rate limits and subscriber status, plus separate subscriber/token writes. This change preserves behavior and does not refactor delivery. Address conditional subscriber updates and transactional token creation before enabling sending. Current game writes already use atomic ETag comparison and create-if-absent.

Material unresolved decisions: historical-writer fencing if unavailable on the existing plan, any paid access control, or a prolonged interruption. Relay credentials remain narrow server-to-server credentials; no new service or broader account token is needed.
