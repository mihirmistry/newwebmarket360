// Integration tests against a real PostgreSQL started with embedded-postgres.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import request from "supertest";
import type { Express } from "express";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createPool } from "../src/db/pool.js";
import { runMigrations } from "../src/db/migrate.js";
import { upsertAdmin } from "../src/services/admins.js";

const PORT = 55000 + Math.floor(Math.random() * 1000);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "m360x-pg-"));
const ADMIN = { email: "admin@market360x.test", password: "correct-horse-battery" };

let db: EmbeddedPostgres;
let pool: pg.Pool;
let app: Express;

/** Signs in and returns an agent (with session cookie) plus the CSRF token from the admin page. */
async function signIn() {
  const agent = request.agent(app);
  const loginPage = await agent.get("/admin/login").expect(200);
  const loginToken = /name="_csrf" value="([^"]+)"/.exec(loginPage.text)?.[1];
  assert.ok(loginToken, "login page has a CSRF token");
  await agent
    .post("/admin/login")
    .type("form")
    .send({ email: ADMIN.email, password: ADMIN.password, _csrf: loginToken, next: "/admin/nifty-alerts" })
    .expect(303)
    .expect("Location", "/admin/nifty-alerts");
  const adminPage = await agent.get("/admin/nifty-alerts").expect(200);
  const csrf = /<meta name="csrf-token" content="([^"]+)"/.exec(adminPage.text)?.[1];
  assert.ok(csrf, "admin page has a CSRF token");
  return { agent, csrf, adminPage };
}

