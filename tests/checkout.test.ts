// QR checkout (customer accounts switched off), order emails and the admin Orders page, against a real PostgreSQL.
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
import type { MailMessage, Mailer } from "../src/services/mailer.js";
import { upiLink } from "../src/services/payment.js";
import { PLANS } from "../src/site/plans.js";

const PORT = 58000 + Math.floor(Math.random() * 1000);
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "m360x-co-"));
const ADMIN = { email: "admin@market360x.test", password: "correct-horse-battery" };
const sent: Array<MailMessage & { kind: string }> = [];
const RECIPIENT = "owner@market360x.test";
const stubMailer: Mailer = {
  async status() {
    return { source: "settings", configured: true, recipients: [RECIPIENT], notifyOrders: true, notifyMessages: true, passwordUnreadable: false };
  },
  async notify(kind, message) {
    sent.push({ ...message, to: RECIPIENT, kind });
    return true;
  },
  async sendTest() {
    return [RECIPIENT];
  },
  invalidate() {},
};

let db: EmbeddedPostgres;
let pool: pg.Pool;
let app: Express; // UPI ID set, email on
let bare: Express; // default settings: the shipped QR image, no email
let base: Record<string, string>;

before(async () => {
  db = new EmbeddedPostgres({ databaseDir: DATA_DIR, user: "postgres", password: "postgres", port: PORT, persistent: false, onLog: () => {} });
  await db.initialise();
  await db.start();
  await db.createDatabase("m360x_co");
  base = {
    NODE_ENV: "test",
    PORT: "3999",
    DATABASE_URL: `postgres://postgres:postgres@localhost:${PORT}/m360x_co`,
    SESSION_SECRET: "test-secret-test-secret-test-secret-321",
  };
  const config = loadConfig({ ...base, PAYMENT_UPI_ID: "market360x@okaxis", PAYMENT_UPI_NAME: "Market360X", ADMIN_EMAIL: "owner@market360x.test" });
  pool = createPool(config.DATABASE_URL, false);
  await runMigrations(pool, () => {});
  await upsertAdmin(pool, ADMIN.email, ADMIN.password);
  app = createApp(config, pool, { mailer: stubMailer });
  bare = createApp(loadConfig(base), pool);
});

after(async () => {
  await pool?.end();
  await db?.stop();
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
});

async function checkoutForm(plan = "monthly", target: Express = app) {
  const agent = request.agent(target);
  const page = await agent.get(`/checkout?plan=${plan}`).expect(200);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1];
  assert.ok(csrf);
  return { agent, csrf, page };
}
const details = { name: "Ravi Kumar", email: "Ravi@Example.com", phone: "+91 98765 43210", experienceYears: "4", paymentRef: "415263789012", paid: "yes" };

describe("log in and sign up are switched off", () => {
  test("no Log in link, popup or account pages", async () => {
    for (const route of ["/", "/nifty-alert", "/contact"]) {
      const res = await request(app).get(route).expect(200);
      assert.doesNotMatch(res.text, /data-auth-open|data-auth-modal|data-account-menu|\/js\/auth\.js/, route);
    }
    await request(app).get("/account").expect(404);
    await request(app).get("/account/profile").expect(404);
    await request(app).get("/api/account/session").expect(404);
  });

  test("plan buttons go straight to checkout", async () => {
    const res = await request(app).get("/nifty-alert").expect(200);
    for (const plan of ["weekly", "monthly", "yearly"]) assert.match(res.text, new RegExp(`href="/checkout\\?plan=${plan}"`));
  });
});

