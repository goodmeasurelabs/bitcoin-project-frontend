import type { DataPoint } from "../app/types";

export type DailyPrice = { date: string; price: number };
export type PriceSnapshot = { rates: Record<string, number>; fetchedAt: string };
export type MarketData = {
  quote: PriceSnapshot | null;
  history: DailyPrice[];
  quoteError: boolean;
  historyError: boolean;
};

export function normalizeRates(body: unknown): Record<string, number> {
  const data = (body as { data?: { currency?: string; rates?: Record<string, unknown> } })?.data;
  if (data?.currency !== "BTC" || !data.rates) throw new Error("Invalid exchange rates");
  const rates: Record<string, number> = {};
  for (const [code, raw] of Object.entries(data.rates)) {
    const value = typeof raw === "string" || typeof raw === "number" ? Number(raw) : NaN;
    if (Number.isFinite(value) && value > 0) rates[code] = value;
  }
  if (!rates.USD) throw new Error("USD exchange rate unavailable");
  return rates;
}

// Use completed UTC days only; the current candle is still changing.
export function historyWindow(now = new Date()) {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return { start: end - 30 * 86400000, end };
}

export function normalizeCandles(body: unknown, now = new Date()): DailyPrice[] {
  const candles = Array.isArray(body) ? body : (body as { candles?: unknown })?.candles;
  if (!Array.isArray(candles)) throw new Error("Invalid historical prices");
  const { start, end } = historyWindow(now);
  const days = new Map<string, number>();
  for (const candle of candles) {
    const numeric = (value: unknown) => typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
    const [seconds, price] = Array.isArray(candle) ? [candle[0], candle[4]]
      : candle && typeof candle === "object" ? [numeric(candle.start), numeric(candle.close)] : [NaN, NaN];
    if (typeof seconds !== "number" || typeof price !== "number" ||
        !Number.isFinite(seconds) || !Number.isFinite(price) || price <= 0) continue;
    const timestamp = seconds * 1000;
    if (timestamp >= start && timestamp < end) days.set(new Date(timestamp).toISOString().slice(0, 10), price);
  }
  const result = Array.from(days, ([date, price]) => ({ date, price })).sort((a, b) => a.date.localeCompare(b.date));
  const yesterday = new Date(end - 86400000).toISOString().slice(0, 10);
  if (result.length < 2 || result[result.length - 1].date !== yesterday) {
    throw new Error("Recent historical prices unavailable");
  }
  return result;
}

export function formatAmount(value: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(value);
}

export function chartData(history: DailyPrice[], rates: Record<string, number> | undefined, currency: string): DataPoint[] {
  // Non-USD history is an estimate using the current FX ratio, not historical FX.
  const ratio = currency === "USD" ? 1 : rates?.[currency] && rates.USD ? rates[currency] / rates.USD : null;
  if (ratio === null || !Number.isFinite(ratio) || ratio <= 0) return [];
  return history.map(({ date, price }, index) => ({
    d: new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }),
    p: formatAmount(price * ratio, currency),
    x: index, y: price * ratio, cy: price * ratio
  }));
}

export function priceChange(current: number | null, baseline: number | undefined) {
  if (current === null || !Number.isFinite(current) || current <= 0 ||
      baseline === undefined || !Number.isFinite(baseline) || baseline <= 0) return null;
  const amount = current - baseline;
  return { amount, percent: amount / baseline * 100 };
}

export function chartScale(points: { x: number; y: number }[]) {
  const values = points.map(point => point.y);
  let min = Math.min(...values), max = Math.max(...values);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.01, 0.01);
    min -= padding;
    max += padding;
  }
  const firstX = points[0].x, lastX = points[points.length - 1].x;
  return {
    min, max,
    x: (value: number) => lastX === firstX ? 0.5 : (value - firstX) / (lastX - firstX),
    y: (value: number) => (value - min) / (max - min)
  };
}
