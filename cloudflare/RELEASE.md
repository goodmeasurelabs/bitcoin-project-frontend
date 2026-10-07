# Release verification

Prepared on a reconciliation branch. This workflow has not deployed production through GitHub Actions. Pull requests build and run the existing checks without deployment secrets. Pushes to `main` validate, rebuild the same commit in the `cloudflare-production` environment, then deploy. Manual runs also require `main`. Failed validation stops the release.

Before merging: verify deployed-source parity, approve and bind the least-privilege encrypted `CLOUDFLARE_DEPLOY_TOKEN`, confirm current runtime bindings with authenticated provider reads, and test the candidate host. Missing credentials are a blocker, not evidence that no secret exists (the current GitHub secret read returned 403). Existing protection rules must remain intact.

Retain original hosting and the current Cloudflare deployment/version ID for rollback. A homepage HTTP 200 alone does not establish functional correctness or source parity. Record the successful Actions run, exact commit, resulting provider version, critical-route/browser checks, and rollback target in the platform release registry. Only then disconnect obsolete repository-scoped provider build/check integration. Keep data services and rollback deployments.

Browser QA must block analytics, feedback, email, and writes; it does not verify those live integrations. Bitcoin retains its D1 relay and disabled newsletter sending. Babe Ruth gameplay retains its previously accepted retired-backend limitation.
