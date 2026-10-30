// Legal policy pages (Terms, Privacy, Refund, GDPR, Risk Disclosure), rendered by views/pages/legal.ejs.
// Section bodies are trusted, server-authored HTML. Keep the business details below in one place.
import { PLANS } from "./plans.js";

export const LEGAL_UPDATED = "22 October 2026";

/** SEBI disclaimer wording supplied by Market360X; also used in the site footer. */
export const SEBI_NON_REGISTRATION = "We are not registered with SEBI as an Investment Adviser or Research Analyst.";
export const EDUCATIONAL_ONLY =
  "All market data, charts, indicators, trading signals, alerts, and analysis provided on this website are strictly for educational and informational purposes and do not constitute investment advice or recommendations.";

const COMPANY = {
  name: "Market360X",
  address: "423, Tower-B, Logix Techno Park, Sector-127, Noida, Delhi NCR - 201313, India",
  email: "contact@market360x.com",
  phone: "+91 92113 84013",
  phoneHref: "+919211384013",
};

const mail = `<a href="mailto:${COMPANY.email}">${COMPANY.email}</a>`;
const phone = `<a href="tel:${COMPANY.phoneHref}">${COMPANY.phone}</a>`;
const planList = PLANS.map((p) => `<li><strong>${p.name}</strong>: ₹${p.price.toLocaleString("en-IN")} for ${p.validity}</li>`).join("");
const contactBlock = `
  <ul class="m3x-legal-contact">
    <li><strong>Email:</strong> ${mail}</li>
    <li><strong>Phone:</strong> ${phone}</li>
    <li><strong>Address:</strong> ${COMPANY.address}</li>
  </ul>`;

export interface LegalSection {
  id: string;
  heading: string;
  html: string;
}

export interface LegalPage {
  key: string;
  route: string;
  /** Short name used in the footer and the page title */
  label: string;
  heading: string;
  summary: string;
  sections: LegalSection[];
}

