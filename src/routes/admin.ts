import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import type pg from "pg";
import { z } from "zod";
import type { AppConfig } from "../config.js";
import { requireAdmin } from "../middleware/auth.js";
import { getCsrfToken, verifyCsrf } from "../middleware/csrf.js";
import { getAdminCounts, getAdminOverview } from "../services/admin-overview.js";
import { authenticateAdmin } from "../services/admins.js";
import type { Mailer } from "../services/mailer.js";
import { angelOneFormSchema, getAngelOneSettings, getMailSettings, getSettingsUpdatedAt, mailSettingsFormSchema, saveAngelOneSettings, saveMailSettings } from "../services/settings.js";
import type { IndicatorService } from "../services/auto-indicators.js";
import { INDICATORS } from "../shared/indicators.js";
import { getPublicSentiment } from "../services/alerts.js";
import { formatPercent } from "../shared/sentiment.js";
import { deleteContactMessage, listContactMessages, setContactMessageStatus, topicLabel } from "../services/contact.js";
import { deleteOrder, listOrders, setOrderStatus } from "../services/orders.js";
import { formatInr } from "../site/plans.js";
import {
  NotFoundError,
  alertInputSchema,
  alertPatchSchema,
  bulkSaveSchema,
  createAlert,
  deleteAlert,
  listAllAlerts,
  saveAllAlerts,
  updateAlert,
} from "../services/alerts.js";

/** Only allow redirects back into the admin area (prevents open redirects). */
function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/admin(\/[\w\-/]*)?$/.test(value) && value !== "/admin/login" ? value : "/admin";
}

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }).format(d);

type SettingsValues = {
  host: string;
  port: string;
  security: string;
  user: string;
  fromName: string;
  fromEmail: string;
  recipients: string;
  notifyOrders: boolean;
  notifyMessages: boolean;
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  handler: (req, res) => {
    res.status(429).render("admin/login", {
      error: "Too many sign-in attempts. Wait 15 minutes and try again.",
      email: typeof req.body?.email === "string" ? req.body.email : "",
      next: safeNext(req.body?.next),
      csrfToken: getCsrfToken(req),
    });
  },
});

/** HTML admin pages: login/logout, dashboard, alerts editor, orders, messages, settings. */
/** Angel One section of the Settings page: what to show besides the saved values. */
interface AngelView {
  errors?: Record<string, string>;
  /** Result of "Test connection" */
  test?: { ok: boolean; message: string };
  clientCode?: string;
  enabled?: boolean;
}

