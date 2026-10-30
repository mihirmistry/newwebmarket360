// Automatic indicators: the scoring rule, the indicator maths, TOTP, the refresh against a fake Angel One client,
// and the admin pages (Angel One settings, Source column, re-scoring, "Refresh now"), against a real PostgreSQL.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import type pg from "pg";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { upsertAdmin } from "../src/services/admins.js";
import { AngelOneError, INDIA_VIX_TOKEN, NIFTY_TOKEN, createAngelOneClient, totpCode, type AngelOneClient, type DailyClose } from "../src/services/angelone.js";
import { createIndicatorService, lastTwo, netAdvances, refreshAutoIndicators, withLive } from "../src/services/auto-indicators.js";
import { findTokens, parseConstituents } from "../src/services/nifty50.js";
import { getPublicSentiment } from "../src/services/alerts.js";
import { decryptSecret, getAngelOneSettings } from "../src/services/settings.js";
import { INDICATOR_IDS, ema, indicatorSeries, macdHistogram, rateOfChange, rsi, scoreChange, supertrend } from "../src/shared/indicators.js";

describe("the scoring rule (today vs the previous close)", () => {
  test("RSI 50 -> 40 is -1, a rise of 11 is +1, no change is 0", () => {
    assert.equal(scoreChange(50, 40, 0, true), -1);
    assert.equal(scoreChange(50, 61, 0, true), 1);
    assert.equal(scoreChange(50, 50, 0, true), 0);
  });

  test("changes within the threshold score 0", () => {
    assert.equal(scoreChange(50, 50.8, 1, true), 0);
    assert.equal(scoreChange(50, 49, 1, true), 0); // exactly the threshold
    assert.equal(scoreChange(50, 48.9, 1, true), -1);
    assert.equal(scoreChange(1.0, 1.0 + 0.1 + 0.2 - 0.3, 0, true), 0); // float noise is not a move
  });

  test("for fear gauges (higher is bearish) a rise scores -1", () => {
    assert.equal(scoreChange(14, 16, 0.1, false), -1);
    assert.equal(scoreChange(16, 14, 0.1, false), 1);
  });
});