const terms: LegalPage = {
  key: "terms",
  route: "/terms-and-conditions",
  label: "Terms & Conditions",
  heading: "Terms & Conditions",
  summary: "The rules for using the Market360X website and our trading alert plans. Please read them before you subscribe.",
  sections: [
    {
      id: "about",
      heading: "About these terms",
      html: `<p>These Terms &amp; Conditions ("Terms") apply to your use of the Market360X website and to every Market360X alert plan. "Market360X", "we", "us" and "our" mean the business operating this website from ${COMPANY.address}. "You" means any visitor or subscriber.</p>
      <p>By using the website, submitting a checkout form or paying for a plan, you agree to these Terms, our <a href="/privacy-policy">Privacy Policy</a>, <a href="/refund-policy">Refund Policy</a> and <a href="/risk-disclosure">Risk Disclosure</a>. If you do not agree, please do not use the service.</p>`,
    },
    {
      id: "service",
      heading: "What Market360X provides",
      html: `<p>Market360X sends data-backed trading alerts for Indian markets. Nifty Option Alert is available now; alerts for Sensex, Bank Nifty, Fin Nifty, Bankex and Midcap Nifty options are marked "Soon" and are not yet part of any plan.</p>
      <p>Each alert describes a market condition picked up by our data, such as the direction of the Nifty and the signals behind it. Alerts do not include entry, target or stop-loss levels and are not buy or sell recommendations. Alerts are delivered through the channels we tell you about when your plan is activated, such as Telegram, WhatsApp or email.</p>
      <p>Market360X <strong>does not</strong> place trades for you, connect to your broker, ask for your broker password or hold your money. You decide whether to act on an alert and you place every trade yourself.</p>`,
    },
    {
      id: "no-advice",
      heading: "SEBI non-registration and no investment advice",
      html: `<p class="m3x-legal-callout">${SEBI_NON_REGISTRATION}</p>
      <p>${EDUCATIONAL_ONLY} Our alerts are general market information based on price, open interest, option-chain and volume data. They do not take into account your income, savings, goals, experience or risk appetite.</p>
      <p>Investments in securities markets are subject to market risks. You should conduct your own research and consult a SEBI-registered Investment Adviser before investing. We do not guarantee accuracy, returns, or profitability and shall not be liable for any losses arising from reliance on this information, subject to applicable law. Past performance is not indicative of future results.</p>
      <p>Read our <a href="/risk-disclosure">Risk Disclosure</a> before you trade.</p>`,
    },
    {
      id: "eligibility",
      heading: "Who can subscribe",
      html: `<ul>
        <li>You must be at least 18 years old and legally able to enter into a contract under the Indian Contract Act, 1872.</li>
        <li>You must give accurate details (name, email, phone number and trading experience) at checkout and keep them up to date.</li>
        <li>You are responsible for making sure that trading in the instruments covered by our alerts is lawful for you.</li>
      </ul>`,
    },
    {
      id: "plans",
      heading: "Plans, payment and activation",
      html: `<p>The current Nifty Option Alert plans are:</p>
      <ul>${planList}</ul>
      <p>Prices are shown in Indian rupees on the <a href="/nifty-alert">Nifty Option Alert</a> page, and the price shown at checkout is the price you pay. We may change prices for future purchases; a change never affects a plan you have already paid for.</p>
      <ul>
        <li><strong>Payment:</strong> plans are currently paid by scanning our UPI QR code at checkout. After paying, you submit the checkout form with your details and your UPI transaction reference (UTR).</li>
        <li><strong>Activation:</strong> once we have verified your payment, we create your access and email your login details, normally within 24 hours. Your plan's validity starts on the day it is activated.</li>
        <li><strong>No auto-renewal:</strong> plans do not renew automatically and we never charge you again without you paying for a new plan.</li>
      </ul>`,
    },
    {
      id: "account",
      heading: "Your access is personal",
      html: `<p>Your plan and login details are for you alone. You must not share, sell or transfer them, or let anyone else use your access. Keep your login details safe and tell us straight away at ${mail} if you think someone else has used them.</p>`,
    },
    {
      id: "acceptable-use",
      heading: "Acceptable use",
      html: `<p>When you use Market360X you agree not to:</p>
      <ul>
        <li>copy, forward, publish, resell or share our alerts, for example in Telegram or WhatsApp groups, social media or other paid services;</li>
        <li>scrape, crawl, reverse engineer or copy any part of the website or service;</li>
        <li>try to break, overload or get unauthorised access to the website, our systems or other users' data;</li>
        <li>use the service for anything unlawful, misleading or harmful.</li>
      </ul>
      <p>If you break these rules we may suspend or end your access without a refund.</p>`,
    },
    {
      id: "ip",
      heading: "Intellectual property",
      html: `<p>The Market360X name, logo, website design, text, charts and alerts belong to Market360X or its licensors. Your plan gives you a personal, non-transferable right to view and use the alerts for your own trading during your plan's validity. No other rights are granted.</p>`,
    },
    {
      id: "availability",
      heading: "Market data and availability",
      html: `<p>Our alerts and the index prices shown on the website rely on market data from third-party sources, which can be delayed, incomplete or wrong. We work hard to keep alerts accurate and on time but we cannot guarantee that every alert will be correct, timely or profitable.</p>
      <p>No alerts are sent on market holidays or when exchanges are closed. Alerts may also be delayed or missed because of internet, device, messaging-app or other outages outside our control. We may change or improve the service, the alert channels and the markets covered.</p>`,
    },
    {
      id: "liability",
      heading: "Limitation of liability",
      html: `<p>To the fullest extent allowed by law:</p>
      <ul>
        <li>Market360X is not responsible for any trading losses, lost profits or other losses that come from acting, or not acting, on an alert or any other information on the website.</li>
        <li>We are not responsible for indirect or consequential losses, or for problems caused by your broker, your internet connection, your device or third-party messaging apps.</li>
        <li>Our total liability to you for any claim about the service is limited to the amount you paid us for the plan the claim relates to.</li>
      </ul>
      <p>Nothing in these Terms limits any liability that cannot be limited under Indian law.</p>`,
    },
    {
      id: "indemnity",
      heading: "Indemnity",
      html: `<p>You agree to compensate Market360X for any claims, losses or costs (including reasonable legal fees) caused by your breach of these Terms, your misuse of the service or your sharing of our alerts.</p>`,
    },
    {
      id: "termination",
      heading: "Suspension and termination",
      html: `<p>We may suspend or end your access if you break these Terms, if we suspect fraud or misuse, or if we are required to by law. You can stop using the service at any time. Refunds are handled under our <a href="/refund-policy">Refund Policy</a>.</p>`,
    },
    {
      id: "changes",
      heading: "Changes to these terms",
      html: `<p>We may update these Terms from time to time. The "Last updated" date at the top of this page shows when they last changed. If you keep using the service after an update, the new Terms apply to you.</p>`,
    },
    {
      id: "law",
      heading: "Governing law and disputes",
      html: `<p>These Terms are governed by the laws of India. Please contact us first so we can try to resolve any complaint. If a dispute cannot be resolved, the courts at Gautam Buddh Nagar (Noida), Uttar Pradesh will have exclusive jurisdiction.</p>`,
    },
    {
      id: "contact",
      heading: "Contact us",
      html: `<p>For questions about these Terms or to raise a complaint, contact us:</p>${contactBlock}`,
    },
  ],
};

