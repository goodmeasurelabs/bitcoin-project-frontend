import { resolve, join } from 'node:path';
import { readFile, readdir, open, stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argumentsOf, requireFlags, valueOf, digest, ACCOUNT, DATABASE, SITE, run } from './common.mjs';
const excluded = new Set(['node_modules', '.git', '.next', '.netlify', '.open-next', '.test-build', '.worker-dry-run', '.wrangler']);
export async function sourceDigest(root) {
  const manifest = [];
  async function visit(relative = '') {
    for (const entry of (await readdir(join(root, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (excluded.has(entry.name) || entry.name.startsWith('.env') || entry.name.endsWith('.log') || entry.name.includes('.private')) continue;
      const path = join(relative, entry.name);
      if (entry.isSymbolicLink()) throw new Error('Source symlinks must be reviewed before deployment');
      if (entry.isDirectory()) await visit(path);
      else manifest.push([path, digest(await readFile(join(root, path)))]);
    }
  }
  await visit();
  return digest(JSON.stringify(manifest));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) run(async () => {
  const args = argumentsOf();
  requireFlags(args, ['--ack-exact-source-tested', '--ack-production-write-gate-closed']);
  const source = resolve(valueOf(args, '--source'));
  const expected = valueOf(args, '--tested-source-digest');
  if (!/^[a-f0-9]{64}$/.test(expected) || await sourceDigest(source) !== expected) throw new Error('Source differs from tested build');
  const target = valueOf(args, '--target');
  let command, argv;
  if (target === 'worker') {
    if (process.env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT || !process.env.CLOUDFLARE_API_TOKEN) throw new Error('Approved Cloudflare credentials are required');
    const config = JSON.parse(await readFile(join(source, 'wrangler.jsonc'), 'utf8'));
    if (config.name !== 'gm-bitcoin-price' || (config.account_id && config.account_id !== ACCOUNT) || config.d1_databases?.length !== 1 || config.d1_databases[0].binding !== 'BITCOIN_DB' || config.d1_databases[0].database_id !== DATABASE || config.routes?.length || config.vars?.NEWSLETTER_SEND_ENABLED !== 'false' || config.vars?.MIGRATION_CRON_ENABLED !== 'false') throw new Error('Unexpected Worker target, routing change, or active sending/cron');
    await stat(join(source, '.open-next/worker.js'));
    command = process.execPath;
    argv = [join(source, 'node_modules/wrangler/bin/wrangler.js'), 'deploy'];
  } else if (target === 'netlify') {
    requireFlags(args, ['--ack-original-frontend-preserved', '--ack-netlify-stage-built-and-tested', '--ack-historical-writers-fenced', '--ack-schedulers-disabled']);
    if (!process.env.NETLIFY_AUTH_TOKEN || process.env.MIGRATION_NETLIFY_RELAY_ENABLED !== 'true' || process.env.MIGRATION_RELAY_SECRET?.length < 32 || !process.env.MIGRATION_RELAY_SECRET) throw new Error('Existing Netlify authorization and explicitly configured relay secrets are required');
    // The separate checkout must contain the unchanged original frontend plus relay wrappers.
    // --build deploys its complete Next adapter output, never a functions-only partial site.
    command = process.execPath;
    const cli = valueOf(args, '--netlify-cli-js');
    if (!cli.endsWith('/netlify-cli/bin/run.js')) throw new Error('Expected the installed Netlify CLI entry point');
    argv = [cli, 'deploy', '--build', '--prod', '--site', SITE, '--cwd', source];
  } else throw new Error('Target must be worker or netlify');
  const log = await open(valueOf(args, '--private-log'), 'wx', 0o600);
  try {
    const code = await new Promise((accept, reject) => {
      const child = spawn(command, argv, { cwd: source, env: process.env, stdio: ['ignore', log.fd, log.fd] });
      child.once('error', reject); child.once('exit', accept);
    });
    if (code !== 0) throw new Error('Deploy was not confirmed; inspect provider state before retrying');
    console.log('Deployment command completed. Verify actual deployed version and runtime behavior before continuing.');
  } finally { await log.close(); }
});
