// Header search: the pages (and homepage sections) a visitor can jump to. Bundled into /js/search.js.
export interface SearchPage {
  title: string;
  href: string;
  /** Short line shown under the title */
  summary: string;
  /** Extra words people might type */
  keywords: string;
  /** Not launched yet: listed with a "Soon" tag, not clickable */
  soon?: boolean;
}

export const SEARCH_PAGES: SearchPage[] = [
  { title: "Home", href: "/", summary: "Data-backed trading alerts for Nifty, Sensex and options", keywords: "platform market360x homepage trading alerts" },
  { title: "Nifty Option Alert", href: "/nifty-alert", summary: "Weekly Nifty option alerts backed by market data", keywords: "nifty 50 options alert signals calls puts weekly plan live" },
  { title: "Options Alert", href: "/options", summary: "How options work and how our alerts put them in context", keywords: "options trading index option chain open interest flow" },
  { title: "Pricing", href: "/#pricing", summary: "Nifty option alert plans, priced by the week", keywords: "plans price cost subscribe buy weekly payment upi" },
  { title: "Market Direction of the Day", href: "/#sentiment", summary: "Today's overall Nifty sentiment and the daily trend", keywords: "sentiment bullish bearish neutral nifty direction today trend" },
  { title: "Index charts", href: "/#markets", summary: "Nifty, Sensex, Bank Nifty and more: today, 1 week, 1 month, 1 year", keywords: "chart charts markets index indices price graph nifty sensex bank nifty fin nifty bankex midcap live" },
  { title: "How it works", href: "/#how-it-works", summary: "From alert to trade in four steps", keywords: "steps process getting started how to start" },
  { title: "FAQ", href: "/#faq", summary: "Answers to common questions", keywords: "questions answers help faqs" },
  { title: "Features", href: "/features", summary: "Everything behind every alert", keywords: "features tools data risk real-time alerts" },
  { title: "About Us", href: "/about", summary: "Our vision, mission and commitment", keywords: "about company team vision mission objectives story" },
  { title: "Contact Us", href: "/contact", summary: "Talk to the Market360X team", keywords: "contact support help email phone call message" },
  { title: "Terms & Conditions", href: "/terms-and-conditions", summary: "The terms for using Market360X", keywords: "terms conditions legal policy agreement" },
  { title: "Privacy Policy", href: "/privacy-policy", summary: "How we collect and use your data", keywords: "privacy policy data personal information legal cookies" },
  { title: "Refund Policy", href: "/refund-policy", summary: "Refunds and cancellations", keywords: "refund cancellation money back policy legal" },
  { title: "GDPR Compliance", href: "/gdpr-compliance", summary: "Your data protection rights", keywords: "gdpr data protection rights policy legal" },
  { title: "Risk Disclosure", href: "/risk-disclosure", summary: "Trading risks and SEBI disclaimer", keywords: "risk disclosure sebi disclaimer legal warning" },
  { title: "Sensex Option Alert", href: "", summary: "Coming soon", keywords: "sensex options alert bse", soon: true },
  { title: "Bank Nifty Option Alert", href: "", summary: "Coming soon", keywords: "bank nifty banknifty options alert", soon: true },
  { title: "Fin Nifty Option Alert", href: "", summary: "Coming soon", keywords: "fin nifty finnifty options alert", soon: true },
  { title: "Bankex Option Alert", href: "", summary: "Coming soon", keywords: "bankex options alert", soon: true },
  { title: "Midcap Nifty Option Alert", href: "", summary: "Coming soon", keywords: "midcap nifty midcpnifty options alert", soon: true },
  { title: "Market360X Club", href: "", summary: "Connect, learn, analyse and grow together. Coming soon", keywords: "club community connect learn analyse analyze grow", soon: true },
];

const normalize = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Pages matching every word of the query, best first: title start, then a title word, then anywhere in
 * the title, summary or keywords. Launched pages rank above "Soon" ones with the same score.
 */
export function searchPages(query: string, pages: SearchPage[] = SEARCH_PAGES, limit = 6): SearchPage[] {
  const words = normalize(query).split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const scored: { page: SearchPage; score: number; index: number }[] = [];
  pages.forEach((page, index) => {
    const title = normalize(page.title);
    const titleWords = title.split(" ");
    const text = `${title} ${normalize(page.summary)} ${normalize(page.keywords)}`;
    let score = 0;
    for (const w of words) {
      if (!text.includes(w)) return;
      if (title.startsWith(w)) score += 4;
      else if (titleWords.some((t) => t.startsWith(w))) score += 3;
      else if (title.includes(w)) score += 2;
      else score += 1;
    }
    if (page.soon) score -= 0.5;
    scored.push({ page, score, index });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((s) => s.page);
}