const privacy: LegalPage = {
  key: "privacy",
  route: "/privacy-policy",
  label: "Privacy Policy",
  heading: "Privacy Policy",
  summary: "What personal information Market360X collects, why we collect it, who we share it with and the choices you have.",
  sections: [
    {
      id: "who-we-are",
      heading: "Who we are",
      html: `<p>Market360X ("we", "us") runs this website and our trading alert plans from ${COMPANY.address}. We decide how and why your personal information is used, which makes us the data fiduciary under India's Digital Personal Data Protection Act, 2023 (and the data controller under the GDPR, where it applies).</p>
      <p>This policy explains what we collect and how we use it. If you have any questions, email ${mail}.</p>`,
    },
    {
      id: "what-we-collect",
      heading: "Information we collect",
      html: `<p><strong>When you buy a plan (checkout form):</strong></p>
      <ul>
        <li>your full name, email address and mobile number;</li>
        <li>your years of trading experience;</li>
        <li>the plan you chose, the amount and your UPI transaction reference (UTR).</li>
      </ul>
      <p><strong>When you contact us (contact form or email):</strong> your name, email address, phone number (optional), the topic you choose and your message.</p>
      <p><strong>Technical information:</strong> your IP address and basic browser details, which our servers process to keep the website secure, prevent spam and abuse, and fix errors.</p>
      <p><strong>What we do not collect:</strong> we never ask for your bank login, card details, UPI PIN or broker password. UPI payments are made in your own UPI app; we only see that a payment was received and its reference.</p>`,
    },
    {
      id: "how-we-use",
      heading: "How we use your information",
      html: `<ul>
        <li>to verify your payment, activate your plan and email your login details;</li>
        <li>to deliver alerts and service messages, such as plan expiry reminders, through the channels you join;</li>
        <li>to reply to your messages and give support;</li>
        <li>to keep the website and service secure and to prevent fraud, spam and misuse;</li>
        <li>to keep records required by tax and accounting laws.</li>
      </ul>
      <p>We do <strong>not</strong> sell your personal information, and we do not use it for third-party advertising.</p>`,
    },
    {
      id: "legal-basis",
      heading: "Why we are allowed to use it",
      html: `<p>We process your information with your consent, which you give when you submit a form on this website, and for legitimate uses allowed by law, such as providing the plan you asked for, keeping our systems secure and meeting legal obligations. You can withdraw consent at any time (see <a href="#your-rights">Your rights</a>); this does not affect anything we did before you withdrew it, and we may no longer be able to provide your plan.</p>`,
    },
    {
      id: "sharing",
      heading: "Who we share it with",
      html: `<p>We share personal information only when we need to, with:</p>
      <ul>
        <li><strong>Service providers</strong> who host our website and database and send our emails. They may only use your information to provide their service to us.</li>
        <li><strong>Messaging platforms</strong> such as Telegram or WhatsApp, when you choose to join our alert channels there. Their own privacy policies apply to your use of those apps.</li>
        <li><strong>Google Fonts</strong>, which serves the fonts used on this website and so receives your IP address when pages load.</li>
        <li><strong>Authorities</strong>, when the law, a court or a government body requires it, or to protect our rights and users' safety.</li>
      </ul>`,
    },
    {
      id: "cookies",
      heading: "Cookies and local storage",
      html: `<p>We keep cookies to a minimum and use no advertising or tracking cookies.</p>
      <ul>
        <li><strong>m360x.sid</strong>: a strictly necessary session cookie, set only when you use a form such as checkout or contact. It protects the form against forgery and expires after 8 hours of inactivity.</li>
        <li><strong>m3x-theme</strong>: saved in your browser's local storage to remember whether you chose light or dark mode. It never leaves your device.</li>
      </ul>
      <p>You can clear or block these in your browser settings, but forms may not work without the session cookie.</p>`,
    },
    {
      id: "retention",
      heading: "How long we keep it",
      html: `<ul>
        <li><strong>Plan orders:</strong> for as long as your plan is active and afterwards for as long as tax and accounting laws require.</li>
        <li><strong>Contact messages:</strong> up to 24 months, unless we need them longer to handle a complaint or dispute.</li>
        <li><strong>Security logs:</strong> for a short period, only as long as needed to keep the service secure.</li>
      </ul>
      <p>When we no longer need information, we delete or anonymise it.</p>`,
    },
    {
      id: "security",
      heading: "How we protect it",
      html: `<p>We use encrypted connections (HTTPS), restrict access to personal information to authorised team members, store passwords as one-way hashes and encrypt sensitive settings. No system is perfectly secure, but if a breach affects your information we will tell you and the authorities as the law requires.</p>`,
    },
    {
      id: "your-rights",
      heading: "Your rights",
      html: `<p>Under India's Digital Personal Data Protection Act, 2023 you can:</p>
      <ul>
        <li>ask for a summary of the personal information we hold about you and how we use it;</li>
        <li>ask us to correct, complete, update or delete your information;</li>
        <li>withdraw your consent;</li>
        <li>nominate another person to exercise your rights if you die or become unable to;</li>
        <li>raise a grievance with us and, if you are not satisfied, complain to the Data Protection Board of India.</li>
      </ul>
      <p>Visitors in the EU, EEA or UK have further rights described on our <a href="/gdpr-compliance">GDPR Compliance</a> page. To use any of these rights, email ${mail}. We may ask you to confirm your identity first.</p>`,
    },
    {
      id: "children",
      heading: "Children",
      html: `<p>Market360X is only for adults. We do not knowingly collect information from anyone under 18. If you think a child has given us their details, contact us and we will delete them.</p>`,
    },
    {
      id: "transfers",
      heading: "Where your information is stored",
      html: `<p>Our service providers may store or process information on servers in India or in other countries. When that happens, we take steps to make sure your information stays protected as described in this policy and as the law requires.</p>`,
    },
    {
      id: "changes",
      heading: "Changes to this policy",
      html: `<p>We may update this policy from time to time. The "Last updated" date at the top of this page shows when it last changed. If we make important changes, we will let subscribers know by email.</p>`,
    },
    {
      id: "grievance",
      heading: "Grievance officer and contact",
      html: `<p>For privacy questions, requests or complaints, contact our grievance officer. We aim to reply within 7 working days and to resolve grievances within 30 days.</p>${contactBlock}`,
    },
  ],
};

