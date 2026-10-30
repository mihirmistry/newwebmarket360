import assert from "node:assert/strict";
import { test } from "node:test";
import { createYahooMarketHistory, lastPerDay, parseHistory } from "../src/services/market-history.js";
import { INDICES } from "../src/services/market-quotes.js";

const NIFTY = INDICES.find((d) => d.id === "nifty")!;
const BANKEX = INDICES.find((d) => d.id === "bankex")!;
const T = Date.UTC(2026, 9, 28, 10, 0) / 1000; // 28 Oct 2026, 3:30 pm IST
const HOUR = 3600;

const chart = (closes: Array<number | null>, opts: { price?: number; prevClose?: number; step?: number } = {}) => ({
  chart: {
    result: [
      {
        meta: {
          regularMarketPrice: opts.price,
          chartPreviousClose: opts.prevClose,
          currentTradingPeriod: { regular: { start: T - 6.25 * HOUR, end: T } },
        },
        timestamp: closes.map((_, i) => T - (closes.length - 1 - i) * (opts.step ?? 300)),
        indicators: { quote: [{ close: closes }] },
      },
    ],
  },
});

test("today: change is measured from the previous close (the header's figure when given), gaps are skipped", () => {
  const body = chart([100, null, 101.5, 99, 102.256], { price: 102.26, prevClose: 98 });
  const own = parseHistory(NIFTY, "1d", body, { nowSeconds: T - 60 })!;
  assert.deepEqual(own.points.map((p) => p[1]), [100, 101.5, 99, 102.26]);
  assert.equal(own.baseline, 98);
  assert.equal(own.change, 4.26);
  assert.equal(own.changePercent, 4.35);
  assert.equal(own.direction, "up");
  assert.equal(own.marketOpen, true);

  const header = parseHistory(NIFTY, "1d", body, { nowSeconds: T + 60, previousClose: 104 })!;
  assert.equal(header.baseline, 104);
  assert.equal(header.change, -1.74);
  assert.equal(header.direction, "down");
  assert.equal(header.marketOpen, false);
});

test("longer ranges: change is measured from the first point", () => {
  const h = parseHistory(NIFTY, "1m", chart([200, 210, 190], { price: 190, prevClose: 195, step: 86400 }), { nowSeconds: T, previousClose: 1 })!;
  assert.equal(h.baseline, 200);
  assert.equal(h.change, -10);
  assert.equal(h.changePercent, -5);
});

test("rejects empty or broken responses", () => {
  assert.equal(parseHistory(NIFTY, "1d", { chart: { result: null } }, { nowSeconds: T }), null);
  assert.equal(parseHistory(NIFTY, "1d", chart([100]), { nowSeconds: T }), null);
  assert.equal(parseHistory(NIFTY, "1d", "nonsense", { nowSeconds: T }), null);
});

test("lastPerDay keeps the last close of each IST day", () => {
  const day = (d: number, h: number) => Date.UTC(2026, 9, d, h) / 1000;
  const pts: Array<[number, number]> = [
    [day(27, 4), 1],
    [day(27, 9), 2],
    [day(28, 4), 3],
    [day(28, 9), 4],
  ];
  assert.deepEqual(lastPerDay(pts), [
    [day(27, 9), 2],
    [day(28, 9), 4],
  ]);
});

test("BANKEX has no daily bars on Yahoo: the year chart is built from hourly bars; results are cached", async () => {
  const urls: string[] = [];
  const hourly = Array.from({ length: 12 }, (_, i) => 60000 + i * 10);
  const history = createYahooMarketHistory({
    now: () => T * 1000,
    fetchImpl: async (url) => {
      urls.push(url);
      const body = url.includes("interval=60m") ? chart(hourly, { price: 60110, step: 6 * HOUR }) : chart([60110], { price: 60110 });
      return { ok: true, status: 200, json: async () => body };
    },
  });
  const h = (await history.get(BANKEX.id, "1y"))!;
  assert.ok(urls[0]!.includes("BSE-BANK.BO") && urls[0]!.includes("interval=1d"));
  assert.ok(urls[1]!.includes("interval=60m"));
  // one point per IST day the 12 bars (6 hours apart) fall on
  const istDays = new Set(hourly.map((_, i) => new Date((T - (11 - i) * 6 * HOUR + 5.5 * HOUR) * 1000).toISOString().slice(0, 10)));
  assert.equal(h.points.length, istDays.size);
  assert.ok(h.points.length >= 3);
  assert.equal(h.baseline, h.points[0]![1]);
  await history.get(BANKEX.id, "1y");
  assert.equal(urls.length, 2, "second request is served from the cache");
  assert.equal(await history.get("nope", "1y"), null);
});
