// Header index strip (market quotes) and the Contact page + admin inbox, against a real PostgreSQL.
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
import { INDICES, createYahooMarketQuotes, parseChart, type IndexQuotes, type MarketQuotes } from "../src/services/market-quotes.js";
import type { MarketHistory } from "../src/services/market-history.js";
import { LEGAL_PAGES } from "../src/site/legal.js";

const PORT = 57000 + Math.floor(Math.random() * 1000);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "m360x-mc-"));
const ADMIN = { email: "admin@market360x.test", password: "correct-horse-battery" };

// 16 Oct 2026, 15:31 IST (just after the close) in unix seconds, and a day earlier.
const T = Date.UTC(2026, 9, 16, 10, 1) / 1000;
const DAY = 86400;
const chart = (price: number, closes: Array<number | null>, chartPreviousClose: number, time = T) => ({
  chart: {
    result: [
      {
        meta: {
          regularMarketPrice: price,
          regularMarketTime: time,
          chartPreviousClose,
          currentTradingPeriod: { regular: { start: T - 6.25 * 3600, end: T - 60 } },
        },
        timestamp: closes.map((_, i) => T - (closes.length - 1 - i) * DAY - 6 * 3600),
        indicators: { quote: [{ close: closes }] },
      },
    ],
  },
});

const SAMPLE: IndexQuotes = {
  indices: [
    { id: "nifty", label: "NIFTY", exchange: "NSE", price: 23146.15, change: 148.8, changePercent: 0.65, direction: "up", time: new Date(T * 1000).toISOString() },
    { id: "bankex", label: "BANKEX", exchange: "BSE", price: 62769.43, change: -129.83, changePercent: -0.21, direction: "down", time: new Date(T * 1000).toISOString() },
  ],
  marketOpen: true,
  fetchedAt: new Date(T * 1000).toISOString(),
  stale: false,
  source: "Yahoo Finance",
};
const stubQuotes: MarketQuotes = { get: async () => SAMPLE, peek: () => SAMPLE };
// index chart: NIFTY has history, everything else is "unavailable"
const stubHistory: MarketHistory = {
  get: async (id, range) =>
    id === "nifty"
      ? { id, label: "NIFTY", exchange: "NSE", range, points: [[T - 600, 23100], [T, 23146.15]], price: 23146.15, baseline: 22997.35, change: 148.8, changePercent: 0.65, direction: "up", marketOpen: true, fetchedAt: new Date(T * 1000).toISOString() }
      : null,
};

let db: EmbeddedPostgres;
let pool: pg.Pool;
let app: Express;