describe("indicator maths", () => {
  test("Supertrend (10, 3) follows an uptrend below the price and flips above it after a sharp fall", () => {
    const n = 40;
    const closes = Array.from({ length: n }, (_, i) => 100 + i);
    const highs = closes.map((c) => c + 1);
    const lows = closes.map((c) => c - 1);
    const st = supertrend(highs, lows, closes, 10, 3);
    assert.ok(Number.isNaN(st.line[8]!), "needs 10 candles of ATR first");
    // the true range here is 2 every day, so the lower band is the midpoint minus 3 x 2
    assert.equal(st.direction[n - 1], 1);
    assert.equal(st.line[n - 1], closes[n - 1]! - 6);
    for (let i = 10; i < n; i++) assert.ok(st.line[i]! >= st.line[i - 1]!, "the lower band never falls in an uptrend");

    const fell = [...closes, 120];
    const down = supertrend([...highs, 140], [...lows, 119], fell, 10, 3);
    assert.equal(down.direction.at(-1), -1);
    assert.ok(down.line.at(-1)! > 120, "the line jumps above the price");
    // the scored value is close minus the line: positive before the flip, negative after
    const series = indicatorSeries("supertrend", { closes: fell, highs: [...highs, 140], lows: [...lows, 119] });
    assert.ok(series.at(-2)! > 0 && series.at(-1)! < 0);
    assert.equal(scoreChange(series.at(-2)!, series.at(-1)!, 10, true), -1);
  });

  test("Advance / decline: advancing minus declining Nifty 50 stocks from NSE's list and Angel One's tokens", () => {
    assert.ok(INDICATOR_IDS.includes("advdec") && INDICATOR_IDS.includes("supertrend"));
    // each stock's price against its previous close; unchanged stocks don't count
    assert.equal(netAdvances([[100, 101], [100, 99], [100, 100.004], [50, 52], [10, 9.5]]), 0);
    assert.equal(netAdvances([[100, 101], [100, 102], [100, 99]]), 1);

    const csv = "Company Name,Industry,Symbol,Series,ISIN Code\r\nMahindra & Mahindra Ltd.,Automobile,M&M,EQ,INE101A01026\r\nReliance Industries Ltd.,Oil Gas,RELIANCE,EQ,INE002A01018\r\n";
    assert.deepEqual(parseConstituents(csv), ["M&M", "RELIANCE"]);
    const master = JSON.stringify([
      { token: "500325", symbol: "RELIANCE", name: "RELIANCE", exch_seg: "BSE" },
      { token: "2885", symbol: "RELIANCE-EQ", name: "RELIANCE", exch_seg: "NSE" },
      { token: "99999", symbol: "M&M-EQ", name: "M&M", exch_seg: "BSE" },
      { token: "2031", symbol: "M&M-EQ", name: "M&M", exch_seg: "NSE" },
    ]);
    assert.deepEqual(findTokens(master, ["M&M", "RELIANCE", "MISSING"]), [
      { symbol: "M&M", token: "2031" },
      { symbol: "RELIANCE", token: "2885" },
    ]);
  });

  // StockCharts' worked RSI example (Wilder's smoothing)
  const closes = [
    44.3389, 44.0902, 44.1497, 43.6124, 44.3278, 44.8264, 45.0955, 45.4245, 45.8433, 46.0826, 45.8931, 46.0328, 45.614, 46.282, 46.282,
    46.0028, 46.0328, 46.4116, 46.2222, 45.6439, 46.2122, 46.2521, 45.7137, 46.4515, 45.7835, 45.3548, 44.0288, 44.1783, 44.2181, 44.5672,
    43.4205, 42.6628, 43.1314,
  ];

  test("RSI (14) matches the published example", () => {
    const r = rsi(closes, 14);
    assert.ok(r.slice(0, 14).every(Number.isNaN));
    const expected = [70.53, 66.32, 66.55, 69.41, 66.36, 57.97, 62.93, 63.26, 56.06, 62.38, 54.71, 50.42, 39.99, 41.46, 41.87, 45.46, 37.3, 33.08, 37.77];
    expected.forEach((v, i) => assert.ok(Math.abs(r[14 + i]! - v) < 0.02, `RSI at ${14 + i}: ${r[14 + i]} vs ${v}`));
  });

  test("EMA is seeded with the simple average, then smoothed", () => {
    const e = ema([1, 2, 3, 4, 5, 6], 3);
    assert.ok(Number.isNaN(e[1]!));
    assert.equal(e[2], 2);
    assert.equal(e[3], 3);
    assert.equal(e[5], 5);
  });

  test("MACD histogram and rate of change line up with their inputs", () => {
    const series = Array.from({ length: 60 }, (_, i) => 100 + i);
    const h = macdHistogram(series);
    assert.equal(h.length, 60);
    assert.ok(Number.isNaN(h[32]!) && Number.isFinite(h[33]!)); // 26 + 9 - 2
    assert.ok(Math.abs(h[59]!) < 0.01); // a steady trend settles to ~0
    const roc = rateOfChange([100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110], 10);
    assert.ok(Math.abs(roc[10]! - 10) < 1e-9);
  });
});

describe("SmartAPI helpers", () => {
  test("TOTP matches the RFC 6238 test codes (SHA-1, 6 digits)", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // "12345678901234567890"
    assert.equal(totpCode(secret, 59_000), "287082");
    assert.equal(totpCode(secret, 1_111_111_109_000), "081804");
    assert.equal(totpCode(secret, 1_234_567_890_000), "005924");
    assert.equal(totpCode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq", 59_000), "287082"); // spaces and case don't matter
    assert.throws(() => totpCode("not-base32!", 0), AngelOneError);
  });

  test("today's live price replaces today's partial candle or is added after the last close", () => {
    const daily: DailyClose[] = [
      { day: "2026-10-28", close: 100 },
      { day: "2026-10-29", close: 101 },
    ];
    assert.deepEqual(withLive(daily, { ltp: 105, day: "2026-10-30" }).map((c) => c.close), [100, 101, 105]);
    assert.deepEqual(withLive(daily, { ltp: 102, day: "2026-10-29" }).map((c) => c.close), [100, 102]);
    assert.deepEqual(withLive(daily, { ltp: 99, day: "2026-10-20" }).map((c) => c.close), [100, 101]); // stale quote
    assert.deepEqual(withLive(daily, undefined).length, 2);
    // today's high and low include the live price (Supertrend uses the day's range)
    const ranged: DailyClose[] = [{ day: "2026-10-30", close: 100, high: 104, low: 98 }];
    assert.deepEqual(withLive(ranged, { ltp: 106, day: "2026-10-30", high: 105, low: 97 }), [{ day: "2026-10-30", close: 106, high: 106, low: 97 }]);
    assert.deepEqual(lastTwo(["a", "b", "c"], [1, Number.NaN, 3]), { prev: 1, prevDay: "a", current: 3, currentDay: "c" });
    assert.equal(lastTwo(["a"], [1]), null);
  });
});

