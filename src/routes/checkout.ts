import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type pg from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { getCsrfToken, verifyCsrf } from "../middleware/csrf.js";
import type { Customer } from "../services/customers.js";
import type { Mailer } from "../services/mailer.js";
import { createOrder, findOrder, markOrderNotified, orderEmail, orderSchema } from "../services/orders.js";
import { paymentDetails } from "../services/payment.js";
import { PLANS, findPlan, formatInr, planComparison, type Plan } from "../site/plans.js";
import { pageLocals } from "./page-locals.js";

const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).send("Too many checkout attempts. Please wait 15 minutes and try again, or contact us.");
  },
});

type Values = { name: string; email: string; phone: string; experienceYears: string; paymentRef: string; paid: boolean };

/**
 * QR checkout: the customer pays the plan amount by UPI, then sends their details.
 * The order is saved (admin view: /admin/orders) and emailed to ADMIN_EMAIL; the admin creates
 * the customer's login and emails the credentials within 24 hours.
 */
export function checkoutRouter(config: AppConfig, pool: pg.Pool, mailer: Mailer): Router {
  const router = Router();

  const render = async (req: Request, res: Response, plan: Plan, values: Values, errors: Record<string, string> = {}) => {
    res.set("Cache-Control", "private, no-store");
    res.render("pages/checkout", {
      ...(await pageLocals(pool, "Checkout", "Pay for your Market360X plan by UPI and send us your details.")),
      activeNav: "nifty-alert",
      scripts: ["/js/indicator.js", "/js/checkout.js"],
      plan,
      plans: PLANS,
      comparison: planComparison(plan),
      formatInr,
      payment: await paymentDetails(config, plan),
      values,
      errors,
      csrfToken: getCsrfToken(req),
    });
  };

  router.get("/checkout", async (req, res, next) => {
    try {
      const plan = findPlan(req.query.plan);
      if (!plan) return res.redirect(303, "/nifty-alert#pricing");
      const customer = res.locals.customer as Customer | null; // only when customer accounts are switched on
      await render(req, res, plan, {
        name: customer?.name ?? "",
        email: customer?.email ?? "",
        phone: customer?.phone ?? "",
        experienceYears: customer ? String(customer.experienceYears) : "",
        paymentRef: "",
        paid: false,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/checkout", orderLimiter, verifyCsrf, async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const plan = findPlan(body.plan);
    if (!plan) return res.redirect(303, "/nifty-alert#pricing");
    const values: Values = {
      name: body.name ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      experienceYears: body.experienceYears ?? "",
      paymentRef: body.paymentRef ?? "",
      paid: body.paid === "yes",
    };
    try {
      const input = orderSchema.parse({ ...values, paid: body.paid ?? "" });
      const order = await createOrder(pool, plan, input);
      req.session.lastOrderId = order.id;

      // Email the admin in the background: the customer shouldn't wait on the mail server,
      // and the order is already safe in the database either way.
      const mail = orderEmail(order, `${req.protocol}://${req.get("host")}/admin/orders`, formatInr);
      mailer
        .notify("order", { subject: mail.subject, text: mail.text, replyTo: order.email })
        .then((sent) =>
          sent ? markOrderNotified(pool, order.id) : console.warn(`order #${order.id} saved; not emailed (set up email in Admin > Settings).`)
        )
        .catch((err) => console.error(`order #${order.id}: admin email failed:`, (err as Error).message));
      res.redirect(303, "/checkout/thank-you");
    } catch (err) {
      if (!(err instanceof z.ZodError)) return next(err);
      const errors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errors[key]) errors[key] = issue.message;
      }
      res.status(400);
      await render(req, res, plan, values, errors).catch(next);
    }
  });

  router.get("/checkout/thank-you", async (req, res, next) => {
    try {
      const id = req.session.lastOrderId;
      const order = id ? await findOrder(pool, id) : null;
      if (!order) return res.redirect(303, "/nifty-alert#pricing");
      res.set("Cache-Control", "private, no-store");
      res.render("pages/checkout-thanks", {
        ...(await pageLocals(pool, "Thank you", "We've received your Market360X order.")),
        activeNav: "nifty-alert",
        order,
        formatInr,
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
