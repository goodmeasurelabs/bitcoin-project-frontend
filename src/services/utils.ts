import { historyWindow, normalizeCandles, normalizeRates, type MarketData, type PriceSnapshot } from "./marketData";

async function request(url: string, revalidate: number) {
  const response = await fetch(url, {
    next: { revalidate },
    signal: AbortSignal.timeout(10000),
    headers: { Accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Market data request failed (${response.status})`);
  return response;
}

export async function getBitCoinPrice(): Promise<PriceSnapshot> {
  const response = await request("https://api.coinbase.com/v2/exchange-rates?currency=BTC", 60);
  const rates = normalizeRates(await response.json());
  const responseDate = response.headers.get("date");
  return { rates, fetchedAt: responseDate && Number.isFinite(Date.parse(responseDate)) ? new Date(responseDate).toISOString() : new Date().toISOString() };
}

export async function getBitcoinStockChartData() {
  const now = new Date();
  const { start, end } = historyWindow(now);
  const params = new URLSearchParams({
    granularity: "ONE_DAY", start: String(start / 1000), end: String(end / 1000), limit: "31"
  });
  // Public market data on the same Coinbase host as the working quote feed.
  // This endpoint needs no API key and returns numeric strings in candle objects.
  const response = await request(`https://api.coinbase.com/api/v3/brokerage/market/products/BTC-USD/candles?${params}`, 3600);
  return normalizeCandles(await response.json(), now);
}

export async function getMarketData(): Promise<MarketData> {
  const [quote, history] = await Promise.allSettled([getBitCoinPrice(), getBitcoinStockChartData()]);
  return {
    quote: quote.status === "fulfilled" ? quote.value : null,
    history: history.status === "fulfilled" ? history.value : [],
    quoteError: quote.status === "rejected",
    historyError: history.status === "rejected"
  };
}
