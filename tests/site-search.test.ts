import assert from "node:assert/strict";
import { test } from "node:test";
import { SEARCH_PAGES, searchPages } from "../src/shared/site-search.js";
import { LEGAL_PAGES } from "../src/site/legal.js";
import { NAV_ITEMS } from "../src/site/pages.js";

const titles = (q: string) => searchPages(q).map((p) => p.title);

test("finds pages by title, best match first", () => {
  assert.equal(titles("nifty")[0], "Nifty Option Alert");
  assert.equal(titles("about")[0], "About Us");
  assert.equal(titles("refund")[0], "Refund Policy");
  assert.deepEqual(titles("polic").slice(0, 2), ["Privacy Policy", "Refund Policy"]);
});

test("matches keywords and summaries, ignoring case, punctuation and &", () => {
  assert.equal(titles("PRICE")[0], "Pricing");
  assert.equal(titles("bullish")[0], "Market Direction of the Day");
  assert.equal(titles("support")[0], "Contact Us");
  assert.equal(titles("terms & conditions")[0], "Terms & Conditions");
  assert.equal(titles("sebi")[0], "Risk Disclosure");
});

test("every word must match; empty or unmatched queries return nothing", () => {
  assert.deepEqual(titles("refund privacy"), []);
  assert.deepEqual(titles("   "), []);
  assert.deepEqual(titles("forex"), []);
});

test("launched pages rank above 'Soon' ones and the result list is capped", () => {
  const sensex = searchPages("sensex");
  assert.equal(sensex[0]?.title, "Sensex Option Alert");
  assert.equal(sensex[0]?.soon, true);
  const alerts = searchPages("option alert");
  assert.deepEqual(alerts.slice(0, 2).map((p) => p.title).sort(), ["Nifty Option Alert", "Options Alert"]);
  assert.ok(alerts.length <= 6);
});

test("the index covers every menu page and legal page", () => {
  const hrefs = new Set(SEARCH_PAGES.map((p) => p.href));
  for (const item of NAV_ITEMS) if (item.href && item.href !== "/" && !item.steps) assert.ok(hrefs.has(item.href), item.href);
  for (const legal of LEGAL_PAGES) assert.ok(hrefs.has(legal.route), legal.route);
  assert.ok(hrefs.has("/contact"));
  for (const p of SEARCH_PAGES) assert.equal(Boolean(p.soon), p.href === "", p.title);
});