describe("checkout page", () => {
  test("shows the plan, total and a UPI QR for the exact amount", async () => {
    const { page } = await checkoutForm("monthly");
    assert.match(page.text, /Monthly plan/);
    assert.match(page.text, /data-total>₹299</);
    assert.match(page.text, /<figure class="m3x-qr"[^>]*>\s*<svg/);
    assert.match(page.text, /href="upi:\/\/pay\?pa=market360x%40okaxis&amp;pn=Market360X&amp;am=299\.00&amp;cu=INR/);
    assert.match(page.text, /UPI ID: <strong>market360x@okaxis<\/strong>/);
    for (const field of ["name", "email", "phone", "experienceYears", "paymentRef", "paid"]) assert.match(page.text, new RegExp(`name="${field}"`));
    // One form holds both steps; on phones /js/checkout.js shows details first, then the QR and confirmation.
    assert.match(page.text, /<form method="post" action="\/checkout" class="m3x-co-grid" novalidate data-co-form data-co-start="1" data-step="1">/);
    assert.match(page.text, /<script src="\/js\/boot\.js" defer data-scripts="[^"]*\/js\/checkout\.js/);
    assert.match(page.text, /data-co-next>Continue to payment/);
  });

  test("by default it shows the business QR image and asks for the exact amount", async () => {
    const res = await request(bare).get("/checkout?plan=yearly").expect(200);
    // WebP (23 KB, the same UPI payload as the original JPEG); it is the largest thing on the page, so it loads first
    assert.match(res.text, /<img src="\/images\/payment\/qr-market360x\.webp" alt="UPI QR code for Anand Singh" width="220" height="220" fetchpriority="high" \/>/);
    assert.match(res.text, /payee as <strong>Anand Singh<\/strong>/);
    assert.match(res.text, /Enter exactly <strong>₹2,499<\/strong> when you pay/);
    assert.doesNotMatch(res.text, /UPI payment is being set up/);
    await request(bare).get("/images/payment/qr-market360x.webp").expect(200).expect("Content-Type", /image\/webp/);
  });

  test("phones get the two steps from the first paint: the step is rendered by the server", async () => {
    const res = await request(bare).get("/checkout?plan=monthly").expect(200);
    assert.match(res.text, /data-co-form data-co-start="1" data-step="1">/);
    assert.match(res.text, /<li data-co-progress="1" aria-current="step"><span>1<\/span>Your details<\/li>/);
  });

  test("with the QR turned off it asks the visitor to contact us", async () => {
    const off = createApp(loadConfig({ ...base, PAYMENT_QR_IMAGE: "none" }), pool);
    const res = await request(off).get("/checkout?plan=yearly").expect(200);
    assert.match(res.text, /UPI payment is being set up/);
    assert.doesNotMatch(res.text, /class="m3x-qr"/);
  });

  test("unknown plans go back to pricing", async () => {
    await request(app).get("/checkout?plan=platinum").expect(303).expect("Location", "/nifty-alert#pricing");
  });

  test("the UPI link is well formed", () => {
    const link = upiLink("pay@upi", "Market 360X", PLANS[2]!);
    assert.equal(link, "upi://pay?pa=pay%40upi&pn=Market%20360X&am=2499.00&cu=INR&tn=Market360X%20Yearly%20plan");
  });
});

