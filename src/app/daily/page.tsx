import { getDailyEdition } from "@/services/daily";
import DailyBitcoin from "../components/DailyBitcoin";
export const dynamic = 'force-dynamic';
export const metadata = {
  title: "The Daily Bitcoin · Real things. Bitcoin prices.",
  description:
    "One surprising real-world find. Verified listing prices, Bitcoin comparisons, and a daily dose of possibility.",
  openGraph: {
    title: "The Daily Bitcoin",
    description: "Real listings. Surprising possibilities. One find at a time.",
    url: "https://whatsbitcoinsprice.com/daily",
  },
  twitter: { card: "summary_large_image" as const, title: "The Daily Bitcoin" },
};
export default async function DailyPage() {
  const edition = await getDailyEdition();
  return (
    <>
      <DailyBitcoin initialEdition={edition} />
    </>
  );
}
