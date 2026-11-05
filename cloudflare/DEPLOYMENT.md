# Cloudflare deployment

Production is https://whatsbitcoinsprice.com/, served by the existing `gm-bitcoin-price` Worker in account `ee641897681cddb2b23b18fb4b639034`. PR13 reconciles the migration in PR12 with deployment from GitHub `main`; neither PR represents a new Worker or database.

The workflow validates pull requests without deployment credentials. After a push to `main`, it uses the `cloudflare-production` environment and the existing approved encrypted `CLOUDFLARE_DEPLOY_TOKEN`. A manual run defaults to read-only **inspect**; an explicit **deploy** still requires current `main`. Inspection reads only this Worker's metadata and does not query D1. No credential value is stored in this repository.

Production uses the explicit command `wrangler deploy --config wrangler.ci.jsonc --keep-vars`, with the exact source commit in the version annotation. This config excludes routes, custom domains and database migrations. Do not substitute `wrangler.jsonc`: that file retains migration-era custom-domain setup. Authenticated UI captures verify the existing apex/www domains separately because the token has only selected-Worker permissions.

The existing `BITCOIN_DB` binding remains `gm-bitcoin-data` (`74f8cb0b-6a5f-47fd-9152-ef725eb9f998`). Both existing daily schedules (06:00 and 13:00 UTC), relay secret name, runtime policy, Workers URL state and compatibility settings are checked before and after publication. D1 identity and the exact reviewed policy are checked in memory; artifacts record only boolean matches and binding names/types, without environment values, value hashes or D1 IDs. Other plaintext variables stay unrecorded and are preserved by `--keep-vars`. Encrypted values are never read. Newsletter sending stays disabled. The guard never queries, imports, migrates or changes data or migration control gates.

Next16.4.5, OpenNext1.20.16 and Wrangler4.158.0 are pinned together. The adapter uses the webpack build and explicit asset HTML/not-found handling. The existing public Google Analytics ID remains supplied by the tracked public-only build configuration. App behavior changes are outside this release reconciliation.

Original Netlify hosting remains available for rollback through its existing authenticated D1 relay; do not restore the old independent Blobs backend or rerun migration/control commands. See [release verification](RELEASE.md).
