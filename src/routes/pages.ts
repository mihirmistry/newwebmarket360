import { Router } from "express";
import type pg from "pg";
import { getPublicSentiment, type PublicSentiment } from "../services/alerts.js";
import { alertShares, chartBarWidth, chartScale, donutSegments, formatIstDateTime, trendChartHtml } from "../shared/format.js";
import { formatPercent, formatSignal } from "../shared/sentiment.js";
import { LEGACY_REDIRECTS, NAV_ITEMS, SITE_PAGES } from "../site/pages.js";
import { PLANS } from "../site/plans.js";
import { TERMINAL_SESSION } from "../site/terminal-snapshot.js";
import { LEGAL_PAGES, LEGAL_UPDATED } from "../site/legal.js";
import { pageLocals } from "./page-locals.js";

const fmt = { formatPercent, formatSignal, formatIstDateTime, donutSegments, alertShares, trendChartHtml, chartScale, chartBarWidth };

export function pagesRouter(pool: pg.Pool): Router {
  const router = Router();

  // Old static-site URLs (bookmarks, search results) keep working.
  for (const [from, to] of Object.entries(LEGACY_REDIRECTS)) {
    router.get(from, (_req, res) => res.redirect(301, to));
  }

  for (const page of SITE_PAGES) {
    router.get(page.route, async (_req, res, next) => {
      try {
        // Every page shows the header "Market ±N%" badge; the homepage also shows the full dashboard.
        let sentimentData: PublicSentiment | null = null;
        try {
          sentimentData = await getPublicSentiment(pool);
        } catch (err) {
          // Render the page anyway; the badge/dashboard show an error state and retry in the browser.
          console.error("sentiment render failed:", (err as Error).message);
        }
        // With customer accounts on, every page has the log in / sign up popup (plan buttons and "Log in" open it).
        // With them off (for now), plan buttons go straight to the QR checkout.
        const accounts = Boolean(res.app.locals.features?.customerAccounts);
        const signedIn = Boolean(res.locals.account);
        const scripts =
          page.view === "home"
            ? ["/js/dashboard.js", "/js/stack.js", "/js/showcase.js", "/js/index-chart.js", "/js/terminal-cards.js", "/js/tabs.js"]
            : page.view === "features"
              ? ["/js/indicator.js", "/js/terminal-cards.js"] // same alert cards as the homepage
              : ["/js/indicator.js"];
        if (accounts) scripts.push("/js/auth.js");
        // Signed-in pages show the customer's name in the header: never let a shared cache keep them.
        res.set("Cache-Control", signedIn ? "private, no-store" : "no-cache");
        res.vary("Cookie");
        res.render(`pages/${page.view}`, {
          ...page,
          styles: [...page.styles, "/assets/account.css"],
          authModal: accounts,
          plans: PLANS,
          nav: { items: NAV_ITEMS },
          scripts,
          sentimentData,
          headerSentiment: sentimentData?.sentiment ?? null,
          renderedAt: new Date().toISOString(),
          terminal: TERMINAL_SESSION,
          fmt,
        });
      } catch (err) {
        next(err);
      }
    });
  }

  // Legal policies (linked from the footer): one template, content in src/site/legal.ts.
  for (const legal of LEGAL_PAGES) {
    router.get(legal.route, async (_req, res, next) => {
      try {
        const accounts = Boolean(res.app.locals.features?.customerAccounts);
        res.set("Cache-Control", res.locals.account ? "private, no-store" : "no-cache");
        res.vary("Cookie");
        res.render("pages/legal", {
          ...(await pageLocals(pool, legal.label, legal.summary)),
          bodyClass: "m3x-inner",
          scripts: accounts ? ["/js/indicator.js", "/js/auth.js"] : ["/js/indicator.js"],
          authModal: accounts,
          plans: PLANS,
          legal,
          legalUpdated: LEGAL_UPDATED,
        });
      } catch (err) {
        next(err);
      }
    });
  }

  return router;
}
