import { Router, type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import type pg from "pg";
import { z } from "zod";
import { requireCustomer } from "../middleware/account.js";
import { pageLocals } from "./page-locals.js";
import { getCsrfToken, verifyCsrf } from "../middleware/csrf.js";
import {
  EmailTakenError,
  authenticateCustomer,
  createCustomer,
  findCustomerById,
  changeCustomerPassword,
  loginSchema,
  passwordChangeSchema,
  profileSchema,
  signupSchema,
  updateCustomerProfile,
  type Customer,
} from "../services/customers.js";
import { PLANS, formatInr, planComparison } from "../site/plans.js";

const publicCustomer = (c: Customer) => ({ name: c.name, email: c.email });

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { error: "Too many attempts. Please wait 15 minutes and try again." },
});

const passwordLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: "draft-7", legacyHeaders: false });

/** New session id on sign-in (prevents session fixation); keeps an admin login in the same browser. */
function startCustomerSession(req: Request, customerId: number): Promise<string> {
  const adminId = req.session.adminId;
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      if (adminId) req.session.adminId = adminId;
      req.session.customerId = customerId;
      const token = getCsrfToken(req);
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve(token)));
    });
  });
}

async function currentCustomer(pool: pg.Pool, req: Request): Promise<Customer | null> {
  if (!req.session.customerId) return null;
  const customer = await findCustomerById(pool, req.session.customerId);
  if (!customer) delete req.session.customerId;
  return customer;
}

function validationError(res: Response, err: z.ZodError): void {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  res.status(400).json({ error: err.issues[0]?.message ?? "Please check the highlighted fields.", fields });
}

/** JSON API used by the log in / sign up popup. */
export function accountApiRouter(pool: pg.Pool): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  router.get("/session", async (req, res, next) => {
    try {
      const customer = await currentCustomer(pool, req);
      res.json({ authenticated: Boolean(customer), customer: customer ? publicCustomer(customer) : null, csrfToken: getCsrfToken(req) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/signup", authLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const input = signupSchema.parse(req.body ?? {});
      const customer = await createCustomer(pool, input);
      const csrfToken = await startCustomerSession(req, customer.id);
      res.status(201).json({ customer: publicCustomer(customer), csrfToken });
    } catch (err) {
      if (err instanceof z.ZodError) return validationError(res, err);
      if (err instanceof EmailTakenError) {
        res.status(409).json({ error: err.message, fields: { email: err.message } });
        return;
      }
      next(err);
    }
  });

  router.post("/login", authLimiter, verifyCsrf, async (req, res, next) => {
    try {
      const { email, password } = loginSchema.parse(req.body ?? {});
      const customer = await authenticateCustomer(pool, email, password);
      if (!customer) {
        res.status(401).json({ error: "Incorrect email or password." });
        return;
      }
      const csrfToken = await startCustomerSession(req, customer.id);
      res.json({ customer: publicCustomer(customer), csrfToken });
    } catch (err) {
      if (err instanceof z.ZodError) return validationError(res, err);
      next(err);
    }
  });

  router.post("/logout", verifyCsrf, (req, res) => {
    delete req.session.customerId;
    res.json({ ok: true });
  });

  return router;
}

function takeFlash(req: Request) {
  const flash = req.session.flash ?? null;
  delete req.session.flash;
  return flash;
}

function fieldErrors(err: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fields[key]) fields[key] = issue.message;
  }
  return fields;
}

const formatDate = (d: Date | null) =>
  d ? new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kolkata" }).format(d) : "—";

const experienceText = (years: number) => (years === 0 ? "Less than a year" : years === 1 ? "1 year" : `${years} years`);

/** The customer dashboard pages (/account, /account/profile, /account/plan) and log out. */
export function accountPagesRouter(pool: pg.Pool): Router {
  const router = Router();
  const noStore = (_req: Request, res: Response, next: NextFunction) => {
    res.set("Cache-Control", "no-store");
    next();
  };

  router.post("/account/logout", verifyCsrf, (req, res) => {
    delete req.session.customerId;
    res.redirect(303, "/");
  });

  // ---------- customer dashboard (signed-in only) ----------
  router.use("/account", noStore, requireCustomer);

  const render = async (req: Request, res: Response, view: string, title: string, extra: Record<string, unknown> = {}) => {
    const customer = res.locals.customer as Customer;
    res.render(`account/${view}`, {
      ...(await pageLocals(pool, title, "Your Market360X account.")),
      accountPage: view,
      customer,
      csrfToken: getCsrfToken(req),
      flash: takeFlash(req),
      formatDate,
      experienceText,
      ...extra,
    });
  };

  router.get("/account", async (req, res, next) => {
    try {
      await render(req, res, "dashboard", "Dashboard");
    } catch (err) {
      next(err);
    }
  });

  router.get("/account/plan", async (req, res, next) => {
    try {
      await render(req, res, "plan", "Your plan", {
        plans: PLANS.map((p) => ({ ...p, comparison: planComparison(p) })),
        formatInr,
      });
    } catch (err) {
      next(err);
    }
  });

  const profilePage = (req: Request, res: Response, extra: Record<string, unknown> = {}) => {
    const customer = res.locals.customer as Customer;
    return render(req, res, "profile", "Profile", {
      profileValues: { name: customer.name, phone: customer.phone, experienceYears: String(customer.experienceYears) },
      profileErrors: {},
      passwordErrors: {},
      scripts: ["/js/indicator.js", "/js/account.js"],
      ...extra,
    });
  };

  router.get("/account/profile", async (req, res, next) => {
    try {
      await profilePage(req, res);
    } catch (err) {
      next(err);
    }
  });

  router.post("/account/profile", verifyCsrf, async (req, res, next) => {
    const customer = res.locals.customer as Customer;
    const body = (req.body ?? {}) as Record<string, string>;
    try {
      const input = profileSchema.parse({ name: body.name ?? "", phone: body.phone ?? "", experienceYears: body.experienceYears ?? "" });
      await updateCustomerProfile(pool, customer.id, input);
      req.session.flash = { type: "success", message: "Your details have been saved." };
      res.redirect(303, "/account/profile");
    } catch (err) {
      if (!(err instanceof z.ZodError)) return next(err);
      res.status(400);
      await profilePage(req, res, {
        profileValues: { name: body.name ?? "", phone: body.phone ?? "", experienceYears: body.experienceYears ?? "" },
        profileErrors: fieldErrors(err),
      }).catch(next);
    }
  });

  router.post("/account/password", passwordLimiter, verifyCsrf, async (req, res, next) => {
    const customer = res.locals.customer as Customer;
    try {
      const input = passwordChangeSchema.parse(req.body ?? {});
      const ok = await changeCustomerPassword(pool, customer.id, input.currentPassword, input.newPassword, req.sessionID);
      if (!ok) {
        res.status(400);
        return await profilePage(req, res, { passwordErrors: { currentPassword: "Your current password is incorrect" } });
      }
      req.session.flash = { type: "success", message: "Your password has been changed. Other devices have been signed out." };
      res.redirect(303, "/account/profile");
    } catch (err) {
      if (!(err instanceof z.ZodError)) return next(err);
      res.status(400);
      await profilePage(req, res, { passwordErrors: fieldErrors(err) }).catch(next);
    }
  });

  return router;
}
