import type { Metadata } from "next";
import { getDailyEdition } from "@/services/daily";
import { getMarketData } from "../services/utils";
import PurchasingPower from "./components/PurchasingPower";
export const metadata: Metadata = {
  title: "Catch the next move · Play live Bitcoin",
  description:
    "Up or Down? Play the free next-move Bitcoin game, build your streak, then explore the daily find and what Bitcoin can buy.",
  openGraph: {
    title: "Catch the next move · Play live Bitcoin",
    description:
      "Call Bitcoin’s next move. Play free, build a streak, and challenge a friend.",
    images: [{ url: "/play/card?score=0", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Catch the next move · Play live Bitcoin",
    images: ["/play/card?score=0"],
  },
};
export const dynamic = 'force-dynamic';
export default async function Home() {
  const [market, edition] = await Promise.all([
    getMarketData(),
    getDailyEdition(),
  ]);
  return (
    <>
      <PurchasingPower initialData={market} dailyEdition={edition} />
    </>
  );
}
