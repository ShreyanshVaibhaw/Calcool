import { setCurrencyRates } from "./engine/units";

const RATES_KEY = "calcool.rates";
const FRESH_MS = 12 * 3600e3; // refetch when older than 12h
const STALE_OK_MS = 7 * 24 * 3600e3; // ...but a stale cache beats the static table for up to 7 days

export type RatesSource = "live" | "cached" | "static";

export interface RatesStatus {
  source: RatesSource;
  asOf: number | null; // Date.now() when the active rates were fetched, null for the static table
}

let status: RatesStatus = { source: "static", asOf: null };

export function getRatesStatus(): RatesStatus {
  return { ...status };
}

interface CachedRates {
  at: number;
  rates: Record<string, number>;
}

function readCache(): CachedRates | null {
  try {
    return JSON.parse(localStorage.getItem(RATES_KEY) ?? "null") as CachedRates | null;
  } catch {
    return null;
  }
}

// live currency rates, cached 12h; the static table in units.ts covers offline.
// On fetch failure a stale (< 7 day) cache is applied so conversions stay
// recent-ish; only with no usable cache does the static table stay in effect.
export async function loadRates(onDone: () => void) {
  const cached = readCache();
  if (cached && Date.now() - cached.at < FRESH_MS) {
    setCurrencyRates(cached.rates);
    status = { source: "cached", asOf: cached.at };
    onDone();
    return;
  }
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json = await res.json();
    if (json?.rates) {
      setCurrencyRates(json.rates);
      const at = Date.now();
      try {
        localStorage.setItem(RATES_KEY, JSON.stringify({ at, rates: json.rates }));
      } catch {
        /* private mode: live rates still apply for this session */
      }
      status = { source: "live", asOf: at };
      onDone();
      return;
    }
  } catch {
    /* fall through to the stale cache / static table */
  }
  if (cached && Date.now() - cached.at < STALE_OK_MS) {
    setCurrencyRates(cached.rates);
    status = { source: "cached", asOf: cached.at };
    onDone();
    return;
  }
  status = { source: "static", asOf: null };
}
