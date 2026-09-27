import { afterEach, describe, expect, test, vi } from "vitest";
import { evaluateSheet } from "./engine/sheet";
import { setCurrencyRates } from "./engine/units";
import { getRatesStatus, loadRates } from "./rates";

const RATES_KEY = "calcool.rates";
const line = (input: string): string => evaluateSheet(input).lines[0].formatted;

function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(initial));
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrencyRates({ EUR: 0.9 }); // restore the static table for other tests
});

describe("loadRates", () => {
  test("fresh cache applies without fetching", async () => {
    const at = Date.now();
    stubStorage({ [RATES_KEY]: JSON.stringify({ at, rates: { EUR: 0.5 } }) });
    const fetch = vi.fn(async () => {
      throw new Error("must not fetch");
    });
    vi.stubGlobal("fetch", fetch);
    const done = vi.fn();
    await loadRates(done);
    expect(fetch).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
    expect(getRatesStatus()).toEqual({ source: "cached", asOf: at });
    expect(line("10 USD in EUR")).toBe("€5.00");
  });

  test("no cache fetches live rates and stores them", async () => {
    const store = stubStorage();
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ rates: { EUR: 0.8 } }) })));
    const done = vi.fn();
    await loadRates(done);
    expect(getRatesStatus().source).toBe("live");
    expect(line("10 USD in EUR")).toBe("€8.00");
    expect(JSON.parse(store.get(RATES_KEY)!).rates).toEqual({ EUR: 0.8 });
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("stale cache applies when the fetch fails", async () => {
    const at = Date.now() - 24 * 3600e3; // 1 day old: stale but usable
    stubStorage({ [RATES_KEY]: JSON.stringify({ at, rates: { EUR: 0.7 } }) });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const done = vi.fn();
    await loadRates(done);
    expect(getRatesStatus()).toEqual({ source: "cached", asOf: at });
    expect(line("10 USD in EUR")).toBe("€7.00");
    expect(done).toHaveBeenCalledTimes(1);
  });

  test("ancient cache plus fetch failure keeps the static table silently", async () => {
    stubStorage({ [RATES_KEY]: JSON.stringify({ at: Date.now() - 8 * 24 * 3600e3, rates: { EUR: 0.7 } }) });
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("offline");
    }));
    const done = vi.fn();
    await loadRates(done);
    expect(getRatesStatus()).toEqual({ source: "static", asOf: null });
    expect(line("10 USD in EUR")).toBe("€9.00");
    expect(done).not.toHaveBeenCalled();
  });

  test("corrupt cache does not block the live fetch", async () => {
    stubStorage({ [RATES_KEY]: "{nope" });
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ rates: { EUR: 0.8 } }) })));
    await loadRates(() => {});
    expect(getRatesStatus().source).toBe("live");
    expect(line("10 USD in EUR")).toBe("€8.00");
  });
});