export function adminPagesRouter(config: AppConfig, pool: pg.Pool, mailer: Mailer, indicators: IndicatorService): Router {
  const router = Router();

  /** Signed-in admin + what every page in the sidebar layout needs (badge counts, CSRF token, one-time message). */
  const shell = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.locals.admin = req.admin;
      res.locals.csrfToken = getCsrfToken(req);
      res.locals.counts = await getAdminCounts(pool);
      // sidebar collapsed to icons (set by /js/admin-shell.js), so the page renders that way without a flash
      res.locals.sideCollapsed = /(?:^|;\s*)adm_side=collapsed(?:;|$)/.test(req.headers.cookie ?? "");
      res.locals.flash = req.session.flash ?? null;
      delete req.session.flash;
      next();
    } catch (err) {
      next(err);
    }
  };
  const page = [requireAdmin(pool, "page"), shell];

  router.get("/admin", ...page, async (_req, res, next) => {
    try {
      const [overview, mail] = await Promise.all([getAdminOverview(pool), mailer.status()]);
      let sentiment = null;
      try {
        sentiment = (await getPublicSentiment(pool)).sentiment;
      } catch {
        /* card shows "unavailable" */
      }
      res.render("admin/dashboard", { overview, mail, sentiment, formatInr, formatPercent, fmtDateTime, topicLabel });
    } catch (err) {
      next(err);
    }
  });

  // ---------- Settings: SMTP + notification emails ----------
  const settingsPage = async (
    res: Response,
    values: SettingsValues | null,
    errors: Record<string, string> = {},
    testError: string | null = null,
    angelView: AngelView = {}
  ) => {
    const [saved, updatedAt, mail, angelSaved, lastAuto] = await Promise.all([
      getMailSettings(pool),
      getSettingsUpdatedAt(pool),
      mailer.status(),
      getAngelOneSettings(pool),
      pool.query<{ at: Date | null }>("SELECT max(auto_updated_at) AS at FROM nifty_alerts WHERE indicator IS NOT NULL"),
    ]);
    const last = indicators.lastResult();
    const angel = {
      enabled: angelView.enabled ?? angelSaved?.enabled ?? false,
      clientCode: angelView.clientCode ?? angelSaved?.clientCode ?? "",
      hasApiKey: Boolean(angelSaved?.apiKeyEncrypted),
      hasPin: Boolean(angelSaved?.pinEncrypted),
      hasTotp: Boolean(angelSaved?.totpEncrypted),
      savedAt: angelSaved ? fmtDateTime(angelSaved.updatedAt) : null,
      lastUpdate: lastAuto.rows[0]?.at ? fmtDateTime(lastAuto.rows[0].at) : null,
      lastResult: last,
      errors: angelView.errors ?? {},
      test: angelView.test ?? null,
    };
    const v: SettingsValues = values ?? {
      host: saved?.host ?? "",
      port: String(saved?.port ?? 587),
      security: saved?.security ?? "starttls",
      user: saved?.user ?? "",
      fromName: saved?.fromName ?? "Market360X",
      fromEmail: saved?.fromEmail ?? "",
      recipients: (saved?.recipients ?? []).join(", "),
      notifyOrders: saved?.notifyOrders ?? true,
      notifyMessages: saved?.notifyMessages ?? true,
    };
    res.render("admin/settings", {
      values: v,
      errors,
      testError,
      hasPassword: Boolean(saved?.passEncrypted),
      updatedAt: updatedAt ? fmtDateTime(updatedAt) : null,
      mail,
      angel,
    });
  };

  router.get("/admin/settings", ...page, async (_req, res, next) => {
    try {
      await settingsPage(res, null);
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/settings", ...page, verifyCsrf, async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, string>;
    try {
      const form = mailSettingsFormSchema.parse({
        host: body.host ?? "",
        port: body.port ?? "",
        security: body.security ?? "",
        user: body.user ?? "",
        password: body.password ?? "",
        clearPassword: body.clearPassword,
        fromName: body.fromName ?? "",
        fromEmail: body.fromEmail ?? "",
        recipients: body.recipients ?? "",
        notifyOrders: body.notifyOrders,
        notifyMessages: body.notifyMessages,
      });
      await saveMailSettings(pool, form, config.SESSION_SECRET);
      mailer.invalidate();
      req.session.flash = { type: "success", message: "Email settings saved." };
      res.redirect(303, "/admin/settings");
    } catch (err) {
      if (!(err instanceof z.ZodError)) return next(err);
      const errors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errors[key]) errors[key] = issue.message;
      }
      res.status(400);
      await settingsPage(
        res,
        {
          host: body.host ?? "",
          port: body.port ?? "",
          security: body.security ?? "starttls",
          user: body.user ?? "",
          fromName: body.fromName ?? "",
          fromEmail: body.fromEmail ?? "",
          recipients: body.recipients ?? "",
          notifyOrders: body.notifyOrders === "on",
          notifyMessages: body.notifyMessages === "on",
        },
        errors
      ).catch(next);
    }
  });

  router.post("/admin/settings/test", ...page, verifyCsrf, async (req, res, next) => {
    try {
      const to = await mailer.sendTest();
      req.session.flash = { type: "success", message: `Test email sent to ${to.join(", ")}. Check the inbox (and spam folder).` };
      res.redirect(303, "/admin/settings");
    } catch (err) {
      // Show the SMTP server's reason (e.g. wrong password) so the admin can fix it.
      const reason = (err as Error).message?.slice(0, 300) || "Unknown error";
      res.status(400);
      await settingsPage(res, null, {}, reason).catch(next);
    }
  });

  // ---------- Settings: Angel One SmartAPI (automatic indicators) ----------
  router.post("/admin/settings/angelone", ...page, verifyCsrf, async (req, res, next) => {
    const body = (req.body ?? {}) as Record<string, string>;
    try {
      const form = angelOneFormSchema.parse({
        enabled: body.enabled,
        clientCode: body.clientCode ?? "",
        apiKey: body.apiKey ?? "",
        pin: body.pin ?? "",
        totpSecret: body.totpSecret ?? "",
      });
      const problem = await saveAngelOneSettings(pool, form, config.SESSION_SECRET);
      if (problem) {
        res.status(400);
        return await settingsPage(res, null, {}, null, { errors: { angel: problem }, clientCode: form.clientCode, enabled: form.enabled });
      }
      if (form.enabled) void indicators.refresh(); // first values straight away
      req.session.flash = { type: "success", message: form.enabled ? "Angel One details saved. Indicators are being updated now." : "Angel One details saved. Automatic updates are off." };
      res.redirect(303, "/admin/settings#set-angel");
    } catch (err) {
      if (!(err instanceof z.ZodError)) return next(err);
      const errors: Record<string, string> = {};
      for (const issue of err.issues) {
        const key = String(issue.path[0] ?? "");
        if (key && !errors[key]) errors[key] = issue.message;
      }
      res.status(400);
      await settingsPage(res, null, {}, null, { errors, clientCode: body.clientCode ?? "", enabled: body.enabled === "on" }).catch(next);
    }
  });

  router.post("/admin/settings/angelone/test", ...page, verifyCsrf, async (_req, res, next) => {
    try {
      const message = await indicators.test();
      await settingsPage(res, null, {}, null, { test: { ok: true, message } });
    } catch (err) {
      res.status(400);
      await settingsPage(res, null, {}, null, { test: { ok: false, message: (err as Error).message.slice(0, 300) } }).catch(next);
    }
  });

  router.get("/admin/login", (req, res) => {
    if (req.session.adminId) return res.redirect(safeNext(req.query.next));
    res.set("Cache-Control", "no-store");
    res.render("admin/login", { error: null, email: "", next: safeNext(req.query.next), csrfToken: getCsrfToken(req) });
  });

  router.post("/admin/login", loginLimiter, verifyCsrf, async (req: Request, res: Response, next: NextFunction) => {
    try {
      const email = typeof req.body.email === "string" ? req.body.email.slice(0, 254) : "";
      const password = typeof req.body.password === "string" ? req.body.password.slice(0, 1024) : "";
      const target = safeNext(req.body.next);
      const admin = email && password ? await authenticateAdmin(pool, email, password) : null;
      if (!admin) {
        res.status(401).render("admin/login", {
          error: "Incorrect email or password.",
          email,
          next: target,
          csrfToken: getCsrfToken(req),
        });
        return;
      }
      // New session id on login (prevents session fixation), then a fresh CSRF token.
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.adminId = admin.id;
        getCsrfToken(req);
        req.session.save((saveErr) => (saveErr ? next(saveErr) : res.redirect(303, target)));
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/logout", verifyCsrf, (req, res, next) => {
    req.session.destroy((err) => {
      if (err) return next(err);
      res.clearCookie("m360x.sid");
      res.redirect(303, "/admin/login");
    });
  });

  router.get("/admin/nifty-alerts", ...page, async (req, res, next) => {
    try {
      const [alerts, angel] = await Promise.all([listAllAlerts(pool), getAngelOneSettings(pool)]);
      res.render("admin/nifty-alerts", {
        // Safe to embed in <script type="application/json">: "<" is escaped so "</script>" cannot appear.
        initialJson: JSON.stringify(alerts).replace(/</g, "\\u003c"),
        indicatorsJson: JSON.stringify(INDICATORS).replace(/</g, "\\u003c"),
        angelReady: Boolean(angel?.enabled),
        lastResult: indicators.lastResult(),
      });
    } catch (err) {
      next(err);
    }
  });

  // ---------- QR checkout orders ----------
  router.get("/admin/orders", ...page, async (_req, res, next) => {
    try {
      const mail = await mailer.status();
      res.render("admin/orders", {
        orders: await listOrders(pool),
        formatInr,
        emailEnabled: mail.configured && mail.notifyOrders,
      });
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/orders/:id/status", requireAdmin(pool, "page"), verifyCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      const status = (req.body as Record<string, unknown>)?.status;
      if (!Number.isSafeInteger(id) || id <= 0 || (status !== "new" && status !== "done")) return res.status(400).send("Bad request");
      const found = await setOrderStatus(pool, id, status);
      req.session.flash = found
        ? { type: "success", message: status === "done" ? `Order #${id} marked as done.` : `Order #${id} moved back to waiting.` }
        : { type: "error", message: "That order no longer exists." };
      res.redirect(303, "/admin/orders");
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/orders/:id/delete", requireAdmin(pool, "page"), verifyCsrf, async (req, res, next) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).send("Bad request");
      const found = await deleteOrder(pool, id);
      req.session.flash = found ? { type: "success", message: `Order #${id} deleted.` } : { type: "error", message: "That order no longer exists." };
      res.redirect(303, "/admin/orders");
    } catch (err) {
      next(err);
    }
  });

  // ---------- Contact page messages ----------
  router.get("/admin/messages", ...page, async (_req, res, next) => {
    try {
      const mail = await mailer.status();
      res.render("admin/messages", {
        messages: await listContactMessages(pool),
        topicLabel,
        emailEnabled: mail.configured && mail.notifyMessages,
      });
    } catch (err) {
      next(err);
    }
  });

  const messageId = (req: Request) => {
    const id = Number(req.params.id);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  };

  router.post("/admin/messages/:id/status", requireAdmin(pool, "page"), verifyCsrf, async (req, res, next) => {
    try {
      const id = messageId(req);
      const status = (req.body as Record<string, unknown>)?.status;
      if (!id || (status !== "new" && status !== "handled")) return res.status(400).send("Bad request");
      const found = await setContactMessageStatus(pool, id, status);
      req.session.flash = found
        ? { type: "success", message: status === "handled" ? "Marked as handled." : "Marked as new." }
        : { type: "error", message: "That message no longer exists." };
      res.redirect(303, "/admin/messages");
    } catch (err) {
      next(err);
    }
  });

  router.post("/admin/messages/:id/delete", requireAdmin(pool, "page"), verifyCsrf, async (req, res, next) => {
    try {
      const id = messageId(req);
      if (!id) return res.status(400).send("Bad request");
      const found = await deleteContactMessage(pool, id);
      req.session.flash = found ? { type: "success", message: "Message deleted." } : { type: "error", message: "That message no longer exists." };
      res.redirect(303, "/admin/messages");
    } catch (err) {
      next(err);
    }
  });

  return router;
}

