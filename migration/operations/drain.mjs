import { setTimeout } from 'node:timers/promises';
import { argumentsOf, requireFlags, valueOf, apiClient, privateJSON, ACCOUNT, DATABASE, run } from './common.mjs';
run(async () => {
  const args = argumentsOf();
  requireFlags(args, ['--ack-relay-is-published', '--ack-historical-writers-fenced', '--ack-schedulers-disabled']);
  const output = valueOf(args, '--evidence');
  const query = apiClient();
  await query("CREATE TABLE IF NOT EXISTS migration_control (id TEXT PRIMARY KEY, state TEXT NOT NULL CHECK (state IN ('closed','open')), updated_at TEXT NOT NULL)");
  const closedAt = new Date().toISOString();
  await query("INSERT INTO migration_control (id,state,updated_at) VALUES ('production-writes','closed',?1) ON CONFLICT(id) DO UPDATE SET state='closed',updated_at=excluded.updated_at", [closedAt]);
  // Netlify synchronous maximum is 60s; background maximum is 15 minutes.
  const seconds = args.get('--ack-background-inactive') === true ? 65 : 905;
  console.log(`Production writes closed. Waiting ${seconds} seconds for existing invocations.`);
  for (let remaining = seconds; remaining > 0; remaining -= 30) await setTimeout(Math.min(30, remaining) * 1000);
  await privateJSON(output, { account: ACCOUNT, database: DATABASE, closedAt, drainedAt: new Date().toISOString(), drainSeconds: seconds, historicalWritersFenced: true, relayPublished: true, schedulersDisabled: true });
  console.log('Drain evidence saved. Take a fresh strong-consistency Netlify snapshot now. Writes remain closed.');
});
