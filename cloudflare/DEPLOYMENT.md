# Cloudflare deployment

Production: https://whatsbitcoinsprice.com/

Project: `gm-bitcoin-price` in David’s Cloudflare account. The **Deploy Cloudflare** GitHub Actions workflow builds and checks the selected source revision, deploys to this project, and verifies HTTPS.

Activation requires merging the workflow into the default branch and supplying an approved encrypted `CLOUDFLARE_DEPLOY_TOKEN` secret for the `cloudflare-production` environment or repository. The migration CLI token is temporary and is not a GitHub credential. No token value is committed or sent to GitHub by this change. The workflow is prepared; no production CI deployment has been run.

For Workers, `wrangler.ci.jsonc` preserves runtime bindings and excludes custom-domain management; domain cutovers remain separate operations. Runtime service secrets stay encrypted on the Worker. The source configuration retains full custom-domain setup for migration operations.

For Pages, Direct Upload preserves the current Pages project; no native Git connection is needed.

Original hosting remains available for rollback. Bitcoin rollback uses its approved D1 relay, not the old independent Blobs backend.

The reconciliation draft adds validation on pull requests and deployment after a successful push to `main`; see [release verification](RELEASE.md). This is prepared automation, not evidence of a successful production Actions run.