/** JSON admin API. Every route requires a signed-in admin and, for writes, a valid CSRF token. */
export function adminApiRouter(pool: pg.Pool, indicators: IndicatorService): Router {
  const router = Router();
  router.use(requireAdmin(pool, "api"), verifyCsrf);

  const idParam = z.coerce.number().int().positive();

  router.get("/", async (_req, res, next) => {
    try {
      res.json({ alerts: await listAllAlerts(pool) });
    } catch (err) {
      next(err);
    }
  });

  // "Refresh now": fetch from Angel One and score the automatic indicators
  router.post("/refresh", async (_req, res, next) => {
    try {
      const result = await indicators.refresh();
      res.status(result.ok || result.updated > 0 ? 200 : 502).json({ result, alerts: await listAllAlerts(pool) });
    } catch (err) {
      next(err);
    }
  });

  router.post("/", async (req, res, next) => {
    try {
      const alert = await createAlert(pool, alertInputSchema.parse(req.body));
      res.status(201).json({ alert });
    } catch (err) {
      next(err);
    }
  });

  // Save the whole table at once (used by "Save Changes").
  router.put("/", async (req, res, next) => {
    try {
      const alerts = await saveAllAlerts(pool, bulkSaveSchema.parse(req.body));
      res.json({ alerts });
    } catch (err) {
      next(err);
    }
  });

  router.patch("/:id", async (req, res, next) => {
    try {
      const alert = await updateAlert(pool, idParam.parse(req.params.id), alertPatchSchema.parse(req.body));
      res.json({ alert });
    } catch (err) {
      next(err);
    }
  });

  router.delete("/:id", async (req, res, next) => {
    try {
      await deleteAlert(pool, idParam.parse(req.params.id));
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  // Translate known errors into clear JSON responses.
  router.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (err instanceof z.ZodError) {
      res.status(400).json({
        error: err.issues[0]?.message ?? "Some values are invalid.",
        issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
      });
      return;
    }
    if (err instanceof NotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    next(err);
  });

  return router;
}
