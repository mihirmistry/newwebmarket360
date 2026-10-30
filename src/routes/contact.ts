import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type pg from "pg";
import { z } from "zod";
import { getCsrfToken, verifyCsrf } from "../middleware/csrf.js";
import { CONTACT_TOPICS, MESSAGE_MAX, contactEmail, contactSchema, createContactMessage } from "../services/contact.js";
import type { Mailer } from "../services/mailer.js";
import type { Customer } from "../services/customers.js";
import { PLANS, findPlan } from "../site/plans.js";
import { pageLocals } from "./page-locals.js";

const contactLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).send("You've sent several messages in a short time. Please wait 15 minutes and try again.");
  },
});

type Values = { name: string; email: string; phone: string; topic: string; message: string };

/** Public Contact page: the form saves to contact_messages, read by admins at /admin/messages. */
export function contactRouter(pool: pg.Pool, mailer: Mailer): Router {
  const router = Router();

  const render = async (req: Request, res: Response, values: Values, errors: Record<string, string> = {}) => {
    const flash = req.session.flash ?? null;
    delete req.session.flash;
    res.set("Cache-Control", "private, no-store");
    res.render("pages/contact", {
      ...(await pageLocals(pool, "Contact", "Questions about Market360X alerts, plans or your account? Send us a message.")),
      bodyClass: "m3x-inner",
      activeNav: "contact",
      scripts: res.app.locals.features?.customerAccounts ? ["/js/indicator.js", "/js/auth.js"] : ["/js/indicator.js"],
      authModal: Boolean(res.app.locals.features?.customerAccounts),
      plans: PLANS,
      topics: CONTACT_TOPICS,
      messageMax: MESSAGE_MAX,
      values,
      errors,
      flash,
      csrfToken: getCsrfToken(req),
    });
  };

  router.get("/contact", async (req, res, next) => {
    try {
      const customer = res.locals.customer as Customer | null;
      // From checkout: /contact?topic=activate&plan=monthly pre-fills the message.
      const topic = CONTACT_TOPICS.some((t) => t.id === req.query.topic) ? String(req.query.topic) : "";
      const plan = findPlan(req.query.plan);
      await render(req, res, {
        name: customer?.name ?? "",
        email: customer?.email ?? "",
        phone: customer?.phone ?? "",
        topic,
        message: plan ? `Hi, I'd like to activate the ${plan.name} plan (${plan.validity}) for Nifty Option Alert.` : "",
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/contact", contactLimiter, verifyCsrf, async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, string>;
    const values: Values = {
      name: body.name ?? "",
      email: body.email ?? "",
      phone: body.phone ?? "",
      topic: body.topic ?? "",
      message: body.message ?? "",
    };
    try {
      // Honeypot: real visitors never see or fill the "website" field; bots usually do.
      if (body.website) {
        req.session.flash = { type: "success", message: "Thanks! Your message has been sent." };
        return res.redirect(303, "/contact");
      }
      const input = contactSchema.parse(values);
      const customer = res.locals.customer as Customer | null;
      const id = await createContactMessage(pool, input, customer?.id ?? null);
      const mail = contactEmail(id, input, `${req.protocol}://${req.get("host")}/admin/messages`);
      mailer // in the background; the message is already saved
        .notify("message", { subject: mail.subject, text: mail.text, replyTo: input.email })
        .catch((err) => console.error(`message #${id}: admin email failed:`, (err as Error).message));
      req.session.flash = { type: "success", message: "Thanks! Your message has been sent. We'll reply to " + input.email + "." };
      res.redirect(303, "/contact");
    } catch (err) {
      if (!(err instanceof z.ZodError)) return next(err);
      const errors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errors[key]) errors[key] = issue.message;
      }
      res.status(400);
      await render(req, res, values, errors).catch(next);
    }
  });

  return router;
}