describe("the Angel One client", () => {
  test("waits and tries again when Angel One answers 'exceeding access rate'; quotes carry the previous close", async () => {
    const calls: string[] = [];
    let quoteTries = 0;
    const fakeFetch = (async (url: string) => {
      calls.push(String(url).replace(/^https:\/\/[^/]+/, ""));
      if (String(url).includes("loginByPassword")) return new Response(JSON.stringify({ status: true, data: { jwtToken: "jwt" } }));
      if (++quoteTries === 1) return new Response("Access denied because of exceeding access rate", { status: 403 });
      return new Response(JSON.stringify({ status: true, data: { fetched: [{ symbolToken: "2885", ltp: 1410.5, close: 1400, high: 1415, low: 1398, exchFeedTime: "30-Oct-2026 15:29:59" }] } }));
    }) as typeof fetch;
    const client = createAngelOneClient({ apiKey: "k", clientCode: "A1", pin: "1234", totpSecret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" }, fakeFetch);
    const quotes = await client.quotes(["2885"]);
    assert.deepEqual(quotes, [{ token: "2885", ltp: 1410.5, prevClose: 1400, day: "2026-10-30", high: 1415, low: 1398 }]);
    assert.equal(quoteTries, 2);
    assert.equal(calls.length, 3);
  });
});

// ---------- database ----------
const PORT = 59000 + Math.floor(Math.random() * 900);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "m360x-ind-"));
const ADMIN = { email: "admin@market360x.test", password: "correct-horse-battery" };
const SECRET = "test-secret-test-secret-test-secret-987";
let db: EmbeddedPostgres;
let pool: pg.Pool;

/** 80 trading days of a gentle uptrend, then a sharp fall on the live day. */
function niftyDays(): DailyClose[] {
  const start = Date.UTC(2026, 6, 1);
  return Array.from({ length: 80 }, (_, i) => ({ day: new Date(start + i * 86_400_000).toISOString().slice(0, 10), close: 24_000 + i * 10 + (i % 3) * 5 }));
}

interface Fake extends AngelOneClient {
  liveDay: string;
  niftyLive: number;
  vixLive: number;
  pcr: number;
  vixFails: boolean;
  /** How many of the 50 stocks are up today (the rest are down) */
  advancing: number;
}

/** 50 fake Nifty 50 stocks; on the last daily candle the first 40 rose and the other 10 fell. */
const STOCKS = Array.from({ length: 50 }, (_, i) => ({ symbol: `STOCK${i + 1}`, token: `S${i + 1}` }));
const stockNo = (token: string) => (token.startsWith("S") ? Number(token.slice(1)) : 0);

function fakeClient(): Fake {
  const days = niftyDays();
  const fake: Fake = {
    liveDay: "2026-09-19",
    niftyLive: 23_500,
    vixLive: 16,
    pcr: 1.0,
    vixFails: false,
    advancing: 20,
    async dailyCloses(token) {
      const n = stockNo(token);
      if (n) return days.map((d, i) => ({ day: d.day, close: i === days.length - 1 ? (n <= 40 ? 101 : 99) : 100 }));
      if (token === INDIA_VIX_TOKEN) {
        if (fake.vixFails) throw new AngelOneError("Invalid Token", "AG8001");
        return days.map((d) => ({ day: d.day, close: 14 }));
      }
      return days;
    },
    async quotes(tokens) {
      return tokens.map((t) => {
        const n = stockNo(t);
        if (n) return { token: t, ltp: n <= fake.advancing ? 101 : 99, prevClose: 100, day: fake.liveDay };
        return { token: t, ltp: t === NIFTY_TOKEN ? fake.niftyLive : fake.vixLive, day: fake.liveDay };
      });
    },
    async nifty50() {
      return STOCKS;
    },
    async niftyPcr() {
      return fake.pcr;
    },
  };
  return fake;
}

