import Link from "next/link";
import PriceDisplay from "../directory/PriceDisplay";
import { getMarketData } from "../../services/utils";

export const metadata = {
  title: "Bitcoin price and 30-day chart · Bitcoin in real life",
};

// Refresh server-rendered prices rather than freezing them at deployment time.
export const dynamic = 'force-dynamic';

export default async function Home() {
  const initialData = await getMarketData();
  return (
    <>
      <main className="min-h-screen p-3 md:p-12">
        <div className="mx-auto w-full max-w-5xl font-mono text-sm">
          <Link href="/" className="mb-6 inline-block text-sm text-lime-300">
            ← Back to the possibilities
          </Link>
          <PriceDisplay initialData={initialData} />
        </div>
      </main>
    </>
  );
}
