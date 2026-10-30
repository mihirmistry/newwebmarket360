// Angel One SmartAPI client (market data only - it never places orders). Logs in with the client code, PIN and a
// TOTP code generated from the saved secret, keeps the session for the day and logs in again when it expires.
// Calls must come from the static IP registered on the SmartAPI app.
import { createHmac } from "node:crypto";
import os from "node:os";
import { fetchNifty50, type Stock } from "./nifty50.js";

export interface AngelCredentials {
  apiKey: string;
  clientCode: string;
  pin: string;
  totpSecret: string;
}

export interface DailyClose {
  /** YYYY-MM-DD (IST) */
  day: string;
  close: number;
  /** The day's range (Supertrend needs it); absent when the data has none */
  high?: number;
  low?: number;
}

export interface Quote {
  token: string;
  ltp: number;
  /** YYYY-MM-DD (IST) of the exchange feed time, when the API gives one */
  day: string | null;
  /** Today's high and low so far, when the API gives them */
  high?: number;
  low?: number;
  /** The previous session's close */
  prevClose?: number;
}

export interface AngelOneClient {
  /** Daily candles (close, high, low), oldest first, for an index/stock token (e.g. Nifty 50 = 99926000 on NSE). */
  dailyCloses(token: string, days: number): Promise<DailyClose[]>;
  /** Live last-traded prices for NSE tokens (up to 50 per call). */
  quotes(tokens: string[]): Promise<Quote[]>;
  /** The Nifty 50 stocks and their NSE tokens (cached for a week). */
  nifty50(): Promise<Stock[]>;
  /** Current put-call ratio of the nearest Nifty contract. */
  niftyPcr(): Promise<number>;
}

export const NIFTY_TOKEN = "99926000";
export const INDIA_VIX_TOKEN = "99926017";
const BASE = "https://apiconnect.angelone.in";
const TIMEOUT_MS = 20_000;
const CONSTITUENTS_TTL_MS = 7 * 86_400_000;
const RATE_RETRIES = 3;
const RATE_WAIT_MS = 1_100;

export class AngelOneError extends Error {
  constructor(
    message: string,
    public code = ""
  ) {
    super(message);
  }
}

// ---------- TOTP (RFC 6238: SHA-1, 30-second steps, 6 digits) ----------

