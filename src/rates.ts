import { setCurrencyRates } from "./engine/units";

const RATES_KEY = "calcool.rates";

// live currency rates, cached 12h; the static table in units.ts covers offline
export async function loadRates(onDone: () => void) {
  try {
    const cached = JSON.parse(localStorage.getItem(RATES_KEY) ?? "null") as { at: number; rates: Record<string, number> } | null;
    if (cached && Date.now() - cached.at < 12 * 3600e3) {
      setCurrencyRates(cached.rates);
      onDone();
      return;
    }
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    const json = await res.json();
    if (json?.rates) {
      setCurrencyRates(json.rates);
      localStorage.setItem(RATES_KEY, JSON.stringify({ at: Date.now(), rates: json.rates }));
      onDone();
    }
  } catch {
    // offline: the static fallback table stays in effect
  }
}
