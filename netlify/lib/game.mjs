export const FORECAST_MS = 10000;
export const BUFFER_MS = 0;
export function cleanTrades(raw) {
  if (!Array.isArray(raw)) throw new Error("Market unavailable");
  return raw
    .map((t) => ({
      time: Date.parse(t.time),
      price: Number(t.price),
      ...(Number.isSafeInteger(t.trade_id) ? { id: t.trade_id } : {}),
    }))
    .filter(
      (t) => Number.isFinite(t.time) && Number.isFinite(t.price) && t.price > 0,
    )
    .sort((a, b) => a.time - b.time || (a.id || 0) - (b.id || 0));
}
export function makeOffer(trades, streak, now) {
  const last = trades.at(-1);
  if (!last || now - last.time > 5000 || last.time > now + 2000)
    throw new Error("Market feed is delayed. Try again shortly.");
  const recent = trades.filter((t) => t.time >= now - 120000);
  if (recent.length < 10 || last.time - recent[0].time < 20000)
    throw new Error("Not enough fresh market history. Try again shortly.");
  const moves = [];
  for (let i = 0; i < recent.length; i++) {
    const before = recent.find((t) => t.time >= recent[i].time - FORECAST_MS);
    if (before && recent[i].time - before.time >= 4000)
      moves.push(Math.abs(recent[i].price - before.price));
  }
  moves.sort((a, b) => a - b);
  if (!moves.length)
    throw new Error("Market is warming up. Try again shortly.");
  const typical = moves[Math.floor(moves.length * 0.7)];
  const flatHalfWidth = 0;
  return {
    anchor: last.price,
    flatHalfWidth,
    chartHalfSpan: Math.max(5, Math.ceil(typical * 4 * 100) / 100),
    forecastMs: FORECAST_MS,
    bufferMs: BUFFER_MS,
    expiresAt: now + 30000,
    rulesVersion: 5,
  };
}
export function settlement(trades, round, now) {
  if (round.rulesVersion === 5) return nextMoveSettlement(trades, round, now);
  if (now < round.endsAt + 1500) return null;
  if (now > round.endsAt + 60000)
    return {
      outcome: "miss",
      reason: "Round expired before verification. Start a fresh streak.",
    };
  const start = round.endsAt - 1000;
  const before = trades.filter((t) => t.time <= start).at(-1);
  const after = trades.find((t) => t.time >= round.endsAt);
  // The REST trade feed can lag the live WebSocket; wait for final coverage.
  if (before && !after && now < round.endsAt + 8000) return null;
  if (
    !before ||
    !after ||
    start - before.time > 5000 ||
    after.time - round.endsAt > 5000
  )
    return {
      outcome: "void",
      reason: "Market data could not be verified. Your streak is safe.",
    };
  const window = trades.filter((t) => t.time > start && t.time < round.endsAt);
  // Time-weighted last-trade price over the final second; boundary ticks are deterministic.
  let price = before.price,
    time = start,
    total = 0;
  for (const tick of window) {
    total += price * (tick.time - time);
    time = tick.time;
    price = tick.price;
  }
  total += price * (round.endsAt - time);
  const settledPrice = total / 1000;
  // Flat owns both boundaries, so every finish has exactly one outcome.
  const actualDirection = directionAt(
    settledPrice,
    round.anchor,
    round.flatHalfWidth,
  );
  return {
    outcome:
      round.rulesVersion >= 3
        ? actualDirection === round.direction ||
          (round.rulesVersion >= 4 && actualDirection === "flat")
          ? "win"
          : "miss"
        : settledPrice >= round.low && settledPrice <= round.high
          ? "win"
          : "miss",
    settledPrice,
    ...(round.rulesVersion >= 3 ? { actualDirection } : {}),
  };
}
export async function marketTrades() {
  const r = await fetch(
    `https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000&_=${Date.now()}`,
    {
      signal: AbortSignal.timeout(6000),
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        "User-Agent": "GoodMeasure-BitcoinPrice/1.0 (+https://whatsbitcoinsprice.com)",
      },
    },
  );
  if (!r.ok) {
    const error = await r.json().catch(() => ({}));
    console.warn("Coinbase trade feed request failed", {
      status: r.status,
      message: typeof error.message === "string" ? error.message.slice(0, 200) : undefined,
    });
    throw new Error("Market feed is unavailable. Please try again.");
  }
  return cleanTrades(await r.json());
}

export function directionAt(price, anchor, flatHalfWidth) {
  // Compare in integer cents to avoid floating-point boundary surprises.
  const cents = Math.round(price * 100);
  const low = Math.round((anchor - flatHalfWidth) * 100);
  const high = Math.round((anchor + flatHalfWidth) * 100);
  return cents > high ? "up" : cents < low ? "down" : "flat";
}

export function nextMoveSettlement(trades, round, now) {
  const voidResult = {
    outcome: "void",
    reason: "Market data could not be verified. Your streak is safe.",
  };
  if (now > round.endsAt + 60000)
    return {
      outcome: "miss",
      reason: "Round expired before verification. Start a fresh streak.",
    };
  const anchorIndex = trades.findIndex((t) =>
    round.anchorTradeId !== undefined
      ? t.id === round.anchorTradeId
      : t.time === round.anchorTime && t.price === round.anchor,
  );
  if (anchorIndex < 0) return voidResult;
  const covered = trades.slice(anchorIndex);
  for (let i = 1; i < covered.length; i++) {
    if (
      covered[i].id !== undefined &&
      covered[i - 1].id !== undefined &&
      covered[i].id !== covered[i - 1].id + 1
    )
      return voidResult;
  }
  const baseline = covered.filter((t) => t.time <= round.startsAt).at(-1);
  if (!baseline) return voidResult;
  const move = covered.find(
    (t) =>
      t.time > round.startsAt &&
      t.time <= round.endsAt &&
      Math.round(t.price * 100) !== Math.round(baseline.price * 100),
  );
  if (move) {
    // Let the buffered chart reach the deciding trade before revealing its result.
    if (now < move.time + 800) return null;
    const actualDirection = move.price > baseline.price ? "up" : "down";
    return {
      outcome: actualDirection === round.direction ? "win" : "miss",
      actualDirection,
      anchor: baseline.price,
      settledPrice: move.price,
      resolvedAt: move.time,
    };
  }
  if (now < round.endsAt + 800) return null;
  if (!covered.some((t) => t.time >= round.endsAt))
    return now < round.endsAt + 8000 ? null : voidResult;
  return {
    outcome: "draw",
    anchor: baseline.price,
    settledPrice: baseline.price,
    resolvedAt: round.endsAt,
    reason: "No price change in 10 seconds. Draw—your streak stays safe.",
  };
}