describe("submitting the checkout form", () => {
  test("validates every field, including the payment confirmation", async () => {
    const { agent, csrf } = await checkoutForm();
    const res = await agent
      .post("/checkout")
      .type("form")
      .send({ _csrf: csrf, plan: "monthly", name: "R", email: "x", phone: "1", experienceYears: "70", paymentRef: "ab" })
      .expect(400);
    for (const msg of ["Enter your full name", "Enter a valid email address", "Enter a valid mobile number", "Enter a whole number from 0 to 60", "Use the 6 to 40", "Please pay using the QR code"]) {
      assert.match(res.text, new RegExp(msg));
    }
    assert.match(res.text, /value="x"/);
    assert.match(res.text, /data-co-start="1"/, "phones reopen step 1 (details) when a detail is wrong");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM plan_orders")).rows[0].n, 0);
  });

  test("on phones it reopens the payment step when only the payment confirmation is missing", async () => {
    const { agent, csrf } = await checkoutForm();
    const res = await agent
      .post("/checkout")
      .type("form")
      .send({ _csrf: csrf, plan: "monthly", ...details, paid: "" })
      .expect(400);
    assert.match(res.text, /data-co-start="2"/);
    assert.match(res.text, /<small class="m3x-field-error" id="m3x-err-paid" data-error-for="paid">Please pay using the QR code/);
    assert.match(res.text, /<small class="m3x-field-error" id="m3x-err-name" data-error-for="name"><\/small>/);
  });

  test("the UPI transaction ID is required", async () => {
    const { page } = await checkoutForm();
    assert.match(page.text, /<input type="text" name="paymentRef"[^>]* required/);
    assert.doesNotMatch(page.text, /UPI transaction ID[^<]*<em class="m3x-optional">/);
    const { agent, csrf } = await checkoutForm();
    const res = await agent
      .post("/checkout")
      .type("form")
      .send({ _csrf: csrf, plan: "monthly", ...details, paymentRef: "  " })
      .expect(400);
    assert.match(res.text, /data-error-for="paymentRef">Enter the UPI transaction ID \(UTR\) from your payment receipt</);
    assert.match(res.text, /data-co-start="2"/, "phones reopen the payment step");
    assert.equal((await pool.query("SELECT count(*)::int AS n FROM plan_orders")).rows[0].n, 0);
  });

  test("requires the CSRF token", async () => {
    const { agent } = await checkoutForm();
    await agent.post("/checkout").type("form").send({ plan: "monthly", ...details }).expect(403);
  });

  test("saves the order with the server's price, emails the admin and thanks the customer", async () => {
    const { agent, csrf } = await checkoutForm("yearly");
    await agent
      .post("/checkout")
      .type("form")
      .send({ _csrf: csrf, plan: "yearly", amount: "1", ...details, paymentRef: "4152 6378 9012" })
      .expect(303)
      .expect("Location", "/checkout/thank-you");

    const { rows } = await pool.query("SELECT id, plan_id, amount, name, email, phone, experience_years, payment_ref, status FROM plan_orders");
    assert.equal(rows.length, 1);
    const order = rows[0];
    assert.deepEqual(
      { ...order, id: undefined },
      { id: undefined, plan_id: "yearly", amount: 2499, name: "Ravi Kumar", email: "ravi@example.com", phone: "+919876543210", experience_years: 4, payment_ref: "415263789012", status: "new" }
    );

    const thanks = await agent.get("/checkout/thank-you").expect(200);
    assert.match(thanks.text, /Thank you, Ravi!/);
    assert.match(thanks.text, /You will receive your login credentials at <strong>ravi@example\.com<\/strong> within 24 hours/);
    assert.match(thanks.text, new RegExp(`#${order.id}`));

    await new Promise((r) => setTimeout(r, 50)); // the admin email is sent in the background
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.to, "owner@market360x.test");
    assert.equal(sent[0]!.replyTo, "ravi@example.com");
    assert.match(sent[0]!.subject, new RegExp(`New order #${order.id}: Yearly plan \\(₹2,499\\) - Ravi Kumar`));
    for (const line of ["Ravi Kumar", "ravi@example.com", "+919876543210", "4 years in the market", "415263789012", "/admin/orders"]) {
      assert.ok(sent[0]!.text.includes(line), line);
    }
    const notified = await pool.query("SELECT admin_notified_at FROM plan_orders WHERE id = $1", [order.id]);
    assert.ok(notified.rows[0].admin_notified_at);
  });

  test("the thank-you page needs a submitted order", async () => {
    await request(app).get("/checkout/thank-you").expect(303).expect("Location", "/nifty-alert#pricing");
  });
});

describe("admin orders", () => {
  async function adminAgent() {
    const agent = request.agent(app);
    const login = await agent.get("/admin/login").expect(200);
    const csrf = /name="_csrf" value="([^"]+)"/.exec(login.text)?.[1];
    await agent.post("/admin/login").type("form").send({ _csrf: csrf, email: ADMIN.email, password: ADMIN.password }).expect(303);
    const page = await agent.get("/admin/orders").expect(200);
    return { agent, page, csrf: /name="_csrf" value="([^"]+)"/.exec(page.text)?.[1]! };
  }

  test("needs an admin login", async () => {
    const res = await request(app).get("/admin/orders").expect(302);
    assert.match(res.headers.location ?? "", /\/admin\/login/);
  });

  test("lists orders and lets the admin mark them done and delete them", async () => {
    const { agent, page, csrf } = await adminAgent();
    assert.match(page.text, /Yearly plan &middot; ₹2,499/);
    assert.match(page.text, /Ravi Kumar/);
    assert.match(page.text, /415263789012/);
    assert.match(page.text, /Emailed to admin/);
    assert.match(page.text, /1 waiting/);
    const id = (await pool.query("SELECT id FROM plan_orders")).rows[0].id;

    await agent.post(`/admin/orders/${id}/status`).type("form").send({ _csrf: csrf, status: "done" }).expect(303);
    assert.match((await agent.get("/admin/orders")).text, /0 waiting/);
    await agent.post(`/admin/orders/${id}/delete`).type("form").send({}).expect(403);
    await agent.post(`/admin/orders/${id}/delete`).type("form").send({ _csrf: csrf }).expect(303);
    assert.match((await agent.get("/admin/orders")).text, /No orders yet/);
  });
});