const refund: LegalPage = {
  key: "refund",
  route: "/refund-policy",
  label: "Refund Policy",
  heading: "Refund Policy",
  summary: "When you can get a refund for a Market360X plan, when you can't, and how to ask for one.",
  sections: [
    {
      id: "overview",
      heading: "Overview",
      html: `<p>Market360X plans give you instant access to digital alerts, so we cannot take them back once they have been delivered. That is why we offer a low-cost Weekly plan: you can try our alerts before choosing a longer plan. This policy explains the cases where we do give refunds.</p>
      <p>Plans <strong>do not renew automatically</strong>, so you will never be charged again unless you pay for a new plan yourself.</p>`,
    },
    {
      id: "eligible",
      heading: "When you can get a refund",
      html: `<p>You are entitled to a <strong>full refund</strong> if:</p>
      <ul>
        <li>you paid but we have not activated your plan within 72 hours of receiving your checkout form, and you ask us to cancel it;</li>
        <li>you paid twice for the same order by mistake (we refund the duplicate payment);</li>
        <li>you paid more than the plan price (we refund the extra amount);</li>
        <li>we cannot activate your plan for any reason on our side.</li>
      </ul>`,
    },
    {
      id: "not-eligible",
      heading: "When refunds are not given",
      html: `<ul>
        <li>after your plan has been activated and your login details have been sent, including if you only used part of the plan;</li>
        <li>because of trading losses or results you were not happy with. Alerts are information, not a guarantee of profit;</li>
        <li>if you missed alerts because of your own device, internet connection or notification settings, or because you left an alert channel;</li>
        <li>if your access was suspended or ended because you broke our <a href="/terms-and-conditions">Terms &amp; Conditions</a>, for example by sharing alerts or login details.</li>
      </ul>`,
    },
    {
      id: "service-issues",
      heading: "If our service goes down",
      html: `<p>If a fault on our side stops alerts from being delivered for a full trading day or more, we will extend your plan by the number of trading days affected. Extensions are given instead of cash refunds for active plans.</p>`,
    },
    {
      id: "how-to-request",
      heading: "How to ask for a refund",
      html: `<p>Email ${mail} within <strong>7 days of your payment</strong> with:</p>
      <ul>
        <li>your full name, email address and mobile number used at checkout;</li>
        <li>the plan you bought and the amount paid;</li>
        <li>your UPI transaction reference (UTR) or a screenshot of the payment;</li>
        <li>the reason for your request.</li>
      </ul>`,
    },
    {
      id: "processing",
      heading: "How refunds are processed",
      html: `<p>We review every request within 3 working days and email you our decision. Approved refunds are sent to the same UPI account or bank account the payment came from, normally within 5 to 7 working days. Your bank may take a little longer to show the money in your account.</p>`,
    },
    {
      id: "contact",
      heading: "Contact us",
      html: `<p>Questions about a payment or refund? We're happy to help:</p>${contactBlock}`,
    },
  ],
};

