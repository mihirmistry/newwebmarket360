import path from "node:path";
import compression from "compression";
import connectPgSimple from "connect-pg-simple";
import express, { type NextFunction, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import session from "express-session";
import helmet from "helmet";
import type pg from "pg";
import type { AppConfig } from "./config.js";
import { loadAccount } from "./middleware/account.js";
import { accountApiRouter, accountPagesRouter } from "./routes/account.js";
import { adminApiRouter, adminPagesRouter } from "./routes/admin.js";
import { checkoutRouter } from "./routes/checkout.js";
import { contactRouter } from "./routes/contact.js";
import { pagesRouter } from "./routes/pages.js";
import { getPublicSentiment } from "./services/alerts.js";
import { createIndicatorService, type IndicatorService } from "./services/auto-indicators.js";
import { createMailer, type Mailer } from "./services/mailer.js";
import { INDICES, createYahooMarketQuotes, disabledMarketQuotes, type MarketQuotes } from "./services/market-quotes.js";
import { HISTORY_RANGES, createYahooMarketHistory, disabledMarketHistory, type HistoryRange, type MarketHistory } from "./services/market-history.js";
import { directionArrow, formatIndexChange, formatIndexPrice } from "./shared/ticker-format.js";
import { PASSWORD_RULES } from "./shared/customer-rules.js";
import { icon } from "./site/icons.js";
import { NAV_ITEMS } from "./site/pages.js";

const ROOT = process.cwd();

export interface AppOptions {
  /** Index quotes for the header ticker. Defaults to Yahoo Finance (switched off in tests). */
  marketQuotes?: MarketQuotes;
  /** Index price history for the homepage chart. Defaults to Yahoo Finance (switched off in tests). */
  marketHistory?: MarketHistory;
  /** Emails orders/messages to the admin. Defaults to the SMTP details saved in Admin > Settings (or .env). */
  mailer?: Mailer;
  /** Automatic indicators from Angel One SmartAPI. server.ts starts its schedule (app.locals.indicators). */
  indicators?: IndicatorService;
}

export function createApp(config: AppConfig, pool: pg.Pool, options: AppOptions = {}): express.Express {
  const app = express();
  const marketQuotes = options.marketQuotes ?? (config.NODE_ENV === "test" ? disabledMarketQuotes : createYahooMarketQuotes());
  // "Today" is measured from the same previous close as the header strip
  const previousClose = async (id: string) => {
    const q = (await marketQuotes.get())?.indices.find((i) => i.id === id);
    return q ? q.price - q.change : undefined;
  };
  const marketHistory =
    options.marketHistory ?? (config.NODE_ENV === "test" ? disabledMarketHistory : createYahooMarketHistory({ previousClose }));
  const mailer = options.mailer ?? createMailer(config, pool);
  const indicators = options.indicators ?? createIndicatorService(pool, config.SESSION_SECRET);
  const accounts = config.CUSTOMER_ACCOUNTS; // customer log in / sign up / dashboard (off for now)
  const isProd = config.NODE_ENV === "production";

  app.disable("x-powered-by");
  if (config.TRUST_PROXY) app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(ROOT, "views"));
  app.locals.features = { customerAccounts: accounts };
  app.locals.indicators = indicators;
  app.locals.icon = icon; // <%- icon("name") %> in any view
  app.locals.passwordRules = PASSWORD_RULES.map(({ id, label }) => ({ id, label }));
  app.locals.indexList = INDICES.map(({ id, label }) => ({ id, label }));
  app.locals.tickerFormat = { price: formatIndexPrice, change: formatIndexChange, arrow: directionArrow };

  // gzip HTML, CSS, JS and JSON (main.css is ~300 KB raw, ~45 KB compressed)
  app.use(compression());

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          "default-src": ["'self'"],
          "script-src": ["'self'"],
          "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
          "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
          "img-src": ["'self'", "data:", "blob:"],
          "connect-src": ["'self'"],
          "frame-ancestors": ["'none'"],
          "form-action": ["'self'"],
          "upgrade-insecure-requests": isProd ? [] : null,
        },
      },
      hsts: isProd,
    })
  );

  // Static files. Long cache for fingerprint-free assets is kept modest so edits show up quickly.
  app.use(express.static(path.join(ROOT, "public"), { maxAge: isProd ? "1d" : 0, index: false }));

  // ---------- public API ----------
  const publicApiLimiter = rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false });
  app.get("/api/nifty-sentiment", publicApiLimiter, async (_req, res, next) => {
    try {
      res.set("Cache-Control", "no-store");
      res.json(await getPublicSentiment(pool));
    } catch (err) {
      next(err);
    }
  });

  // Header ticker strip: NIFTY, SENSEX, BANKNIFTY, FINNIFTY, BANKEX, MIDCPNIFTY (cached ~60s on the server).
  app.get("/api/market/indices", publicApiLimiter, async (_req, res, next) => {
    try {
      const quotes = await marketQuotes.get();
      if (!quotes) {
        res.set("Cache-Control", "no-store").status(503).json({ error: "Market data is temporarily unavailable." });
        return;
      }
      res.set("Cache-Control", "public, max-age=30").json(quotes);
    } catch (err) {
      next(err);
    }
  });
  // Homepage index chart: ?index=nifty|sensex|banknifty|finnifty|bankex|midcpnifty & range=1d|1w|1m|1y
  app.get("/api/market/history", publicApiLimiter, async (req, res, next) => {
    try {
      const id = String(req.query.index ?? "");
      const range = String(req.query.range ?? "1d") as HistoryRange;
      if (!INDICES.some((d) => d.id === id) || !HISTORY_RANGES.includes(range)) {
        res.status(400).json({ error: "Unknown index or range." });
        return;
      }
      const history = await marketHistory.get(id, range);
      if (!history) {
        res.set("Cache-Control", "no-store").status(503).json({ error: "Chart data is temporarily unavailable." });
        return;
      }
      res.set("Cache-Control", `public, max-age=${range === "1d" ? 30 : 300}`).json(history);
    } catch (err) {
      next(err);
    }
  });
  // Pages render the strip from whatever is cached (never waiting on the data source); the browser keeps it fresh.
  app.use((req, res, next) => {
    res.locals.ticker = req.path.startsWith("/api/") || req.path.startsWith("/admin") ? null : marketQuotes.peek();
    next();
  });

  // ---------- admin + customer accounts ----------
  const PgStore = connectPgSimple(session);
  const sessionMiddleware = session({
    name: "m360x.sid",
    store: new PgStore({ pool, tableName: "user_sessions", pruneSessionInterval: 60 * 60 }),
    secret: config.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: isProd,
      maxAge: 8 * 60 * 60 * 1000, // 8 hours of inactivity
      path: "/",
    },
  });
  const forms = express.urlencoded({ extended: false, limit: "10kb" });
  const json = express.json({ limit: "100kb" });

  // Sessions are only created on sign-in (saveUninitialized: false), so visitors who never sign in get no cookie.
  // They are read on every page so the header can show the signed-in customer's profile menu.
  app.use(sessionMiddleware);
  if (accounts) {
    app.use(loadAccount(pool));
  } else {
    app.use((_req, res, next) => {
      res.locals.customer = null;
      res.locals.account = null;
      next();
    });
  }
  app.use(forms, adminPagesRouter(config, pool, mailer, indicators));
  app.use("/api/admin/nifty-alerts", json, adminApiRouter(pool, indicators));
  if (accounts) {
    app.use("/api/account", json, accountApiRouter(pool));
    app.use(accountPagesRouter(pool));
  }
  app.use(checkoutRouter(config, pool, mailer));
  app.use(contactRouter(pool, mailer));

  // ---------- marketing pages ----------
  app.use(pagesRouter(pool));

  // ---------- 404 & errors ----------
  app.use((req: Request, res: Response) => {
    if (req.path.startsWith("/api/")) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.status(404).render("errors/404", {
      title: "Page not found | Market360X",
      description: "The page you were looking for could not be found.",
      ogTitle: "Market360X",
      bodyClass: "",
      styles: ["/assets/sentiment.css"],
      scripts: [],
      nav: { items: NAV_ITEMS },
      activeNav: "",
    });
  });

  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status = (err as { status?: number; statusCode?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) console.error(err);
    if (req.path.startsWith("/api/") || req.accepts(["html", "json"]) === "json") {
      res.status(status).json({ error: status >= 500 ? "Something went wrong on our side. Please try again." : "Bad request" });
      return;
    }
    res.status(status).render("errors/500", { status });
  });

  return app;
}
