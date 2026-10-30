// Public marketing pages rendered from views/pages/*.ejs.
export interface SitePage {
  view: string;
  route: string;
  /** Key of the header nav item to highlight ("" for none) */
  activeNav: string;
  title: string;
  description: string;
  ogTitle: string;
  /** "m3x-home" on the homepages; "m3x-inner" on the other marketing pages (same section-title rules) */
  bodyClass: string;
  styles: string[];
  /** robots meta (default "index, follow") */
  robots?: string;
}

export const SITE_PAGES: SitePage[] = [
  {
    view: "home",
    route: "/",
    activeNav: "home",
    title: "Market360X | Accurate Trading Alerts for Nifty, Sensex & Options",
    description: "Market360X sends accurate, data-backed trading alerts for Nifty, Bank Nifty, Sensex, options and stocks, each backed by price, open interest, PCR and volume data.",
    ogTitle: "Market360X - Accurate Trading Alerts for Nifty, Sensex and Options",
    bodyClass: "m3x-home m3x-home-v4",
    styles: ["/assets/sentiment.css"],
  },
  {
    view: "about",
    route: "/about",
    activeNav: "about",
    title: "About Us | Market360X",
    description: "Market360X sends accurate, data-backed trading alerts for Nifty, Bank Nifty, Sensex, options and stocks, each backed by price, open interest, PCR and volume data.",
    ogTitle: "Market360X - Accurate Trading Alerts for Nifty, Sensex and Options",
    bodyClass: "m3x-inner",
    styles: [],
  },
  {
    view: "features",
    route: "/features",
    activeNav: "features",
    title: "Features | Market360X",
    description: "Market360X sends accurate, data-backed trading alerts for Nifty, Bank Nifty, Sensex, options and stocks, each backed by price, open interest, PCR and volume data.",
    ogTitle: "Market360X - Accurate Trading Alerts for Nifty, Sensex and Options",
    bodyClass: "m3x-inner",
    styles: [],
  },
  {
    view: "nifty-alert",
    route: "/nifty-alert",
    activeNav: "nifty-alert",
    title: "Nifty Option Alert | Market360X",
    description: "Market360X sends accurate, data-backed trading alerts for Nifty, Bank Nifty, Sensex, options and stocks, each backed by price, open interest, PCR and volume data.",
    ogTitle: "Market360X - Accurate Trading Alerts for Nifty, Sensex and Options",
    bodyClass: "m3x-inner",
    styles: [],
  },
  {
    view: "options",
    route: "/options",
    activeNav: "options",
    title: "Options Trading | Market360X",
    description: "Options give traders the right, but not the obligation, to buy or sell an underlying asset at a set price before a set date. Market360X helps you put unusual activity and price action into context before making your own decision.",
    ogTitle: "Options Trading | Market360X",
    bodyClass: "trading-site m3x-inner",
    styles: ["/assets/trading.css"],
  },
  {
    view: "algo",
    route: "/algo",
    activeNav: "",
    title: "Algo Trading | Market360X",
    description: "Algorithmic trading uses defined rules and market data to identify or execute opportunities. On Market360X, data-backed analysis and alerts support a systematic decision process; the platform does not place trades for you.",
    ogTitle: "Algo Trading | Market360X",
    bodyClass: "trading-site m3x-inner",
    styles: ["/assets/trading.css"],
  },
];

/** Old static-site URLs mapped to their new routes. */
export const LEGACY_REDIRECTS: Record<string, string> = {
  "/index.html": "/",
  "/pricing.html": "/nifty-alert",
  "/about.html": "/about",
  "/features.html": "/features",
  "/nifty-alert.html": "/nifty-alert",
  "/options.html": "/options",
  "/algo.html": "/algo",
  // US stocks and crypto pages removed (2026-10-29): Market360X covers Indian markets only
  "/stocks.html": "/",
  "/crypto.html": "/",
  "/stocks": "/",
  "/crypto": "/",
  // Homepage design previews retired (2026-10-29): the /home-v4 design is now the homepage
  "/home-v2": "/",
  "/home-v3": "/",
  "/home-v4": "/",
};

export interface NavItem {
  key: string;
  label: string;
  href?: string;
  children?: NavItem[];
  /** Mega menu steps (desktop: illustrated columns; mobile menu: names only) */
  steps?: NavStep[];
}

export interface NavStep {
  title: string;
  text: string;
  /** Illustration in public/images/club/ */
  image: string;
}

export const NAV_ITEMS: NavItem[] = [
  { key: "home", label: "Platform", href: "/" },
  {
    key: "options",
    label: "Options Alert",
    href: "/options",
    children: [
      // Same order as the index strip: only Nifty is live; the rest show "Soon".
      { key: "nifty-alert", label: "Nifty Option Alert", href: "/nifty-alert" },
      { key: "sensex-alert", label: "Sensex Option Alert" },
      { key: "bank-nifty-alert", label: "Bank Nifty Option Alert" },
      { key: "fin-nifty-alert", label: "Fin Nifty Option Alert" },
      { key: "bankex-alert", label: "Bankex Option Alert" },
      { key: "midcap-nifty-alert", label: "Midcap Nifty Option Alert" },
    ],
  },
  // Club page is not built yet: the item links to the homepage for now.
  {
    key: "club",
    label: "Market360X Club",
    href: "/",
    steps: [
      { title: "Connect", text: "Meet traders who share setups, ideas and market views every trading day.", image: "/images/club/connect.webp" },
      { title: "Learn", text: "Live sessions, guides and trade breakdowns that build real trading skills.", image: "/images/club/learn.webp" },
      { title: "Analyse", text: "Read the market with data: option chain, open interest and price action, explained.", image: "/images/club/analyze.webp" },
      { title: "Grow Together", text: "Track your progress, share what works and improve as a group, one trade at a time.", image: "/images/club/grow.webp" },
    ],
  },
  { key: "features", label: "Features", href: "/features" },
  { key: "about", label: "About", href: "/about" },
];