const gdpr: LegalPage = {
  key: "gdpr",
  route: "/gdpr-compliance",
  label: "GDPR Compliance",
  heading: "GDPR Compliance",
  summary: "How Market360X protects the personal data of visitors from the European Union, the EEA and the United Kingdom.",
  sections: [
    {
      id: "commitment",
      heading: "Our commitment",
      html: `<p>Market360X is based in India and our service is aimed at traders in Indian markets. Our main data protection law is India's Digital Personal Data Protection Act, 2023. When we process the personal data of people in the European Union, the European Economic Area or the United Kingdom, we also follow the General Data Protection Regulation (GDPR and UK GDPR) where it applies.</p>
      <p>This page explains how. It works together with our <a href="/privacy-policy">Privacy Policy</a>, which describes exactly what data we collect.</p>`,
    },
    {
      id: "controller",
      heading: "Data controller",
      html: `<p>Market360X is the data controller for personal data collected through this website. You can reach us at:</p>${contactBlock}`,
    },
    {
      id: "principles",
      heading: "The principles we follow",
      html: `<ul>
        <li><strong>Lawful, fair and transparent:</strong> we tell you what we collect and why.</li>
        <li><strong>Purpose limitation:</strong> we use data only for the purposes described in our Privacy Policy.</li>
        <li><strong>Data minimisation:</strong> we ask only for what we need, such as your name, email, phone and trading experience at checkout.</li>
        <li><strong>Accuracy:</strong> we correct data when you tell us it is wrong.</li>
        <li><strong>Storage limitation:</strong> we keep data only as long as we need it.</li>
        <li><strong>Security:</strong> we protect data with encryption and restricted access.</li>
      </ul>`,
    },
    {
      id: "lawful-bases",
      heading: "Lawful bases for processing",
      html: `<ul>
        <li><strong>Contract:</strong> to verify your payment, activate your plan and deliver alerts.</li>
        <li><strong>Legitimate interests:</strong> to reply to your messages, keep the website secure and prevent fraud and spam.</li>
        <li><strong>Legal obligation:</strong> to keep payment records required by tax and accounting laws.</li>
        <li><strong>Consent:</strong> for anything optional, which you can withdraw at any time.</li>
      </ul>`,
    },
    {
      id: "rights",
      heading: "Your rights under the GDPR",
      html: `<ul>
        <li><strong>Access:</strong> get a copy of the personal data we hold about you.</li>
        <li><strong>Rectification:</strong> have inaccurate or incomplete data corrected.</li>
        <li><strong>Erasure:</strong> ask us to delete your data, unless we must keep it by law.</li>
        <li><strong>Restriction:</strong> ask us to limit how we use your data.</li>
        <li><strong>Portability:</strong> receive your data in a commonly used, machine-readable format.</li>
        <li><strong>Objection:</strong> object to processing based on our legitimate interests.</li>
        <li><strong>Withdraw consent:</strong> at any time, for processing based on consent.</li>
        <li><strong>Complain:</strong> to the data protection authority in your country.</li>
      </ul>
      <p>We do not make decisions about you based solely on automated processing that have legal or similarly significant effects.</p>`,
    },
    {
      id: "requests",
      heading: "How to make a request",
      html: `<p>Email ${mail} with the subject "GDPR request" and tell us which right you want to use. We may ask you to confirm your identity. We will reply within one month; if your request is complex we may extend this by up to two more months and will tell you why. Requests are free unless they are clearly unfounded or excessive.</p>`,
    },
    {
      id: "transfers",
      heading: "International transfers",
      html: `<p>Your data is processed in India and by service providers who may be located in other countries. Where the GDPR requires it, we use appropriate safeguards for these transfers, such as the European Commission's Standard Contractual Clauses.</p>`,
    },
    {
      id: "processors",
      heading: "Service providers (processors)",
      html: `<p>We use trusted providers to host our website and database and to send emails. They process personal data only on our instructions, must keep it secure and confidential, and may not use it for their own purposes.</p>`,
    },
    {
      id: "cookies",
      heading: "Cookies",
      html: `<p>We use only a strictly necessary session cookie for form security and a local-storage setting for light or dark mode. We do not use advertising, analytics or tracking cookies, so no cookie consent is needed for them. See <a href="/privacy-policy#cookies">Cookies and local storage</a> for details.</p>`,
    },
    {
      id: "breaches",
      heading: "Data breaches",
      html: `<p>If a personal data breach is likely to put your rights at risk, we will notify the relevant supervisory authority within 72 hours of becoming aware of it where the GDPR requires, and tell you without undue delay if the risk to you is high.</p>`,
    },
  ],
};

