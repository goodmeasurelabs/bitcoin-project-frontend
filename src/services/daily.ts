import { getCloudflareContext } from '@opennextjs/cloudflare';
import { headers } from 'next/headers';
import { createD1Store } from '../../cloudflare/d1-store.mjs';
import firstEdition from "@/data/first-edition.json";
import type { Edition } from "@/app/components/DailyBitcoin";
export async function getDailyEdition(): Promise<Edition> {
  try {
    const { env } = getCloudflareContext();
    const host = (await headers()).get('host')?.split(':')[0];
    const db = createD1Store((env as unknown as { BITCOIN_DB: Parameters<typeof createD1Store>[0] }).BITCOIN_DB,
      host === 'whatsbitcoinsprice.com' || host === 'www.whatsbitcoinsprice.com' ? 'production' : 'preview');
    const { blobs } = await db.list({ prefix: 'editions/' });
    const latest = blobs.map((item: { key: string }) => item.key).sort().at(-1);
    if (latest) {
      const edition = await db.get(latest, { type: 'json' });
      if (edition) return edition;
    }
  } catch {
    /* Keep the dated launch snapshot when the feed is unavailable. */
  }
  return firstEdition;
}
