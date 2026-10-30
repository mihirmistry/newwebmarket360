// The Nifty 50 constituents with their Angel One (NSE) tokens, for the advance / decline indicator. The list comes
// from NSE's published index file and the tokens from Angel One's public instrument list (about 35 MB; only the 50
// "<SYMBOL>-EQ" entries are parsed out of it). Neither needs a login.

export interface Stock {
  symbol: string;
  token: string;
}

const CONSTITUENT_URLS = [
  "https://niftyindices.com/IndexConstituent/ind_nifty50list.csv",
  "https://archives.nseindia.com/content/indices/ind_nifty50list.csv",
];
const SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_File/files/OpenAPIScripMaster.json";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36";

/** The Symbol column of NSE's index constituent CSV. */
export function parseConstituents(csv: string): string[] {
  const lines = csv.trim().split(/\r?\n/);
  const header = (lines.shift() ?? "").split(",").map((h) => h.trim().toLowerCase());
  const col = header.indexOf("symbol");
  if (col < 0) return [];
  return lines.map((l) => l.split(",")[col]?.trim().toUpperCase() ?? "").filter(Boolean);
}

/** Finds each symbol's NSE equity token in the instrument list without parsing the whole file. */
export function findTokens(scripMaster: string, symbols: readonly string[]): Stock[] {
  const out: Stock[] = [];
  for (const symbol of symbols) {
    const needle = `"symbol":${JSON.stringify(`${symbol}-EQ`)}`;
    for (let at = scripMaster.indexOf(needle); at >= 0; at = scripMaster.indexOf(needle, at + 1)) {
      const start = scripMaster.lastIndexOf("{", at);
      const end = scripMaster.indexOf("}", at);
      try {
        const row = JSON.parse(scripMaster.slice(start, end + 1)) as { token?: string; exch_seg?: string };
        if (row.exch_seg === "NSE" && row.token) {
          out.push({ symbol, token: row.token });
          break;
        }
      } catch {
        /* not a whole entry; keep looking */
      }
    }
  }
  return out;
}

async function getText(url: string, fetchImpl: typeof fetch, timeoutMs: number): Promise<string> {
  const res = await fetchImpl(url, { headers: { "User-Agent": BROWSER_UA, Accept: "*/*" }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${new URL(url).hostname} answered ${res.status}`);
  return res.text();
}

export async function fetchNifty50(fetchImpl: typeof fetch = fetch): Promise<Stock[]> {
  let symbols: string[] = [];
  let lastError = "";
  for (const url of CONSTITUENT_URLS) {
    try {
      symbols = parseConstituents(await getText(url, fetchImpl, 20_000));
      if (symbols.length >= 45) break;
    } catch (err) {
      lastError = (err as Error).message;
    }
  }
  if (symbols.length < 45) throw new Error(`Couldn't load the Nifty 50 list from NSE${lastError ? ` (${lastError})` : ""}.`);
  const stocks = findTokens(await getText(SCRIP_MASTER_URL, fetchImpl, 90_000), symbols);
  if (stocks.length < 45) throw new Error(`Only ${stocks.length} of the ${symbols.length} Nifty 50 stocks were found in Angel One's instrument list.`);
  return stocks;
}