function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new AngelOneError("The TOTP secret contains characters that aren't valid. Copy the text under the QR code again.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, now = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / 30)));
  const hmac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const code = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

// ---------- helpers ----------

/** YYYY-MM-DD in India Standard Time. */
export function istDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** "YYYY-MM-DD HH:mm" in IST, the date format SmartAPI expects. */
function istStamp(d: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
      .formatToParts(d)
      .map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day} ${p.hour === "24" ? "00" : p.hour}:${p.minute}`;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "21-Oct-2024 15:29:59" -> "2024-10-21" */
function feedDay(text: unknown): string | null {
  const m = typeof text === "string" ? /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(text) : null;
  const month = m ? MONTHS[m[2]!.toLowerCase()] : undefined;
  return m && month ? `${m[3]}-${month}-${m[1]!.padStart(2, "0")}` : null;
}

/** The headers SmartAPI asks for: this machine's local IP and MAC address. */
function machineHeaders(): Record<string, string> {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === "IPv4" && !ni.internal) return { "X-ClientLocalIP": ni.address, "X-ClientPublicIP": ni.address, "X-MACAddress": ni.mac };
    }
  }
  return { "X-ClientLocalIP": "127.0.0.1", "X-ClientPublicIP": "127.0.0.1", "X-MACAddress": "00:00:00:00:00:00" };
}

interface ApiBody<T> {
  status?: boolean;
  message?: string;
  errorcode?: string;
  data?: T;
}

const SESSION_ERRORS = new Set(["AG8001", "AG8002", "AG8003", "AB1010", "AB8050", "AB8051"]);

export function createAngelOneClient(creds: AngelCredentials, fetchImpl: typeof fetch = fetch): AngelOneClient {
  let session: { jwt: string; day: string } | null = null;
  let constituents: { at: number; stocks: Stock[] } | null = null;

  async function call<T>(method: "GET" | "POST", path: string, body: unknown, jwt?: string): Promise<T> {
    let res: Response;
    let text = "";
    // Angel One limits each API to a few calls a second and answers "exceeding access rate" (403) beyond that:
    // wait a little and try again
    for (let attempt = 0; ; attempt++) {
      try {
        res = await fetchImpl(BASE + path, {
          method,
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-PrivateKey": creds.apiKey,
            ...machineHeaders(),
            ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}),
          },
          body: method === "POST" ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (err) {
        throw new AngelOneError(`Couldn't reach Angel One (${(err as Error).message}).`);
      }
      text = await res.text();
      if (res.status !== 403 || !/access rate/i.test(text) || attempt >= RATE_RETRIES) break;
      await new Promise((r) => setTimeout(r, RATE_WAIT_MS * (attempt + 1)));
    }
    let json: ApiBody<T>;
    try {
      json = JSON.parse(text) as ApiBody<T>;
    } catch {
      // Angel One answers some rejected requests (e.g. an unregistered IP) with plain text or HTML
      throw new AngelOneError(`Angel One answered ${res.status}: ${text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) || "no details"}`);
    }
    if (!res.ok || json.status === false || json.data === undefined || json.data === null) {
      throw new AngelOneError(json.message || `Angel One answered ${res.status}`, json.errorcode ?? "");
    }
    return json.data;
  }

  async function login(): Promise<string> {
    const data = await call<{ jwtToken?: string }>("POST", "/rest/auth/angelbroking/user/v1/loginByPassword", {
      clientcode: creds.clientCode,
      password: creds.pin,
      totp: totpCode(creds.totpSecret),
    });
    if (!data.jwtToken) throw new AngelOneError("Angel One didn't return a session token.");
    session = { jwt: data.jwtToken.replace(/^Bearer\s+/i, ""), day: istDay(new Date()) };
    return session.jwt;
  }

  /** An authenticated call; logs in when needed and once more if the session has expired. */
  async function secure<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const today = istDay(new Date());
    const jwt = session && session.day === today ? session.jwt : await login();
    try {
      return await call<T>(method, path, body, jwt);
    } catch (err) {
      if (err instanceof AngelOneError && (SESSION_ERRORS.has(err.code) || /token|session/i.test(err.message))) {
        return call<T>(method, path, body, await login());
      }
      throw err;
    }
  }

  return {
    async dailyCloses(token, days) {
      const to = new Date();
      const from = new Date(to.getTime() - days * 86_400_000);
      const rows = await secure<unknown[]>("POST", "/rest/secure/angelbroking/historical/v1/getCandleData", {
        exchange: "NSE",
        symboltoken: token,
        interval: "ONE_DAY",
        fromdate: `${istStamp(from).slice(0, 10)} 09:15`,
        todate: istStamp(to),
      });
      const out: DailyClose[] = [];
      for (const r of rows) {
        // [timestamp, open, high, low, close, volume]
        if (!Array.isArray(r) || typeof r[0] !== "string") continue;
        const close = Number(r[4]);
        const high = Number(r[2]);
        const low = Number(r[3]);
        if (!Number.isFinite(close) || close <= 0) continue;
        out.push(high > 0 && low > 0 && high >= low ? { day: r[0].slice(0, 10), close, high, low } : { day: r[0].slice(0, 10), close });
      }
      return out.sort((a, b) => a.day.localeCompare(b.day));
    },

    async quotes(tokens) {
      const data = await secure<{ fetched?: Array<Record<string, unknown>> }>("POST", "/rest/secure/angelbroking/market/v1/quote/", {
        mode: "FULL",
        exchangeTokens: { NSE: tokens },
      });
      return (data.fetched ?? [])
        .map((q) => {
          const high = Number(q.high);
          const low = Number(q.low);
          const prevClose = Number(q.close);
          const quote: Quote = { token: String(q.symbolToken ?? ""), ltp: Number(q.ltp), day: feedDay(q.exchFeedTime) };
          if (prevClose > 0) quote.prevClose = prevClose;
          return high > 0 && low > 0 && high >= low ? { ...quote, high, low } : quote;
        })
        .filter((q) => q.token && Number.isFinite(q.ltp) && q.ltp > 0);
    },

    async nifty50() {
      if (!constituents || Date.now() - constituents.at > CONSTITUENTS_TTL_MS) {
        try {
          constituents = { at: Date.now(), stocks: await fetchNifty50(fetchImpl) };
        } catch (err) {
          if (!constituents) throw new AngelOneError((err as Error).message);
          // keep last week's list until the next attempt in an hour
          constituents.at = Date.now() - CONSTITUENTS_TTL_MS + 3_600_000;
        }
      }
      return constituents.stocks;
    },

    async niftyPcr() {
      const rows = await secure<Array<{ pcr?: number | string; tradingSymbol?: string }>>("GET", "/rest/secure/angelbroking/marketData/v1/putCallRatio");
      // Nifty 50 contracts look like "NIFTY28NOV24FUT"; skip BANKNIFTY, FINNIFTY, MIDCPNIFTY, NIFTYNXT50
      const nifty = rows
        .filter((r) => typeof r.tradingSymbol === "string" && /^NIFTY\d/.test(r.tradingSymbol))
        .map((r) => Number(r.pcr))
        .filter((v) => Number.isFinite(v) && v > 0);
      if (!nifty.length) throw new AngelOneError("Angel One's put-call ratio list has no Nifty contract right now.");
      return nifty[0]!;
    },
  };
}
