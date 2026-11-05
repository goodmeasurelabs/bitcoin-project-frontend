import { readFile, writeFile, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
export const ACCOUNT = 'ee641897681cddb2b23b18fb4b639034';
export const DATABASE = '74f8cb0b-6a5f-47fd-9152-ef725eb9f998';
export const SITE = '728bf291-80a8-4a35-bc99-f082896881ac';
export function argumentsOf(argv = process.argv.slice(2)) {
  const values = new Map();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new Error('Only named operational flags are accepted');
    const key = argv[i];
    if (values.has(key)) throw new Error('Duplicate operational flag');
    values.set(key, argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true);
  }
  return values;
}
export function requireFlags(args, flags) {
  for (const flag of ['--execute', ...flags]) if (args.get(flag) !== true) throw new Error(`Refusing operation without ${flag}`);
}
export function valueOf(args, name) {
  const value = args.get(name); if (typeof value !== 'string' || !value) throw new Error(`Missing ${name}`); return value;
}
export function apiClient(env = process.env, send = fetch) {
  if (env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT || !env.CLOUDFLARE_API_TOKEN) throw new Error('Explicit approved Cloudflare account and token environment are required');
  return async (sql, params = []) => {
    // No retry of a possibly committed operation, and no query/error payload in console output.
    const response = await send(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/d1/database/${DATABASE}/query`, {
      method: 'POST', headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sql, params }), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`D1 operation returned HTTP ${response.status}; inspect state before retrying`);
    const data = await response.json();
    if (!data.success || !data.result?.[0]?.success) throw new Error('D1 operation was not confirmed; inspect state before retrying');
    return data.result[0].results || [];
  };
}
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function privateJSON(path, value) {
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600, flag: 'wx' });
  await chmod(path, 0o600);
}
export async function readJSON(path) { return JSON.parse(await readFile(path, 'utf8')); }
export async function assertClosed(query) {
  const rows = await query("SELECT state FROM migration_control WHERE id = 'production-writes'");
  if (rows[0]?.state !== 'closed') throw new Error('Production must be explicitly closed before this operation');
}
export function run(main) { main().catch(() => { console.error('Operation refused or failed. No automatic retry was made. Review flags, permissions, and current state without printing private payloads.'); process.exitCode = 1; }); }
