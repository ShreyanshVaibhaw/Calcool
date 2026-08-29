// Workday math: Mon-Fri minus public holidays. Holiday rules are computed, not
// downloaded: US federal, UK bank holidays, India national days.

import { Decimal } from "./value";
import { fromEpochDay, toEpochDay, weekday } from "./dates";
import { unitById } from "./units";

export type Region = "US" | "UK" | "IN" | "none";

const config = {
  region: "US" as Region,
  hoursPerWorkday: 8,
};

export function setWorkdayConfig(opts: { region?: Region; hoursPerWorkday?: number }) {
  if (opts.region) config.region = opts.region;
  if (opts.hoursPerWorkday && opts.hoursPerWorkday > 0) {
    config.hoursPerWorkday = opts.hoursPerWorkday;
    unitById("workday").factor = new Decimal(opts.hoursPerWorkday * 3600);
  }
  holidayCache.clear();
}

export const hoursPerWorkday = () => config.hoursPerWorkday;

// nth weekday of a month; n = -1 means last
function nthWeekday(y: number, m: number, wd: number, n: number): number {
  if (n > 0) {
    const first = toEpochDay({ y, m, d: 1 });
    const delta = (wd - weekday(first) + 7) % 7;
    return first + delta + (n - 1) * 7;
  }
  const last = toEpochDay({ y, m: m + 1, d: 1 }) - 1;
  const delta = (weekday(last) - wd + 7) % 7;
  return last - delta;
}

// US federal observation: Saturday holidays observed Friday, Sunday ones Monday
function observedUS(ed: number): number {
  const wd = weekday(ed);
  if (wd === 6) return ed - 1;
  if (wd === 0) return ed + 1;
  return ed;
}

// Anonymous Gregorian algorithm
function easterSunday(y: number): number {
  const a = y % 19;
  const b = Math.floor(y / 100);
  const c = y % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return toEpochDay({ y, m: month, d: day });
}

function holidaysUS(y: number): number[] {
  return [
    observedUS(toEpochDay({ y, m: 1, d: 1 })),
    nthWeekday(y, 1, 1, 3), // MLK
    nthWeekday(y, 2, 1, 3), // Presidents
    nthWeekday(y, 5, 1, -1), // Memorial
    observedUS(toEpochDay({ y, m: 6, d: 19 })), // Juneteenth
    observedUS(toEpochDay({ y, m: 7, d: 4 })),
    nthWeekday(y, 9, 1, 1), // Labor
    nthWeekday(y, 10, 1, 2), // Columbus
    observedUS(toEpochDay({ y, m: 11, d: 11 })), // Veterans
    nthWeekday(y, 11, 4, 4), // Thanksgiving
    observedUS(toEpochDay({ y, m: 12, d: 25 })),
  ];
}

function holidaysUK(y: number): number[] {
  const nextWeekdayFrom = (ed: number, taken: Set<number>): number => {
    while (weekday(ed) === 0 || weekday(ed) === 6 || taken.has(ed)) ed++;
    return ed;
  };
  const easter = easterSunday(y);
  const out = [
    easter - 2, // Good Friday
    easter + 1, // Easter Monday
    nthWeekday(y, 5, 1, 1), // Early May
    nthWeekday(y, 5, 1, -1), // Spring
    nthWeekday(y, 8, 1, -1), // Summer
  ];
  const taken = new Set(out);
  const newYear = nextWeekdayFrom(toEpochDay({ y, m: 1, d: 1 }), taken);
  out.push(newYear);
  taken.add(newYear);
  const xmas = nextWeekdayFrom(toEpochDay({ y, m: 12, d: 25 }), taken);
  out.push(xmas);
  taken.add(xmas);
  out.push(nextWeekdayFrom(toEpochDay({ y, m: 12, d: 26 }), taken)); // Boxing Day
  return out;
}

function holidaysIN(y: number): number[] {
  // national days only; festival dates vary by lunar calendar and state
  return [toEpochDay({ y, m: 1, d: 26 }), toEpochDay({ y, m: 8, d: 15 }), toEpochDay({ y, m: 10, d: 2 })];
}

const holidayCache = new Map<string, Set<number>>();

function holidaySet(y: number): Set<number> {
  const key = `${config.region}:${y}`;
  let s = holidayCache.get(key);
  if (!s) {
    const list = config.region === "US" ? holidaysUS(y) : config.region === "UK" ? holidaysUK(y) : config.region === "IN" ? holidaysIN(y) : [];
    s = new Set(list);
    holidayCache.set(key, s);
  }
  return s;
}

export function isWorkday(ed: number): boolean {
  const wd = weekday(ed);
  if (wd === 0 || wd === 6) return false;
  return !holidaySet(fromEpochDay(ed).y).has(ed);
}

// workdays in [a, b)
export function countWorkdays(a: number, b: number): number {
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  let n = 0;
  for (let ed = from; ed < to; ed++) if (isWorkday(ed)) n++;
  return n;
}

export function addWorkdays(ed: number, n: number): number {
  const step = n >= 0 ? 1 : -1;
  let left = Math.abs(Math.round(n));
  let cur = ed;
  while (left > 0) {
    cur += step;
    if (isWorkday(cur)) left--;
  }
  return cur;
}