before(async () => {
  db = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: "postgres", password: "postgres", port: PORT, persistent: false, onLog: () => {} });
  await db.initialise();
  await db.start();
  await db.createDatabase("m360x_test");
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3999",
    DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_test`,
    SESSION_SECRET: "test-secret-test-secret-test-secret-123",
  });
  pool = createPool(config.DATABASE_URL, false);
  await runMigrations(pool, () => {});
  await upsertAdmin(pool, ADMIN.email, ADMIN.password);
  app = createApp(config, pool);
});

after(async () => {
  await pool?.end();
  await db?.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("public dashboard", () => {
  test("starts with the 9 automatic starter indicators, neutral until Angel One data arrives", async () => {
    const res = await request(app).get("/api/nifty-sentiment").expect(200).expect("Cache-Control", "no-store");
    assert.equal(res.body.alerts.length, 9);
    assert.deepEqual(res.body.counts, { bullish: 0, bearish: 0, neutral: 9, active: 9 });
    // every automatic indicator starts at 0 (migrations 007-009) => 0% Neutral
    assert.equal(res.body.sentiment.percent, 0);
    assert.equal(res.body.sentiment.label, "Neutral");
    assert.ok(!("id" in res.body.alerts[0]), "public payload does not expose internal ids");
    assert.equal(res.headers["set-cookie"], undefined, "public visitors get no session cookie");
  });

  test("homepage renders the dashboard from saved data", async () => {
    const res = await request(app).get("/").expect(200);
    assert.match(res.text, /data-sentiment-dashboard/);
    assert.match(res.text, /data-percent>0%</);
    // banner: today's card (direction, then counts with their share) and the daily trend chart
    const banner = res.text.slice(res.text.indexOf('class="m3x-sent2"'));
    assert.ok(banner.indexOf("data-score-card") < banner.indexOf("m3x-sent2-counts"));
    assert.ok(banner.indexOf("m3x-sent2-counts") < banner.indexOf("data-trend"));
    assert.match(banner, /class="m3x-trend-pt is-neutral is-latest"/, "today is plotted as the latest point");
    assert.match(res.text, /class="m3x-sec-head m3x-dash-head"/);
    for (const key of ["bullish", "bearish", "neutral"]) assert.match(banner, new RegExp(`data-share="${key}">\\d{1,3}%<`));
  });

  test("all marketing pages render and old .html URLs redirect", async () => {
    for (const route of ["/about", "/features", "/nifty-alert", "/options", "/algo"]) {
      await request(app).get(route).expect(200);
    }
    await request(app).get("/index.html").expect(301).expect("Location", "/");
    await request(app).get("/pricing.html").expect(301).expect("Location", "/nifty-alert");
    await request(app).get("/about.html").expect(301).expect("Location", "/about");
    await request(app).get("/does-not-exist").expect(404);
  });
});

describe("admin security", () => {
  test("admin page redirects to login and admin API refuses anonymous requests", async () => {
    await request(app).get("/admin/nifty-alerts").expect(302).expect("Location", /\/admin\/login/);
    await request(app).get("/api/admin/nifty-alerts").expect(401);
    await request(app).put("/api/admin/nifty-alerts").send({ alerts: [] }).expect(401);
    await request(app).delete("/api/admin/nifty-alerts/1").expect(401);
  });

  test("wrong password is rejected", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/admin/login");
    const token = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
    const res = await agent.post("/admin/login").type("form").send({ email: ADMIN.email, password: "wrong-password-123", _csrf: token }).expect(401);
    assert.match(res.text, /Incorrect email or password/);
  });

  test("login without a CSRF token is rejected", async () => {
    await request(app).post("/admin/login").type("form").send({ email: ADMIN.email, password: ADMIN.password }).expect(403);
  });

  test("writes without the CSRF header are rejected even when signed in", async () => {
    const { agent } = await signIn();
    await agent.put("/api/admin/nifty-alerts").send({ alerts: [] }).expect(403);
    await agent.put("/api/admin/nifty-alerts").set("X-CSRF-Token", "wrong").send({ alerts: [] }).expect(403);
  });

  test("login only redirects inside the admin area", async () => {
    const agent = request.agent(app);
    const page = await agent.get("/admin/login");
    const token = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
    await agent
      .post("/admin/login")
      .type("form")
      .send({ email: ADMIN.email, password: ADMIN.password, _csrf: token, next: "https://evil.example" })
      .expect(303)
      .expect("Location", "/admin");
  });
});

describe("admin alert management", () => {
  test("bulk save stores negative values, excludes disabled alerts and persists", async () => {
    const { agent, csrf } = await signIn();
    const list = await agent.get("/api/admin/nifty-alerts").expect(200);
    const alerts = list.body.alerts as { id: number; name: string; description: string; signalValue: number; enabled: boolean }[];
    assert.equal(alerts.length, 9);

    // switch the rows to values entered by hand: +2, +1, -2, -1, 0, +2 (disabled), -1, 0, 0, and add a 10th row
    const values = [2, 1, -2, -1, 0, 2, -1, 0, 0];
    const payload = {
      alerts: [
        ...alerts.map((a, i) => ({ id: a.id, name: a.name, description: a.description, signalValue: values[i], enabled: i !== 5, indicator: null })),
        { name: "Breadth Signal", description: "Advance/decline ratio", signalValue: -2, enabled: true },
      ],
    };
    const saved = await agent.put("/api/admin/nifty-alerts").set("X-CSRF-Token", csrf).send(payload).expect(200);
    assert.equal(saved.body.alerts.length, 10);
    assert.equal(saved.body.alerts[2].signalValue, -2);
    assert.equal(saved.body.alerts[9].name, "Breadth Signal");

    // enabled values: 2,1,-2,-1,0,-1,0,0,-2 => B=3 D=6 N=-3 T=9 => -33% Bearish
    const pub = await request(app).get("/api/nifty-sentiment").expect(200);
    assert.equal(pub.body.alerts.length, 9, "disabled alert is hidden");
    assert.equal(pub.body.sentiment.bullishStrength, 3);
    assert.equal(pub.body.sentiment.bearishStrength, 6);
    assert.equal(pub.body.sentiment.percent, -33);
    assert.equal(pub.body.sentiment.label, "Bearish");

    // persists for a new session
    const again = await signIn();
    const reloaded = await again.agent.get("/api/admin/nifty-alerts").expect(200);
    assert.equal(reloaded.body.alerts.length, 10);
    assert.equal(reloaded.body.alerts[5].enabled, false);
  });

  test("delete removes an alert and updates the public data", async () => {
    const { agent, csrf } = await signIn();
    const list = await agent.get("/api/admin/nifty-alerts");
    const target = list.body.alerts.find((a: { name: string }) => a.name === "Breadth Signal");
    await agent.delete(`/api/admin/nifty-alerts/${target.id}`).set("X-CSRF-Token", csrf).expect(204);
    await agent.delete(`/api/admin/nifty-alerts/${target.id}`).set("X-CSRF-Token", csrf).expect(404);
    const pub = await request(app).get("/api/nifty-sentiment");
    assert.ok(!pub.body.alerts.some((a: { name: string }) => a.name === "Breadth Signal"));
  });

  test("create and patch single alerts", async () => {
    const { agent, csrf } = await signIn();
    const created = await agent.post("/api/admin/nifty-alerts").set("X-CSRF-Token", csrf).send({ name: "Gap Signal", signalValue: -1.5 }).expect(201);
    assert.equal(created.body.alert.signalValue, -1.5);
    assert.equal(created.body.alert.enabled, true);
    const patched = await agent
      .patch(`/api/admin/nifty-alerts/${created.body.alert.id}`)
      .set("X-CSRF-Token", csrf)
      .send({ enabled: false })
      .expect(200);
    assert.equal(patched.body.alert.enabled, false);
    assert.equal(patched.body.alert.signalValue, -1.5);
  });

  test("invalid values are rejected with field-level errors and nothing is saved", async () => {
    const { agent, csrf } = await signIn();
    const before = (await agent.get("/api/admin/nifty-alerts")).body.alerts;
    const bad = await agent
      .put("/api/admin/nifty-alerts")
      .set("X-CSRF-Token", csrf)
      .send({ alerts: [{ name: "", signalValue: 2 }, { name: "Too big", signalValue: 500 }, { name: "Text", signalValue: "abc" }] })
      .expect(400);
    const paths = bad.body.issues.map((i: { path: (string | number)[] }) => i.path.join("."));
    assert.ok(paths.includes("alerts.0.name"));
    assert.ok(paths.includes("alerts.1.signalValue"));
    assert.ok(paths.includes("alerts.2.signalValue"));
    const afterList = (await agent.get("/api/admin/nifty-alerts")).body.alerts;
    assert.equal(afterList.length, before.length, "nothing changed");
  });

  test("a failing row rolls back the whole save (transaction)", async () => {
    const { agent, csrf } = await signIn();
    const before = (await agent.get("/api/admin/nifty-alerts")).body.alerts;
    await agent
      .put("/api/admin/nifty-alerts")
      .set("X-CSRF-Token", csrf)
      .send({ alerts: [{ name: "Should not persist", signalValue: 1 }, { id: 999999, name: "Ghost", signalValue: 1 }] })
      .expect(404);
    const afterList = (await agent.get("/api/admin/nifty-alerts")).body.alerts;
    assert.equal(afterList.length, before.length);
    assert.ok(!afterList.some((a: { name: string }) => a.name === "Should not persist"));
  });

  test("disabling every alert gives neutral sentiment", async () => {
    const { agent, csrf } = await signIn();
    const list = (await agent.get("/api/admin/nifty-alerts")).body.alerts;
    await agent
      .put("/api/admin/nifty-alerts")
      .set("X-CSRF-Token", csrf)
      .send({ alerts: list.map((a: Record<string, unknown>) => ({ id: a.id, name: a.name, description: a.description, signalValue: a.signalValue, enabled: false })) })
      .expect(200);
    const pub = await request(app).get("/api/nifty-sentiment").expect(200);
    assert.equal(pub.body.alerts.length, 0);
    assert.equal(pub.body.sentiment.percent, 0);
    assert.equal(pub.body.sentiment.label, "Neutral");
    assert.equal(pub.body.counts.active, 0);
    const home = await request(app).get("/").expect(200);
    assert.match(home.text, /<b data-count="active">0<\/b>/);
    // today's history row follows the change: one row per day, updated in place
    assert.equal(pub.body.history.at(-1).label, "Neutral");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM nifty_sentiment_daily")).rows[0].n, 1);
    assert.match(home.text, /data-label>Neutral</);
    for (const key of ["bullish", "bearish", "neutral"]) assert.match(home.text, new RegExp(`data-share="${key}">0%<`));
  });

  test("logout ends the session", async () => {
    const { agent, csrf } = await signIn();
    await agent.post("/admin/logout").type("form").send({ _csrf: csrf }).expect(303);
    await agent.get("/api/admin/nifty-alerts").expect(401);
  });
});
