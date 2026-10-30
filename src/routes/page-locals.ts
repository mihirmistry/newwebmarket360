import type pg from "pg";
import { getPublicSentiment, type PublicSentiment } from "../services/alerts.js";
import { formatIstDateTime } from "../shared/format.js";
import { formatPercent } from "../shared/sentiment.js";
import { NAV_ITEMS } from "../site/pages.js";

/** Shared locals for pages that use the site header/footer. */
export async function pageLocals(pool: pg.Pool, title: string, description: string) {
  let sentimentData: PublicSentiment | null = null;
  try {
    sentimentData = await getPublicSentiment(pool);
  } catch {
    /* header badge / sentiment card show their empty state */
  }
  return {
    title: `${title} | Market360X`,
    description,
    ogTitle: "Market360X",
    bodyClass: "",
    styles: ["/assets/account.css"],
    scripts: ["/js/indicator.js"],
    nav: { items: NAV_ITEMS },
    activeNav: "",
    sentimentData,
    headerSentiment: sentimentData?.sentiment ?? null,
    fmt: { formatPercent, formatIstDateTime },
  };
}
