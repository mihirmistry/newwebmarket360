// Customer sign up / log in / dashboard (CUSTOMER_ACCOUNTS switched on), against a real PostgreSQL (embedded-postgres).
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
import { passwordStrength, validateNewPassword } from "../src/shared/customer-rules.js";

const PORT = 56000 + Math.floor(Math.random() * 1000);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "m360x-acc-"));
const USER = { name: "Aman Verma", email: "Aman@Example.com", phone: "+91 98765-43210", experienceYears: "3", password: "Trade-safely-1" };

let db: EmbeddedPostgres;
let pool: pg.Pool;
let app: Express;

async function freshAgent() {
  const agent = request.agent(app);
  const s = await agent.get("/api/account/session").expect(200);
  assert.equal(s.body.authenticated, false);
  return { agent, csrf: s.body.csrfToken as string };
}

before(async () => {
  db = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: "postgres", password: "postgres", port: PORT, persistent: false, onLog: () => {} });
  await db.initialise();
  await db.start();
  await db.createDatabase("m360x_acc");
  const config = loadConfig({
    NODE_ENV: "test",
    PORT: "3999",
    DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_acc`,
    SESSION_SECRET: "test-secret-test-secret-test-secret-456",
    CUSTOMER_ACCOUNTS: "true",
  });
  pool = createPool(config.DATABASE_URL, false);
  await runMigrations(pool, () => {});
  await upsertAdmin(pool, "admin@market360x.test", "correct-horse-battery");
  app = createApp(config, pool);
});

after(async () => {
  await pool?.end();
  await db?.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

describe("plan buttons", () => {
  test("plan buttons link to checkout and pages include the popup", async () => {
    for (const route of ["/", "/nifty-alert"]) {
      const res = await request(app).get(route).expect(200);
      for (const plan of ["weekly", "monthly", "yearly"]) assert.match(res.text, new RegExp(`href="/checkout\\?plan=${plan}" data-plan="${plan}"`));
      assert.match(res.text, /data-auth-modal/);
      assert.doesNotMatch(res.text, /extras\/sign-up\.html/);
    }
  });
});

describe("password rules", () => {
  test("strength fills 0 to 4 bars and short passwords stay weak", () => {
    assert.equal(passwordStrength(""), 0);
    assert.equal(passwordStrength("abc"), 1);
    assert.equal(passwordStrength("Ab1!"), 1); // meets 3 rules but too short
    assert.equal(passwordStrength("abcdefgh"), 1);
    assert.equal(passwordStrength("Abcdefgh"), 2);
    assert.equal(passwordStrength("Abcdefg1"), 3);
    assert.equal(passwordStrength("Abcdef1!"), 4);
  });

  test("new passwords must meet every rule", () => {
    assert.equal(validateNewPassword("Abcdef1!"), undefined);
    assert.equal(validateNewPassword("abcdefgh"), "Password needs a capital letter, a number and a symbol");
    assert.equal(validateNewPassword("Abcdefg1"), "Password needs a symbol");
  });
});

describe("sign up", () => {
  test("rejects invalid fields with per-field messages", async () => {
    const { agent, csrf } = await freshAgent();
    const res = await agent
      .post("/api/account/signup")
      .set("X-CSRF-Token", csrf)
      .send({ name: "A", email: "nope", phone: "123", experienceYears: "-1", password: "short" })
      .expect(400);
    assert.deepEqual(Object.keys(res.body.fields).sort(), ["email", "experienceYears", "name", "password", "phone"]);
  });

  test("refuses a weak password and says what is missing", async () => {
    const { agent, csrf } = await freshAgent();
    const res = await agent.post("/api/account/signup").set("X-CSRF-Token", csrf).send({ ...USER, email: "weak@example.com", password: "tradesafely" }).expect(400);
    assert.deepEqual(Object.keys(res.body.fields), ["password"]);
    assert.match(res.body.fields.password, /capital letter, a number and a symbol/);
  });

  test("the popup shows the strength meter, password checklist and icons", async () => {
    const res = await request(app).get("/nifty-alert").expect(200);
    assert.ok(res.text.includes('<span class="m3x-strength-bars" aria-hidden="true"><i></i><i></i><i></i><i></i></span>'));
    for (const rule of ["length", "upper", "number", "symbol"]) assert.match(res.text, new RegExp(`data-rule="${rule}"`));
    assert.match(res.text, /class="m3x-icon lucide-eye is-show"/);
    assert.match(res.text, /class="m3x-icon lucide-mail"/);
  });

  test("requires a CSRF token", async () => {
    const { agent } = await freshAgent();
    await agent.post("/api/account/signup").send(USER).expect(403);
  });

  test("creates the account, signs in, and checkout pre-fills their details", async () => {
    const { agent, csrf } = await freshAgent();
    const res = await agent.post("/api/account/signup").set("X-CSRF-Token", csrf).send(USER).expect(201);
    assert.equal(res.body.customer.email, "aman@example.com");
    const s = await agent.get("/api/account/session").expect(200);
    assert.equal(s.body.authenticated, true);

    const page = await agent.get("/checkout?plan=monthly").expect(200);
    assert.match(page.text, /Monthly plan/);
    assert.match(page.text, /name="name" value="Aman Verma"/);
    assert.match(page.text, /name="email" value="aman@example\.com"/);
    assert.match(page.text, /name="phone" value="\+919876543210"/);
    assert.match(page.text, /name="experienceYears" value="3"/);
    assert.match(page.text, /data-total>₹299</);
    assert.match(page.text, /₹97 \(24%\)/);

    const yearly = await agent.get("/checkout?plan=yearly").expect(200);
    assert.match(yearly.text, /data-total>₹2,499</);
    const weekly = await agent.get("/checkout?plan=weekly").expect(200);
    assert.match(weekly.text, /data-total>₹99</);
    assert.doesNotMatch(weekly.text, /You save vs weekly/);
  });

  test("duplicate email is refused", async () => {
    const { agent, csrf } = await freshAgent();
    const res = await agent.post("/api/account/signup").set("X-CSRF-Token", csrf).send({ ...USER, email: "aman@example.com" }).expect(409);
    assert.match(res.body.fields.email, /already exists/);
  });
});

describe("log in / log out", () => {
  test("wrong password is refused", async () => {
    const { agent, csrf } = await freshAgent();
    const res = await agent.post("/api/account/login").set("X-CSRF-Token", csrf).send({ email: USER.email, password: "wrong-password" }).expect(401);
    assert.match(res.body.error, /Incorrect email or password/);
  });

  test("log in works with any email capitalisation, then log out ends access", async () => {
    const { agent, csrf } = await freshAgent();
    const res = await agent.post("/api/account/login").set("X-CSRF-Token", csrf).send({ email: "AMAN@example.com", password: USER.password }).expect(200);
    assert.equal(res.body.customer.name, "Aman Verma");
    await agent.get("/account").expect(200);
    await agent.post("/api/account/logout").set("X-CSRF-Token", res.body.csrfToken).expect(200);
    await agent.get("/account").expect(303);
  });

  test("a customer login does not grant admin access", async () => {
    const { agent, csrf } = await freshAgent();
    await agent.post("/api/account/login").set("X-CSRF-Token", csrf).send({ email: USER.email, password: USER.password }).expect(200);
    await agent.get("/api/admin/nifty-alerts").expect(401);
    await agent.get("/admin/nifty-alerts").expect(302);
  });
});

describe("header profile menu and account pages", () => {
  async function signedIn(email: string, password = "Profile-pass-1") {
    const { agent, csrf } = await freshAgent();
    const res = await agent
      .post("/api/account/signup")
      .set("X-CSRF-Token", csrf)
      .send({ name: "Priya Nair Sharma", email, phone: "9876543210", experienceYears: "2", password })
      .expect(201);
    return { agent, csrf: res.body.csrfToken as string };
  }

  test("signed-out visitors see a Log in link and get no session cookie", async () => {
    const res = await request(app).get("/about").expect(200);
    assert.match(res.text, /class="m3x-acct-login" data-auth-open/);
    assert.doesNotMatch(res.text, /data-account-menu/);
    assert.equal(res.headers["set-cookie"], undefined);
  });

  test("signed-in pages show the name, initials and the 4 menu options, and are never cached", async () => {
    const { agent } = await signedIn("menu@example.com");
    const res = await agent.get("/features").expect(200);
    assert.match(res.text, /class="m3x-acct-name">Priya</);
    assert.match(res.text, /class="m3x-avatar" aria-hidden="true">PS</);
    for (const [href, label] of [["/account/profile", "Profile"], ["/account", "Dashboard"], ["/account/plan", "Plan"]]) {
      assert.ok(res.text.includes(`<a href="${href}">`) && res.text.includes(`${label}</a>`), label);
    }
    assert.match(res.text, /action="\/account\/logout"/);
    assert.match(res.text, /\/js\/account-menu\.js/);
    assert.match(res.headers["cache-control"] ?? "", /private, no-store/);
  });

  test("account pages need a login and send visitors back afterwards", async () => {
    for (const path of ["/account", "/account/profile", "/account/plan"]) {
      await request(app).get(path).expect(303).expect("Location", `/?auth=login&next=${encodeURIComponent(path)}`);
    }
  });

  test("dashboard, profile and plan pages render for the signed-in customer", async () => {
    const { agent } = await signedIn("pages@example.com");
    const dash = await agent.get("/account").expect(200);
    assert.match(dash.text, /Welcome back, Priya/);
    assert.match(dash.text, /No active plan/);
    assert.match(dash.text, /aria-current="page"><svg[^>]*>.*?<\/svg>Dashboard/s);
    const profile = await agent.get("/account/profile").expect(200);
    assert.match(profile.text, /value="Priya Nair Sharma"/);
    assert.match(profile.text, /value="pages@example\.com" readonly/);
    const plan = await agent.get("/account/plan").expect(200);
    for (const p of ["weekly", "monthly", "yearly"]) assert.ok(plan.text.includes(`href="/checkout?plan=${p}"`), p);
    assert.match(plan.text, /₹2,499/);
  });

  test("profile details can be updated, with validation", async () => {
    const { agent, csrf } = await signedIn("edit@example.com");
    const bad = await agent.post("/account/profile").type("form").send({ _csrf: csrf, name: "X", phone: "12", experienceYears: "99" }).expect(400);
    assert.match(bad.text, /Enter your full name/);
    assert.match(bad.text, /Enter a valid mobile number/);
    assert.match(bad.text, /value="X"/);
    await agent.post("/account/profile").type("form").send({ name: "Priya", phone: "9876543210", experienceYears: "5" }).expect(403);
    await agent
      .post("/account/profile")
      .type("form")
      .send({ _csrf: csrf, name: "Priya Nair", phone: "+91 91234 56789", experienceYears: "5" })
      .expect(303)
      .expect("Location", "/account/profile");
    const page = await agent.get("/account/profile").expect(200);
    assert.match(page.text, /Your details have been saved/);
    assert.match(page.text, /value="Priya Nair"/);
    assert.match(page.text, /value="\+919123456789"/);
    assert.match(page.text, /value="5"/);
    const again = await agent.get("/account/profile").expect(200);
    assert.doesNotMatch(again.text, /Your details have been saved/); // flash shows once
  });

  test("password change checks the current password and rules, then signs out other devices", async () => {
    const { agent, csrf } = await signedIn("pw@example.com", "Old-pass-123");
    const other = request.agent(app);
    const s = await other.get("/api/account/session");
    await other.post("/api/account/login").set("X-CSRF-Token", s.body.csrfToken).send({ email: "pw@example.com", password: "Old-pass-123" }).expect(200);
    await other.get("/account").expect(200);

    const send = (body: Record<string, string>) => agent.post("/account/password").type("form").send({ _csrf: csrf, ...body });
    assert.match((await send({ currentPassword: "nope", newPassword: "New-pass-456", confirmPassword: "New-pass-456" }).expect(400)).text, /current password is incorrect/);
    assert.match((await send({ currentPassword: "Old-pass-123", newPassword: "weakpass", confirmPassword: "weakpass" }).expect(400)).text, /Password needs/);
    assert.match((await send({ currentPassword: "Old-pass-123", newPassword: "New-pass-456", confirmPassword: "New-pass-789" }).expect(400)).text, /don(&#39;|')t match/);
    await send({ currentPassword: "Old-pass-123", newPassword: "New-pass-456", confirmPassword: "New-pass-456" }).expect(303);

    await agent.get("/account").expect(200); // this device stays signed in
    await other.get("/account").expect(303); // the other device was signed out
    const fresh = await freshAgent();
    await fresh.agent.post("/api/account/login").set("X-CSRF-Token", fresh.csrf).send({ email: "pw@example.com", password: "New-pass-456" }).expect(200);
  });

  test("log out from the menu returns to the homepage signed out", async () => {
    const { agent, csrf } = await signedIn("bye@example.com");
    await agent.post("/account/logout").type("form").send({ _csrf: csrf }).expect(303).expect("Location", "/");
    const res = await agent.get("/").expect(200);
    assert.match(res.text, /data-auth-open/);
    await agent.get("/account").expect(303);
  });
});
