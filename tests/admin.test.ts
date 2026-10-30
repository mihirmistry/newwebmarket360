// Admin sidebar dashboard and the Settings page (SMTP + notification emails), against a real PostgreSQL.
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
import type { Mailer } from "../src/services/mailer.js";
import { decryptSecret, encryptSecret, mailSettingsFormSchema } from "../src/services/settings.js";

const PORT = 59000 + Math.floor(Math.random() * 900);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "m360x-adm-"));
const ADMIN = { email: "admin@market360x.test", password: "correct-horse-battery" };
const SECRET = "test-secret-test-secret-test-secret-654";

let db: EmbeddedPostgres;
let pool: pg.Pool;
let app: Express; // real mailer (reads Settings from the database)

before(async () => {
  db = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: "postgres", password: "postgres", port: PORT, persistent: false, onLog: () => {} });
  await db.initialise();
  await db.start();
  await db.createDatabase("m360x_adm");
  const config = loadConfig({ NODE_ENV: "test", PORT: "3999", DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_adm`, SESSION_SECRET: SECRET });
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

async function adminAgent(target: Express = app) {
  const agent = request.agent(target);
  const login = await agent.get("/admin/login").expect(200);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(login.text)?.[1];
  await agent.post("/admin/login").type("form").send({ _csrf: csrf, email: ADMIN.email, password: ADMIN.password }).expect(303).expect("Location", "/admin");
  const page = await agent.get("/admin").expect(200);
  return { agent, page, csrf: /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1]! };
}

const validForm = {
  host: "smtp.example.com",
  port: "587",
  security: "starttls",
  user: "alerts@market360x.com",
  password: "app-password-123",
  fromName: "Market360X",
  fromEmail: "",
  recipients: "Owner@Market360x.com, team@market360x.com",
  notifyOrders: "on",
  notifyMessages: "on",
};

describe("secrets and the settings form", () => {
  test("SMTP passwords are encrypted and only readable with the same key", () => {
    const token = encryptSecret("app-password-123", SECRET);
    assert.ok(!token.includes("app-password-123"));
    assert.equal(decryptSecret(token, SECRET), "app-password-123");
    assert.equal(decryptSecret(token, "another-secret-another-secret-another"), null);
    assert.equal(decryptSecret(token.slice(0, -2) + "xx", SECRET), null);
  });

  test("recipients are split, lower-cased, de-duplicated and validated", () => {
    const ok = mailSettingsFormSchema.parse({ ...validForm, recipients: "A@x.com; b@x.com  a@x.com", password: "" });
    assert.deepEqual(ok.recipients, ["a@x.com", "b@x.com"]);
    assert.equal(ok.notifyOrders, true);
    const bad = mailSettingsFormSchema.safeParse({ ...validForm, recipients: "nope" });
    assert.equal(bad.success, false);
    const noOne = mailSettingsFormSchema.safeParse({ ...validForm, recipients: "" });
    assert.match(JSON.stringify(noOne.error?.issues), /at least one email/);
  });
});

describe("sidebar dashboard", () => {
  test("signing in lands on the dashboard with the sidebar and email warning", async () => {
    const { page } = await adminAgent();
    for (const [href, label] of [["/admin", "Dashboard"], ["/admin/nifty-alerts", "Nifty alerts"], ["/admin/orders", "Orders"], ["/admin/messages", "Messages"], ["/admin/settings", "Settings"]]) {
      assert.match(page.text, new RegExp(`<a href="${href}"[^>]*>\\s*<svg[^>]*>.*?</svg><span>${label}</span>`, "s"), label);
    }
    assert.match(page.text, /<a href="\/admin" data-tip="Dashboard" aria-current="page">/);
    // the Admin tag sits under the email; the brand row has the collapse button
    assert.match(page.text, /<span class="adm-side-email"[^>]*>admin@market360x\.test<\/span>\s*<span class="adm-side-tag">Admin<\/span>/);
    assert.match(page.text, /class="adm-icon-btn adm-side-collapse" data-adm-collapse aria-controls="adm-side" aria-expanded="true" aria-label="Collapse sidebar"/);
    assert.match(page.text, /<div class="adm-shell" data-adm-shell>/);
    assert.match(page.text, /Orders waiting/);
    assert.match(page.text, /Email notifications are off/);
  });

  test("a collapsed sidebar is remembered: pages render collapsed straight away", async () => {
    const { agent } = await adminAgent();
    const page = await agent.get("/admin/settings").set("Cookie", "adm_side=collapsed").expect(200);
    assert.match(page.text, /<div class="adm-shell is-collapsed" data-adm-shell>/);
    assert.match(page.text, /data-adm-collapse aria-controls="adm-side" aria-expanded="false" aria-label="Expand sidebar"/);
  });

  test("sidebar badges count waiting orders and new messages", async () => {
    await pool.query(
      `INSERT INTO plan_orders (plan_id, plan_name, amount, name, email, phone, experience_years) VALUES ('weekly', 'Weekly', 99, 'Asha Rao', 'asha@example.com', '+919876543210', 2)`
    );
    await pool.query(`INSERT INTO contact_messages (name, email, topic, message) VALUES ('Vik', 'vik@example.com', 'plans', 'Is there a trial plan?')`);
    const { page } = await adminAgent();
    assert.match(page.text, /<em class="adm-side-badge" aria-label="1 waiting">1<\/em>/);
    assert.match(page.text, /#\d+ &middot; Asha Rao/);
    assert.match(page.text, /Vik/);
    for (const p of ["/admin/nifty-alerts", "/admin/orders", "/admin/messages", "/admin/settings"]) {
      const res = await request(app).get(p).expect(302);
      assert.match(res.headers.location ?? "", /\/admin\/login/, p);
    }
  });
});

describe("settings page", () => {
  test("validates the form", async () => {
    const { agent, csrf } = await adminAgent();
    const res = await agent.post("/admin/settings").type("form").send({ _csrf: csrf, ...validForm, port: "99999", recipients: "not-an-email" }).expect(400);
    assert.match(res.text, /Enter a port from 1 to 65535/);
    assert.match(res.text, /&#34;not-an-email&#34; is not a valid email address/);
    await agent.post("/admin/settings").type("form").send(validForm).expect(403);
  });

  test("saves settings with the password encrypted and keeps it when left blank", async () => {
    const { agent, csrf } = await adminAgent();
    await agent.post("/admin/settings").type("form").send({ _csrf: csrf, ...validForm }).expect(303).expect("Location", "/admin/settings");
    const saved = (await pool.query("SELECT value FROM app_settings WHERE key = 'mail'")).rows[0].value;
    assert.equal(saved.host, "smtp.example.com");
    assert.deepEqual(saved.recipients, ["owner@market360x.com", "team@market360x.com"]);
    assert.ok(!JSON.stringify(saved).includes("app-password-123"));
    assert.equal(decryptSecret(saved.passEncrypted, SECRET), "app-password-123");

    const page = await agent.get("/admin/settings").expect(200);
    assert.match(page.text, /Email settings saved/);
    assert.match(page.text, /Saved\. Leave blank to keep it/);
    assert.doesNotMatch(page.text, /app-password-123/);

    await agent.post("/admin/settings").type("form").send({ _csrf: csrf, ...validForm, password: "", notifyMessages: "" }).expect(303);
    const kept = (await pool.query("SELECT value FROM app_settings WHERE key = 'mail'")).rows[0].value;
    assert.equal(decryptSecret(kept.passEncrypted, SECRET), "app-password-123");
    assert.equal(kept.notifyMessages, false);

    const dash = await agent.get("/admin").expect(200);
    assert.doesNotMatch(dash.text, /Email notifications are off/);
    assert.match(dash.text, /owner@market360x\.com, team@market360x\.com/);
  });

  test("a failing test email shows the SMTP error", async () => {
    const { agent, csrf } = await adminAgent();
    await agent.post("/admin/settings").type("form").send({ _csrf: csrf, ...validForm, host: "127.0.0.1", port: "1", security: "none" }).expect(303);
    const res = await agent.post("/admin/settings/test").type("form").send({ _csrf: csrf }).expect(400);
    assert.match(res.text, /The test email could not be sent/);
    assert.match(res.text, /ECONNREFUSED|connect/i);
  });

  test("a successful test email confirms who it went to", async () => {
    const stub: Mailer = {
      status: async () => ({ source: "settings", configured: true, recipients: ["owner@market360x.com"], notifyOrders: true, notifyMessages: true, passwordUnreadable: false }),
      notify: async () => true,
      sendTest: async () => ["owner@market360x.com"],
      invalidate() {},
    };
    const withStub = createApp(loadConfig({ NODE_ENV: "test", PORT: "3999", DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_adm`, SESSION_SECRET: SECRET }), pool, { mailer: stub });
    const { agent, csrf } = await adminAgent(withStub);
    await agent.post("/admin/settings/test").type("form").send({ _csrf: csrf }).expect(303);
    assert.match((await agent.get("/admin/settings")).text, /Test email sent to owner@market360x\.com/);
  });
});