const risk: LegalPage = {
  key: "risk",
  route: "/risk-disclosure",
  label: "Risk Disclosure",
  heading: "Risk Disclosure",
  summary: "Market360X is not registered with SEBI. Trading in options and other derivatives is risky. Please read this before acting on any Market360X alert.",
  sections: [
    {
      id: "sebi-disclaimer",
      heading: "Disclaimer: SEBI non-registration",
      html: `<p class="m3x-legal-callout">${SEBI_NON_REGISTRATION}</p>
      <p>${EDUCATIONAL_ONLY}</p>
      <p>Investments in securities markets are subject to market risks. Users should conduct their own research and consult a SEBI-registered Investment Adviser before investing.</p>
      <p>We do not guarantee accuracy, returns, or profitability and shall not be liable for any losses arising from reliance on this information, subject to applicable law.</p>
      <p><strong>Past performance is not indicative of future results.</strong></p>`,
    },
    {
      id: "fo-risk",
      heading: "Risk disclosure: Futures & Options (F&O)",
      html: `<ul>
        <li><strong>9 out of 10</strong> individual F&amp;O traders incurred net losses.</li>
        <li>Average net loss was approximately <strong>₹50,000</strong> per loss-making trader.</li>
        <li>Loss-making traders incurred additional transaction costs of <strong>28% of their net trading losses</strong>.</li>
      </ul>
      <p><em>Source: SEBI study on individual F&amp;O traders.</em></p>
      <p><strong>Note:</strong> Profitable F&amp;O traders incurred transaction costs of 15%–50% of their net trading profits, as reported in the referenced SEBI study.</p>`,
    },
    {
      id: "high-risk",
      heading: "Trading involves a high risk of loss",
      html: `<p>Trading in equity, futures and options (F&amp;O), indices and other financial instruments carries a high level of risk and is not suitable for everyone. You can lose some or all of the money you trade with, and in some cases (for example when selling options or trading futures) you can lose more than your initial margin.</p>
      <p>Only trade with money you can afford to lose. Never trade with borrowed money or money you need for essential expenses.</p>`,
    },
    {
      id: "no-guarantee",
      heading: "Alerts are not guarantees",
      html: `<ul>
        <li>Every alert is based on market data at the time it is sent. Markets can change direction suddenly and an alert can result in a loss.</li>
        <li>Markets can move sharply. In fast or gapping markets an order may be filled at a much worse price than you planned.</li>
        <li>Past performance is not indicative of future results. Accuracy figures and examples on this website do not guarantee future returns.</li>
        <li>Market360X never promises fixed, assured or guaranteed returns. Be careful of anyone who does.</li>
      </ul>`,
    },
    {
      id: "not-advice",
      heading: "Not investment advice",
      html: `<p>Our alerts are general information. They are not based on your financial situation, goals, experience or risk appetite, and they are not advice or a recommendation that a particular trade is right for you. You are fully responsible for your own trading decisions, position sizes and results. If you need advice, consult a SEBI-registered Investment Adviser.</p>`,
    },
    {
      id: "market-risks",
      heading: "Market and execution risks",
      html: `<ul>
        <li><strong>Volatility:</strong> option prices can move very quickly, especially around expiry, results and major news or global events.</li>
        <li><strong>Gaps and liquidity:</strong> prices can open far from the previous close, and some strikes may be hard to buy or sell at a fair price.</li>
        <li><strong>Time decay:</strong> option premiums lose value as expiry gets closer, even if the market does not move.</li>
        <li><strong>Delays:</strong> alerts can reach you late because of internet, device, messaging-app or broker problems, and the price may have moved by the time you trade.</li>
        <li><strong>Data errors:</strong> market data from third parties can occasionally be delayed or wrong.</li>
      </ul>`,
    },
    {
      id: "costs",
      heading: "Costs reduce your returns",
      html: `<p>Brokerage, Securities Transaction Tax (STT), exchange charges, SEBI fees, stamp duty and GST are charged on every trade. Frequent trading in options can add up to a large amount in costs, which reduces profits and increases losses.</p>`,
    },
    {
      id: "your-responsibility",
      heading: "Your responsibility",
      html: `<ul>
        <li>Understand how options and futures work before you trade them.</li>
        <li>Decide how much you can risk on each trade and always use a stop-loss.</li>
        <li>Trade only through a SEBI-registered stockbroker, using your own account.</li>
        <li>Never share your trading account login, password or OTP with anyone, including anyone claiming to be from Market360X.</li>
      </ul>`,
    },
    {
      id: "invest-wisely",
      heading: "SEBI investor awareness: Invest wisely",
      html: `<ul>
        <li>Understand before investing.</li>
        <li>Choose regulated investment products.</li>
        <li>Start early and stay invested.</li>
        <li>Beware of investment fraud.</li>
      </ul>`,
    },
    {
      id: "acknowledgement",
      heading: "Your acknowledgement",
      html: `<p>By subscribing to a Market360X plan or acting on any alert, you confirm that you have read and understood this Risk Disclosure, that you accept the risks of trading, and that Market360X is not responsible for any losses you make. If you have questions, contact us at ${mail} or ${phone}.</p>`,
    },
  ],
};

export const LEGAL_PAGES: LegalPage[] = [terms, privacy, refund, gdpr, risk];