before(async () => {
  db = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: "postgres", password: "postgres", port: PORT, persistent: false, onLog: () => {} });
  await db.initialise();
  await db.start();
  await db.createDatabase("m360x_mc");
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3999",
    DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_mc`,
    SESSION_SECRET: "test-secret-test-secret-test-secret-789",
  });
  pool = createPool(config.DATABASE_URL, false);
  await runMigrations(pool, () => {});
  await upsertAdmin(pool, ADMIN.email, ADMIN.password);
  app = createApp(config, pool, { marketQuotes: stubQuotes, marketHistory: stubHistory });
});

after(async () => {
  await pool?.end();
  await db?.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("market quotes", () => {
  const nifty = INDICES[0]!;

  test("change is measured from the previous day's close, not a stale previousClose", () => {
    // Yahoo's chartPreviousClose (22622.70) is two days old; the daily bars hold the real one (22997.35).
    const parsed = parseChart(nifty, chart(23146.15, [22622.7, 22997.35, 23146.15], 22622.7), T + 60);
    assert.ok(parsed);
    assert.equal(parsed.quote.change, 148.8);
    assert.equal(parsed.quote.changePercent, 0.65);
    assert.equal(parsed.quote.direction, "up");
    assert.equal(parsed.open, false); // after the close
  });

  test("falls back to chartPreviousClose when there is only today's bar", () => {
    const parsed = parseChart(INDICES[4]!, chart(62769.43, [62769.43], 62899.26), T - 3600);
    assert.equal(parsed?.quote.change, -129.83);
    assert.equal(parsed?.quote.direction, "down");
    assert.equal(parsed?.open, true); // during market hours
  });

  test("rejects malformed responses", () => {
    assert.equal(parseChart(nifty, {}, T), null);
    assert.equal(parseChart(nifty, { chart: { result: [{ meta: { regularMarketPrice: "x" } }] } }, T), null);
  });

  test("caches for a minute and keeps the last good numbers when the source fails", async () => {
    let calls = 0;
    let fail = false;
    let clock = T * 1000;
    const quotes = createYahooMarketQuotes({
      now: () => clock,
      fetchImpl: async () => {
        calls++;
        if (fail) throw new Error("network down");
        return { ok: true, status: 200, json: async () => chart(23146.15, [22997.35, 23146.15], 22622.7) };
      },
    });
    const first = await quotes.get();
    assert.equal(first?.indices.length, INDICES.length);
    assert.equal(calls, INDICES.length);
    await quotes.get();
    assert.equal(calls, INDICES.length, "second call within a minute is served from cache");

    fail = true;
    clock += 61_000;
    const stale = await quotes.get();
    assert.equal(stale?.stale, true);
    assert.equal(stale?.indices[0]?.price, 23146.15);
  });
});

describe("header strip and menu", () => {
  test("pages render the index strip from cached quotes", async () => {
    const res = await request(app).get("/about").expect(200);
    assert.match(res.text, /data-ticker/);
    assert.match(res.text, /<span class="m3x-tick-name">NIFTY<\/span><span class="m3x-tick-price">23,146\.15<\/span><span class="m3x-tick-chg">▲ \+148\.80 \(\+0\.65%\)<\/span>/);
    assert.match(res.text, /class="m3x-tick is-down" data-tick="bankex"/);
    assert.match(res.text, /−129\.83 \(−0\.21%\)/);
    assert.match(res.text, /\/js\/ticker\.js/);
  });

  test("every page has the dark/light toggle and loads the theme script before paint", async () => {
    for (const route of ["/", "/about", "/contact", "/checkout?plan=weekly"]) {
      const res = await request(app).get(route).expect(200);
      const head = res.text.slice(0, res.text.indexOf("</head>"));
      assert.match(head, /<script src="\/js\/theme\.js"><\/script>/, route);
      assert.match(res.text, /<button type="button" class="m3x-theme-btn" data-theme-toggle aria-pressed="false" aria-label="Switch to dark mode"/, route);
    }
  });

  test("every page has the search pill (desktop) and search field (mobile menu)", async () => {
    for (const route of ["/", "/about", "/contact", "/privacy-policy"]) {
      const res = await request(app).get(route).expect(200);
      for (const id of ["m3x-search-head", "m3x-search-menu"]) {
        assert.match(res.text, new RegExp(`<input id="${id}" type="search"[^>]*role="combobox"[^>]*aria-controls="${id}-list"`), `${route} ${id}`);
        assert.match(res.text, new RegExp(`<ul id="${id}-list" class="m3x-search-list" role="listbox"`), `${route} ${id} list`);
      }
      assert.match(res.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/js\/search\.js/, route);
    }
  });

  test("the homepage (the former /home-v4 design) has the video hero, Vision / Mission tabs and closing CTA", async () => {
    const v4 = await request(app).get("/").expect(200);
    assert.match(v4.text, /<body class="m3x-home m3x-home-v4">/);
    assert.match(v4.text, /<section class="m3x-hero4"/);
    assert.match(v4.text, /<meta name="robots" content="index, follow"/);
    assert.match(v4.text, /<button type="button" class="m3x-vm-tab" role="tab" id="m3x-vm-tab-vision" aria-controls="m3x-vm-vision" aria-selected="true">/);
    assert.match(v4.text, /<div class="m3x-vm-panel is-inactive" role="tabpanel" id="m3x-vm-mission"/);
    // just the two About-page paragraphs and a "Read more about us" button
    assert.match(v4.text, /make financial market information accessible, understandable and actionable/);
    assert.doesNotMatch(v4.text, /m3x-vm-objectives|m3x-vm-list|Reduce avoidable trading losses/);
    assert.match(v4.text, /<a href="\/about" class="m3x-vm-more">Read more about us/);
    assert.match(v4.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/js\/tabs\.js/);
    assert.doesNotMatch(v4.text, /Signal over noise/);
    // closing CTA just before the footer
    const cta = v4.text.indexOf('class="m3x-sec m3x-pt-0 m3x-cta4"');
    assert.ok(cta > 0 && cta < v4.text.indexOf("<footer"));
    assert.match(v4.text, /<h2 id="m3x-cta4-title" class="m3x-cta4-title">See the alerts What Millionaire sees<\/h2>/);
    assert.match(v4.text, /<a href="\/nifty-alert" class="m3x-cta4-btn is-primary">Try Now/);
    assert.match(v4.text, /<a href="\/features" class="m3x-cta4-btn is-ghost">Explore Features<\/a>/);
    // Indian markets only: the US stocks and crypto pages are gone
    for (const old of ["/stocks", "/crypto"]) assert.equal((await request(app).get(old).expect(301)).headers.location, "/");
    assert.doesNotMatch(v4.text, /GIFT Nifty|US markets|USD\/INR|Fed decisions/);
    // the retired design previews and the original hero are gone
    assert.doesNotMatch(v4.text, /m3x-hero2|m3x-hero3|laser-flow|m3x-hero-shot/);
    for (const old of ["/home-v2", "/home-v3", "/home-v4"]) assert.equal((await request(app).get(old).expect(301)).headers.location, "/");
  });

  test("'One alert service' is a scroll showcase of the three dashboard screens (no carousel)", async () => {
    const res = await request(app).get("/").expect(200);
    assert.doesNotMatch(res.text, /m3x-shots-track/);
    assert.match(res.text, /<section class="[^"]*m3x-showcase"[^>]*data-showcase/);
    // section title on one line above the slides; the left shows one screenshot name at a time (no numbers, bars or button)
    assert.match(res.text, /<h2\s+id="m3x-showcase-title"\s+class="m3x-sc-heading[^"]*"\s*>\s*One alert service\. <span class="text-mint">Every market you trade\.<\/span>/);
    assert.equal(res.text.match(/data-showcase-title/g)?.length, 3);
    for (const name of ["Dragger-Puller", "Alert Engine", "Interactive Candlestick Chart"]) {
      assert.match(res.text, new RegExp(`<p class="m3x-sc-title[^"]*" data-showcase-title aria-hidden="true">${name}</p>`), name);
      assert.match(res.text, new RegExp(`<figcaption><span>${name}</span><svg class="m3x-icon lucide-arrow-right`), name);
    }
    const start = res.text.indexOf("data-showcase");
    const section = res.text.slice(start, res.text.indexOf("</section>", start));
    assert.doesNotMatch(section, /m3x-sc-num|m3x-sc-bar|Explore the platform/);
    assert.equal(res.text.match(/data-showcase-slide/g)?.length, 3);
    assert.match(res.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/js\/showcase\.js/);
  });

  test("homepage Markets section: chart for the six Options Alert indices with Today/1W/1M/1Y", async () => {
    const res = await request(app).get("/").expect(200);
    assert.match(res.text, /<section id="markets"[^>]*aria-labelledby="m3x-markets-title"/);
    for (const r of ["1d", "1w", "1m", "1y"]) assert.match(res.text, new RegExp(`data-ic-range="${r}"`), r);
    for (const id of ["nifty", "sensex", "banknifty", "finnifty", "bankex", "midcpnifty"]) assert.match(res.text, new RegExp(`data-ic-index="${id}"`), id);
    // picker shows today's figures from the header quotes; Nifty is the one with live alerts
    assert.match(res.text, /data-ic-index="nifty"[^>]*aria-pressed="true">\s*<span class="m3x-ic-pick-name">Nifty<em class="is-live">Alerts live<\/em>/);
    assert.match(res.text, /<span class="m3x-ic-pick-px" data-ic-pick-price>23,146\.15<\/span>/);
    assert.match(res.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/js\/index-chart\.js/);
    // it comes right after the "One alert service" showcase
    assert.ok(res.text.indexOf('id="markets"') > res.text.indexOf("data-showcase-track"));
  });

  test("the chart API validates input and serves cached history", async () => {
    const ok = await request(app).get("/api/market/history?index=nifty&range=1w").expect(200);
    assert.equal(ok.body.range, "1w");
    assert.equal(ok.body.points.length, 2);
    assert.match(ok.headers["cache-control"] ?? "", /max-age=300/);
    const today = await request(app).get("/api/market/history?index=nifty&range=1d").expect(200);
    assert.match(today.headers["cache-control"] ?? "", /max-age=30/);
    await request(app).get("/api/market/history?index=sensex&range=1d").expect(503);
    await request(app).get("/api/market/history?index=../etc&range=1d").expect(400);
    await request(app).get("/api/market/history?index=nifty&range=5y").expect(400);
  });

  test("inner marketing pages follow the homepage rules (m3x-inner): headers, FAQ layout, closing CTA band", async () => {
    for (const route of ["/about", "/features", "/nifty-alert", "/options", "/algo", "/contact", "/privacy-policy"]) {
      const res = await request(app).get(route).expect(200);
      assert.match(res.text, /<body class="[^"]*\bm3x-inner\b/, route);
    }
    for (const route of ["/about", "/features", "/nifty-alert", "/options", "/algo"]) {
      const res = await request(app).get(route).expect(200);
      const cta = res.text.indexOf('class="m3x-sec m3x-pt-0 m3x-cta4"');
      assert.ok(cta > 0 && cta < res.text.indexOf("<footer"), `${route} CTA band before the footer`);
      assert.doesNotMatch(res.text, /trade-close/, route);
    }
    // About has no FAQ or "Why traders choose" section any more
    const about = await request(app).get("/about").expect(200);
    assert.doesNotMatch(about.text, /m3x-faq-layout|Why traders choose|We&#39;ve got answers|We've got answers/);
    for (const route of ["/nifty-alert"]) {
      const res = await request(app).get(route).expect(200);
      assert.match(res.text, /<div class="m3x-faq-layout text-center">/, route);
      assert.match(res.text, /<span class="text-mint m3x-line">We've got answers\.<\/span>/, route);
    }
    const algo = await request(app).get("/algo").expect(200);
    assert.match(algo.text, /ctaTitle|Bring more structure to every decision\./);
    assert.doesNotMatch(algo.text, /\bAI\b/);
    // checkout keeps its own layout; the homepage keeps m3x-home
    assert.doesNotMatch((await request(app).get("/checkout?plan=weekly").expect(200)).text, /<body class="[^"]*m3x-inner/);
    assert.match((await request(app).get("/").expect(200)).text, /<body class="m3x-home m3x-home-v4">/);
  });

  test("homepage cards show a real terminal session: Alert Engine log and the chart with alerts marked", async () => {
    const res = await request(app).get("/").expect(200);
    assert.match(res.text, /<div class="m3x-tlog" data-terminal-log/);
    const json = res.text.match(/<script type="application\/json" data-tlog-data>([^<]+)<\/script>/)?.[1];
    const alerts = JSON.parse(json ?? "[]") as Array<{ kind: string }>;
    assert.ok(alerts.length > 10);
    for (const kind of ["ENTRY", "RE_ENTRY", "REVERSAL", "EXIT"]) assert.ok(alerts.some((a) => a.kind === kind), kind);
    assert.match(res.text, /<figure class="m3x-tchart" data-terminal-chart/);
    // kept simple: plain labels and alert dots, no terminal codes or rule details
    assert.match(res.text, /class="m3x-tchart-dot is-up" style="left: /);
    assert.match(res.text, /<span class="m3x-tlog-kind">(New alert|Re-entry|Reversal|Exit)<\/span><span class="m3x-tlog-text">Nifty<\/span>/);
    assert.doesNotMatch(res.text, /OI\(M\)|Δ OI since open|threshold/);
    assert.match(res.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/js\/terminal-cards\.js/);
    assert.doesNotMatch(res.text, /Buy Call|Buy Put|Nifty breaks 23,050/);
  });

  test("alerts only: no entry, target, stop-loss or buy/sell calls on any page", async () => {
    const routes = ["/", "/about", "/features", "/nifty-alert", "/options", "/algo", "/terms-and-conditions", "/risk-disclosure"];
    for (const route of routes) {
      const res = await request(app).get(route).expect(200);
      const text = res.text.replace(/Alerts do not include entry, target or stop-loss levels/g, "");
      assert.doesNotMatch(text, /entry, target|stop-loss and|with a stop-loss|BUY NIFTY|Entry ₹|SL ₹|risk-to-reward|trade ideas?\b/i, route);
    }
  });

  test("Features follows the homepage: the same alert cards and the terminal screens", async () => {
    const res = await request(app).get("/features").expect(200);
    // the homepage's alert feed and alert chart (real terminal session), animated by the same script
    assert.match(res.text, /<div class="m3x-tlog" data-terminal-log/);
    assert.match(res.text, /<figure class="m3x-tchart" data-terminal-chart/);
    assert.match(res.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/js\/terminal-cards\.js/);
    // the three screens the homepage showcases
    for (const name of ["Dragger-Puller", "Alert Engine", "Interactive Candlestick Chart"]) {
      assert.match(res.text, new RegExp(`<h3 class="m3x-screen-name">${name}</h3>`), name);
    }
    // the broker / option chain cards and the "market at a glance" section were removed
    for (const title of ["Market direction of the day", "Live index prices", "Index charts", "Trade With Your Own Broker", "Option Chain &amp; OI Flow", "at a glance, every day"]) {
      assert.ok(!res.text.includes(title), title);
    }
    // demo numbers and tools the platform doesn't have are gone
    assert.doesNotMatch(res.text, /Put writing at 23,000|PCR at 1\.31|Signal strength \+64%|Unusual volume in Nifty futures|pre-market brief|Economic calendar/);
  });

  test("performance: compressed CSS, self-hosted fonts, scripts loaded after the first paint", async () => {
    const css = await request(app).get("/assets/main.css").set("Accept-Encoding", "gzip").expect(200);
    assert.equal(css.headers["content-encoding"], "gzip");
    const res = await request(app).get("/").expect(200);
    assert.doesNotMatch(res.text, /fonts\.googleapis\.com|fonts\.gstatic\.com/);
    assert.match(res.text, /<link rel="preload" href="\/fonts\/gf\/manrope-300-800-latin\.woff2" as="font" type="font\/woff2" crossorigin \/>/);
    assert.match(res.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/vendor\/gsap\.min\.js[^"]*\/assets\/main\.js/);
    // three.js (only for the retired laser hero) is gone; number-flow loads on demand
    assert.doesNotMatch(res.text, /three\.min\.js|number-flow\.min\.js|<script src="\/assets\/main\.js"/);
  });

  test("the API serves the quotes", async () => {
    const res = await request(app).get("/api/market/indices").expect(200);
    assert.equal(res.body.indices[0].label, "NIFTY");
    assert.match(res.headers["cache-control"] ?? "", /max-age=30/);
  });

  test("Options Alert lists the six index alerts; Contact is in the footer, not the header menu", async () => {
    const res = await request(app).get("/").expect(200);
    assert.match(res.text, /<a href="\/nifty-alert"[^>]*>Nifty Option Alert<\/a>/);
    for (const label of ["Sensex", "Bank Nifty", "Fin Nifty", "Bankex", "Midcap Nifty"]) {
      assert.match(res.text, new RegExp(`${label} Option Alert<em>Soon</em>`));
    }
    assert.doesNotMatch(res.text, /<a href="\/contact" class="flex items-center gap-1\.5"/);
    assert.doesNotMatch(res.text, /<span class="m3x-msb-label">Contact us<\/span>/);
    // "Try now" (desktop header and mobile menu) opens the Nifty Option Alert page
    assert.match(res.text, /<a href="\/nifty-alert" class="magnetic-button[^"]*">[\s\S]*?Try now/);
    assert.match(res.text, /<a href="\/nifty-alert" class="m3x-msb-cta">Try now/);
    // Market360X Club has no page yet: it links to the homepage for now (desktop menu and mobile menu).
    assert.match(res.text, /<a href="\/" class="flex items-center gap-1\.5" aria-haspopup="true">\s*<span[^>]*>Market360X Club<\/span>/);
    assert.match(res.text, /<span class="m3x-msb-label">Market360X Club<\/span>/);
    // Desktop mega menu: four numbered, illustrated steps; the mobile menu lists the step names only.
    const mega = res.text.slice(res.text.indexOf('<div class="m3x-mega"'), res.text.indexOf("</ol>", res.text.indexOf('<div class="m3x-mega"')));
    const steps = ["Connect", "Learn", "Analyse", "Grow Together"];
    steps.forEach((title, i) => {
      assert.ok(mega.includes(`<p class="m3x-mega-num">0${i + 1}</p>`) && mega.includes(`<p class="m3x-mega-step-title">${title}</p>`), title);
      assert.ok(res.text.includes(`<li class="m3x-msb-sublink"><span><b>0${i + 1}</b>${title}</span></li>`), `mobile ${title}`);
    });
    for (const img of ["connect", "learn", "analyze", "grow"]) {
      assert.ok(mega.includes(`src="/images/club/${img}.webp"`), img);
      await request(app).get(`/images/club/${img}.webp`).expect(200);
    }
  });
});

describe("about page", () => {
  test("shows the vision, three objectives, mission, commitment and the SEBI disclaimer", async () => {
    const res = await request(app).get("/about").expect(200);
    for (const text of [
      "Reduce Retail Trading Losses",
      "Capital Protection First, Profits Will Follow",
      "Win by Data, Not by Guesswork",
      "Analyse with Data",
      "Our mission is to help retail traders:",
      "Better Risk Management",
      "Reduce Losses.",
      "Disclaimer – SEBI Non-Registration",
      "The stated loss-reduction target is aspirational and not an assured or demonstrated result.",
    ]) {
      assert.ok(res.text.includes(text), text);
    }
    // the 90% -> 80% ambition points to the disclaimer
    assert.match(res.text, /<strong>90% to 80%<\/strong><a class="m3x-objective-note" href="#m3x-motive-disclaimer"/);
    assert.match(res.text, /id="m3x-motive-disclaimer"/);
  });
});

describe("markets covered", () => {
  test("no page mentions forex and the old forex page is gone", async () => {
    const routes = ["/", "/about", "/features", "/nifty-alert", "/options", "/algo", "/contact", "/checkout?plan=monthly", ...LEGAL_PAGES.map((p) => p.route)];
    for (const route of routes) {
      const res = await request(app).get(route).expect(200);
      assert.doesNotMatch(res.text, /forex/i, route);
    }
    await request(app).get("/forex").expect(404);
    await request(app).get("/forex.html").expect(404);
  });
});

describe("legal policy pages", () => {
  test("each policy has its own page with a table of contents", async () => {
    assert.equal(LEGAL_PAGES.length, 5);
    for (const page of LEGAL_PAGES) {
      const res = await request(app).get(page.route).expect(200);
      assert.ok(res.text.includes(`<h1 id="m3x-legal-title" class="m3x-acct-title">${page.heading.replace("&", "&amp;")}</h1>`), page.key);
      for (const s of page.sections) {
        assert.ok(res.text.includes(`href="#${s.id}"`) && res.text.includes(`id="${s.id}"`), `${page.key}#${s.id}`);
      }
      assert.doesNotMatch(res.text, /min read|Other policies/);
    }
  });

  test("the SEBI non-registration disclaimer is on the risk and terms pages and in the footer", async () => {
    const statement = "We are not registered with SEBI as an Investment Adviser or Research Analyst.";
    for (const route of ["/risk-disclosure", "/terms-and-conditions", "/"]) {
      const res = await request(app).get(route).expect(200);
      assert.ok(res.text.includes(statement), route);
    }
    const risk = await request(app).get("/risk-disclosure").expect(200);
    assert.match(risk.text, /<strong>9 out of 10<\/strong> individual F&amp;O traders incurred net losses/);
    assert.match(risk.text, /Source: SEBI study on individual F&amp;O traders/);
    assert.match(risk.text, /Beware of investment fraud\./);
    assert.match(risk.text, />Risk disclosure: Futures &amp; Options \(F&amp;O\)</, "headings are escaped once, not twice");
  });

  test("the footer links the Market360X social profiles in a new tab", async () => {
    const res = await request(app).get("/").expect(200);
    const footer = res.text.slice(res.text.indexOf("<footer"));
    for (const url of [
      "https://www.facebook.com/profile.php?id=61595339317426",
      "https://www.instagram.com/market360xofficial/",
      "https://x.com/market360_x",
      "https://www.linkedin.com/company/144001875/",
      "https://www.youtube.com/@market360x",
    ]) {
      assert.ok(footer.includes(`<a href="${url}" target="_blank" rel="noopener noreferrer"`), url);
    }
    assert.doesNotMatch(footer, /href="#"/);
  });

  test("the footer links every policy", async () => {
    const res = await request(app).get("/").expect(200);
    const footer = res.text.slice(res.text.indexOf("<footer"));
    for (const page of LEGAL_PAGES) assert.ok(footer.includes(`href="${page.route}"`), page.route);
    assert.doesNotMatch(footer, /href="#"[^>]*>\s*(Terms|Privacy|Refund|GDPR|Risk|Cookie)/);
  });
});

describe("contact page", () => {
  test("'Still have questions?' buttons lead here and the old template pages are gone", async () => {
    for (const route of ["/", "/nifty-alert"]) {
      const res = await request(app).get(route).expect(200);
      assert.match(res.text, /<a href="\/contact" class="magnetic-button[^"]*">[\s\S]{0,400}Still have questions\?/, route);
      assert.doesNotMatch(res.text, /\/extras\//, route);
    }
    await request(app).get("/extras/faq.htm").expect(404);
  });

  async function contactForm() {
    const agent = request.agent(app);
    const page = await agent.get("/contact").expect(200);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
    assert.ok(csrf);
    return { agent, csrf, page };
  }
  const valid = { name: "Neha Gupta", email: "Neha@Example.com", phone: "98765 43210", topic: "plans", message: "Do you send alerts on WhatsApp as well?" };

  test("the footer lists the same option alerts as the header dropdown", async () => {
    const res = await request(app).get("/about").expect(200);
    const footer = res.text.slice(res.text.indexOf("<footer"));
    assert.match(footer, />Options Alert<\/p>/);
    assert.match(footer, /<a href="\/nifty-alert"[^>]*>Nifty Option Alert<\/a>/);
    for (const label of ["Sensex", "Bank Nifty", "Fin Nifty", "Bankex", "Midcap Nifty"]) {
      assert.match(footer, new RegExp(`<span class="m3x-foot-soon[^"]*" aria-disabled="true">${label} Option Alert<em>Soon</em></span>`));
    }
    assert.doesNotMatch(footer, />Products<|Crypto Trading/);
  });

  test("shows the Market360X contact details on the page and in the footer", async () => {
    const res = await request(app).get("/contact").expect(200);
    assert.match(res.text, />Contact us</);
    for (const text of ["contact@market360x.com", "+91 92113 84013", "423, Tower-B, Logix Techno Park, Sector-127, Noida, Delhi NCR - 201313"]) {
      assert.ok(res.text.split(text).length >= 3, text + " on the page and in the footer");
    }
    assert.match(res.text, /href="tel:\+919211384013"/);
    for (const old of ["hello@market360x.com", "555-0130", "Gould Street", ">FAQ<", ">Support<"]) assert.ok(!res.text.includes(old), old);
  });

  test("shows the form and pre-fills a plan activation request from checkout", async () => {
    const { page } = await contactForm();
    assert.match(page.text, /Talk to the Market360X team/);
    const fromCheckout = await request(app).get("/contact?topic=activate&plan=monthly").expect(200);
    assert.match(fromCheckout.text, /<option value="activate" selected>/);
    assert.match(fromCheckout.text, /activate the Monthly plan/);
  });

  test("validates fields and keeps what was typed", async () => {
    const { agent, csrf } = await contactForm();
    const res = await agent.post("/contact").type("form").send({ _csrf: csrf, name: "N", email: "bad", phone: "12", topic: "", message: "hi" }).expect(400);
    for (const msg of ["Enter your full name", "Enter a valid email address", "Enter a valid mobile number", "Choose what your message is about", "Write at least 10 characters"]) {
      assert.match(res.text, new RegExp(msg));
    }
    assert.match(res.text, /value="bad"/);
  });

  test("requires the CSRF token", async () => {
    const { agent } = await contactForm();
    await agent.post("/contact").type("form").send(valid).expect(403);
  });

  test("saves the message and confirms once", async () => {
    const { agent, csrf } = await contactForm();
    await agent.post("/contact").type("form").send({ _csrf: csrf, ...valid }).expect(303).expect("Location", "/contact");
    const page = await agent.get("/contact").expect(200);
    assert.match(page.text, /Thanks! Your message has been sent\. We&#39;ll reply to neha@example\.com\./);
    const { rows } = await pool.query("SELECT name, email, phone, topic, status FROM contact_messages");
    assert.deepEqual(rows, [{ name: "Neha Gupta", email: "neha@example.com", phone: "9876543210", topic: "plans", status: "new" }]);
  });

  test("bots that fill the hidden field are ignored", async () => {
    const { agent, csrf } = await contactForm();
    await agent.post("/contact").type("form").send({ _csrf: csrf, ...valid, website: "http://spam.example" }).expect(303);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM contact_messages");
    assert.equal(rows[0].n, 1);
  });
});

describe("admin messages inbox", () => {
  async function adminAgent() {
    const agent = request.agent(app);
    const login = await agent.get("/admin/login").expect(200);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(login.text)?.[1];
    await agent.post("/admin/login").type("form").send({ _csrf: csrf, email: ADMIN.email, password: ADMIN.password }).expect(303);
    const page = await agent.get("/admin/messages").expect(200);
    return { agent, page, csrf: /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1]! };
  }

  test("needs an admin login", async () => {
    const res = await request(app).get("/admin/messages").expect(302);
    assert.match(res.headers.location ?? "", /\/admin\/login/);
    await request(app).post("/admin/messages/1/delete").type("form").send({}).expect(302);
  });

  test("lists messages, marks them handled and deletes them", async () => {
    const { agent, page, csrf } = await adminAgent();
    assert.match(page.text, /Neha Gupta/);
    assert.match(page.text, /Do you send alerts on WhatsApp as well\?/);
    assert.match(page.text, /1 new/);
    const { rows } = await pool.query<{ id: string }>("SELECT id FROM contact_messages");
    const id = rows[0]!.id;

    await agent.post(`/admin/messages/${id}/status`).type("form").send({ _csrf: csrf, status: "handled" }).expect(303);
    assert.match((await agent.get("/admin/messages")).text, /0 new/);
    await agent.post(`/admin/messages/${id}/status`).type("form").send({ _csrf: csrf, status: "bogus" }).expect(400);
    await agent.post(`/admin/messages/${id}/delete`).type("form").send({}).expect(403);
    await agent.post(`/admin/messages/${id}/delete`).type("form").send({ _csrf: csrf }).expect(303);
    assert.match((await agent.get("/admin/messages")).text, /No messages yet/);
  });
});