describe("contact messages are emailed when switched on", () => {
  test("a new message triggers a 'message' notification", async () => {
    const notes: Array<{ kind: string; subject: string; replyTo?: string }> = [];
    const stub: Mailer = {
      status: async () => ({ source: "settings", configured: true, recipients: ["owner@market360x.com"], notifyOrders: true, notifyMessages: true, passwordUnreadable: false }),
      notify: async (kind, m) => {
        notes.push({ kind, subject: m.subject, replyTo: m.replyTo });
        return true;
      },
      sendTest: async () => [],
      invalidate() {},
    };
    const withStub = createApp(loadConfig({ NODE_ENV: "test", PORT: "3999", DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_adm`, SESSION_SECRET: SECRET }), pool, { mailer: stub });
    const agent = request.agent(withStub);
    const page = await agent.get("/contact").expect(200);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
    await agent
      .post("/contact")
      .type("form")
      .send({ _csrf: csrf, name: "Meera Iyer", email: "meera@example.com", phone: "", topic: "alerts", message: "How fast do the alerts arrive?" })
      .expect(303);
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(notes.length, 1);
    assert.equal(notes[0]!.kind, "message");
    assert.equal(notes[0]!.replyTo, "meera@example.com");
    assert.match(notes[0]!.subject, /New message #\d+ \(Alerts and the dashboard\) - Meera Iyer/);
  });
});
