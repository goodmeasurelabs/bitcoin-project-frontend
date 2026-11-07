const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeRates, normalizeCandles, chartData, chartScale, priceChange, formatAmount, historyWindow } = require('../.test-build/services/marketData.js');
const { getMarketData } = require('../.test-build/services/utils.js');

const now = new Date('2026-09-22T14:00:00Z');
const candle = (date, close) => [Date.parse(`${date}T00:00:00Z`) / 1000, close - 1, close + 1, close, close, 10];

test('prices stay numeric until display; formatted thousands cannot truncate to 64', () => {
  const rates = normalizeRates({ data: { currency: 'BTC', rates: { USD: '64000.25', EUR: '58000.5', BAD: 'NaN', ZERO: '0', NEG: '-1', COMMA: '64,000.25' } } });
  assert.equal(rates.USD, 64000.25);
  assert.equal(formatAmount(rates.USD, 'USD'), '$64,000.25');
  assert.deepEqual(Object.keys(rates), ['USD', 'EUR']);
  assert.throws(() => normalizeRates({ data: { currency: 'BTC', rates: { USD: 'broken' } } }));
});

test('history uses sorted daily closes, excludes live candle and out-of-window data', () => {
  const history = normalizeCandles([
    candle('2026-09-22', 90000), candle('2026-09-21', 81000),
    candle('2026-08-22', 1), candle('2026-08-24', 70000), candle('2026-09-20', 80000),
    candle('2026-09-20', 80000), candle('2026-09-19', 0), null
  ], now);
  assert.deepEqual(history, [
    { date: '2026-08-24', price: 70000 }, { date: '2026-09-20', price: 80000 }, { date: '2026-09-21', price: 81000 }
  ]);
  assert.equal(new Date(historyWindow(now).start).toISOString(), '2026-08-23T00:00:00.000Z');
});

test('empty, malformed, and stale historical responses fail explicitly', () => {
  for (const body of [[], {}, [candle('2024-07-01', 64000)], [candle('2026-09-19', 80000), candle('2026-09-20', 81000)]]) {
    assert.throws(() => normalizeCandles(body, now));
  }
});

test('public Coinbase candles use numeric closes, completed UTC days and a fresh final day', () => {
  const publicCandle = (date, close) => ({ start: String(Date.parse(`${date}T00:00:00Z`) / 1000), close });
  assert.deepEqual(normalizeCandles({ candles: [
    publicCandle('2026-09-22', '90000'), publicCandle('2026-09-21', '81000.25'),
    publicCandle('2026-09-20', '80000.50'), publicCandle('2026-09-19', ''),
    publicCandle('2026-09-18', 'NaN'), null
  ] }, now), [{ date: '2026-09-20', price: 80000.5 }, { date: '2026-09-21', price: 81000.25 }]);
  for (const body of [{ candles: [] }, { candles: {} }, { candles: [publicCandle('2026-09-20', '80000')] }]) {
    assert.throws(() => normalizeCandles(body, now));
  }
});

test('server chart points include numeric converted baselines and consistent currency labels', () => {
  const history = [{ date: '2026-09-20', price: 70000 }, { date: '2026-09-21', price: 80000 }];
  const rates = { USD: 90000, EUR: 81000, JPY: 13500000 };
  const points = chartData(history, rates, 'EUR');
  assert.equal(points[0].cy, 63000);
  assert.equal(points[0].p, '€63,000.00');
  assert.equal(points[1].y, 72000);
  assert.equal(chartData(history, undefined, 'USD')[0].cy, 70000);
  assert.deepEqual(chartData(history, rates, 'GBP'), []);
  assert.equal(formatAmount(10000000, 'JPY'), '¥10,000,000');
});

test('changes handle gains, losses, flat prices, and missing baseline without NaN', () => {
  assert.deepEqual(priceChange(81000, 90000), { amount: -9000, percent: -10 });
  assert.deepEqual(priceChange(110, 100), { amount: 10, percent: 10 });
  assert.deepEqual(priceChange(100, 100), { amount: 0, percent: 0 });
  for (const baseline of [undefined, 0, NaN, Infinity]) assert.equal(priceChange(100, baseline), null);
  assert.equal(priceChange(null, 100), null);
});

test('flat chart and nonzero x origins produce finite centered coordinates', () => {
  const scale = chartScale([{ x: 5, y: 64000 }, { x: 6, y: 64000 }]);
  assert.equal(scale.x(5), 0);
  assert.equal(scale.x(6), 1);
  assert.equal(scale.y(64000), 0.5);
  assert.ok(Number.isFinite(scale.min) && Number.isFinite(scale.max));
});

test('quote and history fail independently, including provider rate limits', async () => {
  const original = global.fetch;
  try {
    global.fetch = async url => url.includes('exchange-rates')
      ? new Response(JSON.stringify({ data: { currency: 'BTC', rates: { USD: '64000.25' } } }), { headers: { date: 'Tue, 22 Sep 2026 14:00:00 GMT' } })
      : new Response('Rate limited', { status: 429 });
    const result = await getMarketData();
    assert.equal(result.quote.rates.USD, 64000.25);
    assert.equal(result.quote.fetchedAt, '2026-09-22T14:00:00.000Z');
    assert.equal(result.quoteError, false);
    assert.equal(result.historyError, true);
    assert.deepEqual(result.history, []);
    global.fetch = async () => { throw new Error('Offline'); };
    assert.deepEqual(await getMarketData(), { quote: null, history: [], quoteError: true, historyError: true });
  } finally { global.fetch = original; }
});

test('historical chart survives a quote outage', async () => {
  const original = global.fetch;
  const { end } = historyWindow();
  const day = offset => new Date(end - offset * 86400000).toISOString().slice(0, 10);
  try {
    global.fetch = async (url, options) => {
      if (url.includes('exchange-rates')) return new Response('Unavailable', { status: 503 });
      const request = new URL(url);
      assert.equal(request.origin, 'https://api.coinbase.com');
      assert.equal(request.pathname, '/api/v3/brokerage/market/products/BTC-USD/candles');
      assert.equal(request.searchParams.get('granularity'), 'ONE_DAY');
      assert.equal(request.searchParams.get('end'), String(end / 1000));
      assert.equal(Number(request.searchParams.get('end')) - Number(request.searchParams.get('start')), 30 * 86400);
      assert.equal(options.headers.Authorization, undefined, 'public data must not need credentials');
      return new Response(JSON.stringify({ candles: [
        { start: String(Date.parse(day(1)) / 1000), close: '81000' },
        { start: String(Date.parse(day(2)) / 1000), close: '80000' }
      ] }));
    };
    const result = await getMarketData();
    assert.equal(result.quote, null);
    assert.equal(result.quoteError, true);
    assert.equal(result.historyError, false);
    assert.equal(result.history.length, 2);
    assert.equal(chartData(result.history, undefined, 'USD')[0].cy, 80000);
  } finally { global.fetch = original; }
});