before(async () => {
  db = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: "postgres", password: "postgres", port: PORT, persistent: false, onLog: () => {} });
  await db.initialise();
  await db.start();
  await db.createDatabase("m360x_ind");
  pool = createPool(`postgres://postgres:postgres@localhost:${PORT}/m360x_ind`, false);
  await runMigrations(pool, () => {});
  await upsertAdmin(pool, ADMIN.email, ADMIN.password);
});

after(async () => {
  await pool?.end();
  await db?.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

const rowsByName = async () =>
  Object.fromEntries(
    (await pool.query<{ name: string; indicator: string | null; signal_value: number; prev_value: number | null; current_value: number | null; auto_error: string | null }>(
      "SELECT name, indicator, signal_value, prev_value, current_value, auto_error FROM nifty_alerts ORDER BY display_order"
    )).rows.map((r) => [r.name, r])
  );

describe("the starter indicators become automatic", () => {
  test("migration 007 converts them (Volume/Support -> India VIX/Nifty close, OI removed) and starts them at 0", async () => {
    const rows = await rowsByName();
    assert.deepEqual(
      Object.values(rows).map((r) => r.indicator),
      ["rsi14", "macd", "ema20", "vix", "close", "roc10", "pcr", "supertrend", "advdec"]
    );
    assert.ok(!("OI Signal" in rows));
    assert.ok(Object.values(rows).every((r) => r.signal_value === 0));
  });
});

describe("refreshing from Angel One", () => {
  test("scores every indicator from today vs the previous close; PCR waits for a second day", async () => {
    const fake = fakeClient();
    const r1 = await refreshAutoIndicators(pool, fake, new Date(), { pacingMs: 0 });
    assert.equal(r1.updated, 8);
    assert.ok(!r1.ok && /second trading day/.test(r1.message));
    const rows = await rowsByName();
    // the live price fell 800 points below the last close: price, trend, momentum and RSI turn bearish
    assert.equal(rows["Nifty Close Signal"]!.signal_value, -1);
    assert.equal(rows["Nifty Close Signal"]!.current_value, 23_500);
    assert.equal(rows["RSI Signal"]!.signal_value, -1);
    assert.equal(rows["Trend Signal"]!.signal_value, -1);
    assert.equal(rows["Momentum Signal"]!.signal_value, -1);
    assert.equal(rows["MACD Signal"]!.signal_value, -1);
    assert.equal(rows["Supertrend Signal"]!.signal_value, -1);
    assert.ok(Number(rows["Supertrend Signal"]!.prev_value) > 0 && Number(rows["Supertrend Signal"]!.current_value) < 0, "the fall flips Supertrend down");
    // VIX rose 14 -> 16, and a rise in fear is bearish
    assert.equal(rows["India VIX Signal"]!.signal_value, -1);
    assert.match(rows["PCR Signal"]!.auto_error ?? "", /second trading day/);
    // advance / decline: the previous session (+30, worked out from the stocks' candles) vs today's 20 up, 30 down (-10)
    assert.equal(rows["Advance Decline Signal"]!.prev_value, 30);
    assert.equal(rows["Advance Decline Signal"]!.current_value, -10);
    assert.equal(rows["Advance Decline Signal"]!.signal_value, -1);

    // next trading day: PCR 1.00 -> 1.10 (+1), price recovers a little but VIX keeps rising
    fake.liveDay = "2026-09-20";
    fake.pcr = 1.1;
    const r2 = await refreshAutoIndicators(pool, fake, new Date(), { pacingMs: 0 });
    assert.ok(r2.ok, r2.message);
    const after2 = await rowsByName();
    assert.equal(after2["PCR Signal"]!.signal_value, 1);
    assert.equal(after2["PCR Signal"]!.prev_value, 1);
    assert.equal(after2["PCR Signal"]!.auto_error, null);
    // the next day's advance / decline is compared with the stored one: -10 -> -10 scores 0
    assert.equal(after2["Advance Decline Signal"]!.prev_value, -10);
    assert.equal(after2["Advance Decline Signal"]!.signal_value, 0);

    // the public sentiment uses the scores: 7 bearish, 1 bullish, 1 neutral
    const s = await getPublicSentiment(pool);
    assert.equal(s.counts.bearish + s.counts.bullish + s.counts.neutral, 9);
    assert.equal(s.sentiment.label, "Bearish");
  });

  test("a failing source marks only its indicators and keeps their last values", async () => {
    const fake = fakeClient();
    fake.liveDay = "2026-09-20";
    fake.vixFails = true;
    const before = (await rowsByName())["India VIX Signal"]!;
    const r = await refreshAutoIndicators(pool, fake, new Date(), { pacingMs: 0 });
    assert.equal(r.ok, false);
    const rows = await rowsByName();
    assert.match(rows["India VIX Signal"]!.auto_error ?? "", /Invalid Token/);
    assert.equal(rows["India VIX Signal"]!.signal_value, before.signal_value);
    assert.equal(rows["RSI Signal"]!.auto_error, null);
  });
});

describe("admin: Angel One settings and the indicators page", () => {
  let app: Express;
  const fake = fakeClient();
  fake.liveDay = "2026-09-21";

  before(() => {
    const config = loadConfig({ NODE_ENV: "test", PORT: "3999", DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_ind`, SESSION_SECRET: SECRET });
    app = createApp(config, pool, { indicators: createIndicatorService(pool, SECRET, () => fake) });
  });

  async function adminAgent() {
    const agent = request.agent(app);
    const login = await agent.get("/admin/login").expect(200);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(login.text)?.[1];
    await agent.post("/admin/login").type("form").send({ _csrf: csrf, email: ADMIN.email, password: ADMIN.password }).expect(303);
    const page = await agent.get("/admin").expect(200);
    return { agent, csrf: /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1]! };
  }

  test("the details are validated, stored encrypted, and needed in full to turn updates on", async () => {
    const { agent, csrf } = await adminAgent();
    const page = await agent.get("/admin/settings").expect(200);
    assert.match(page.text, /id="set-angel-title">Angel One SmartAPI/);
    // Notifications and Angel One API are tabs; the page opens on Notifications
    assert.match(page.text, /role="tablist" aria-label="Settings" data-adm-tabs data-active="tab-mail"/);
    assert.match(page.text, /role="tab" id="tab-angel" aria-controls="panel-angel"/);
    assert.match(page.text, /role="tabpanel" id="panel-angel" aria-labelledby="tab-angel"/);
    assert.match(page.text, /<script src="\/js\/admin-tabs\.js" defer><\/script>/);

    const bad = await agent.post("/admin/settings/angelone").type("form").send({ _csrf: csrf, clientCode: "A1", pin: "12ab", totpSecret: "xyz!" }).expect(400);
    assert.match(bad.text, /4-digit Angel One MPIN/);
    assert.match(bad.text, /text shown under the TOTP QR code/);
    assert.match(bad.text, /data-active="tab-angel"/, "a form with errors reopens on its own tab");

    const partial = await agent.post("/admin/settings/angelone").type("form").send({ _csrf: csrf, enabled: "on", clientCode: "a123456" }).expect(400);
    assert.match(partial.text, /Enter the client code, API key, PIN and TOTP secret/);

    await agent
      .post("/admin/settings/angelone")
      .type("form")
      .send({ _csrf: csrf, enabled: "on", clientCode: "a123456", apiKey: "AbCd1234", pin: "1234", totpSecret: "gezd gnbv gy3t qojq gezd gnbv gy3t qojq" })
      .expect(303);
    const saved = await getAngelOneSettings(pool);
    assert.equal(saved?.clientCode, "A123456");
    assert.equal(saved?.enabled, true);
    const raw = JSON.stringify((await pool.query("SELECT value FROM app_settings WHERE key = 'angelone'")).rows[0]);
    assert.ok(!raw.includes("AbCd1234") && !raw.includes("GEZDGNBV") && !raw.includes('"1234"'), "secrets are not stored in plain text");
    assert.equal(decryptSecret(saved!.totpEncrypted, SECRET), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");

    // blank secret fields keep the saved ones
    await agent.post("/admin/settings/angelone").type("form").send({ _csrf: csrf, enabled: "on", clientCode: "A123456" }).expect(303);
    assert.equal(decryptSecret((await getAngelOneSettings(pool))!.pinEncrypted, SECRET), "1234");

    // "Test connection" logs in (fake client) and reads the Nifty price
    const t = await agent.post("/admin/settings/angelone/test").type("form").send({ _csrf: csrf }).expect(200);
    assert.match(t.text, /Connected to Angel One\. Nifty 50 is at 23,500\.00\./);
  });

  test("the indicators page shows the Source column and Refresh now; changing a threshold re-scores", async () => {
    const { agent, csrf } = await adminAgent();
    const page = await agent.get("/admin/nifty-alerts").expect(200);
    assert.match(page.text, /<th scope="col" class="adm-col-source">Source<\/th>/);
    assert.doesNotMatch(page.text, />Description </, "the table no longer has a Description column");
    assert.match(page.text, /data-refresh/);

    // homepage trend card: "i" button with the active indicators and their values
    const home = await request(app).get("/").expect(200);
    assert.match(home.text, /<button type="button" class="m3x-ind-btn" aria-label="Show the active indicators and their values" aria-expanded="false" aria-controls="m3x-ind-pop" data-ind-btn>/);
    const pop = home.text.slice(home.text.indexOf('id="m3x-ind-pop"'), home.text.indexOf("m3x-ind-key"));
    assert.match(pop, /<li class="is-bearish"><strong>Nifty Close Signal<\/strong><b>−1<\/b><\/li>/);
    assert.equal((pop.match(/<li class="is-/g) ?? []).length, 9);
    assert.match(page.text, /<script type="application\/json" id="adm-indicators">\[\{"id":"rsi14"/);

    const refreshed = await agent.post("/api/admin/nifty-alerts/refresh").set("X-CSRF-Token", csrf).expect(200);
    assert.ok(refreshed.body.result.updated >= 6);
    const close = (refreshed.body.alerts as Array<{ id: number; name: string; indicator: string; signalValue: number; prevValue: number; currentValue: number }>).find((a) => a.name === "Nifty Close Signal")!;
    assert.equal(close.signalValue, -1);
    assert.equal(close.currentValue, 23_500);

    // a threshold larger than the move turns the score to 0 without fetching again
    const alerts = refreshed.body.alerts.map((a: Record<string, unknown>) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      signalValue: a.signalValue,
      enabled: a.enabled,
      indicator: a.indicator,
      higherIsBullish: a.higherIsBullish,
      threshold: a.name === "Nifty Close Signal" ? 5000 : a.threshold,
    }));
    const saved = await agent.put("/api/admin/nifty-alerts").set("X-CSRF-Token", csrf).send({ alerts }).expect(200);
    const after = saved.body.alerts.find((a: { name: string }) => a.name === "Nifty Close Signal");
    assert.equal(after.threshold, 5000);
    assert.equal(after.signalValue, 0);
    assert.equal(after.currentValue, 23_500, "values are kept");

    // an unknown indicator is rejected
    const bad = await agent
      .put("/api/admin/nifty-alerts")
      .set("X-CSRF-Token", csrf)
      .send({ alerts: [{ name: "X", description: "", signalValue: 0, enabled: true, indicator: "nope", higherIsBullish: true, threshold: 0 }] })
      .expect(400);
    assert.match(bad.body.error, /Choose an indicator from the list/);
    assert.match(page.text, /"id":"advdec","label":"Advance \/ decline \(Nifty 50\)","source":"breadth"/);

    // switching a row to entered-by-hand uses the typed value again
    const manual = alerts.map((a: Record<string, unknown>) => (a.name === "PCR Signal" ? { ...a, indicator: null, signalValue: 2, threshold: 0 } : a));
    const m = await agent.put("/api/admin/nifty-alerts").set("X-CSRF-Token", csrf).send({ alerts: manual }).expect(200);
    const pcr = m.body.alerts.find((a: { name: string }) => a.name === "PCR Signal");
    assert.equal(pcr.indicator, null);
    assert.equal(pcr.signalValue, 2);
  });
});
