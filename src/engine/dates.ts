// Calendar math on epoch days (days since 1970-01-01). Dates are day-precision;
// clock times and timezones come later.

export interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

const DAY_MS = 86400000;

export const toEpochDay = (ymd: YMD): number => Date.UTC(ymd.y, ymd.m - 1, ymd.d) / DAY_MS;

export const fromEpochDay = (ed: number): YMD => {
  const dt = new Date(ed * DAY_MS);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
};

export const todayEpoch = (): number => {
  const n = new Date();
  return toEpochDay({ y: n.getFullYear(), m: n.getMonth() + 1, d: n.getDate() });
};

export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export const daysInYear = (y: number): number => (daysInMonth(y, 2) === 29 ? 366 : 365);

// calendar-aware month shift, clamping to month end: Jan 31 2020 + 1 month = Feb 29 2020
export const addMonths = (ed: number, months: number): number => {
  const { y, m, d } = fromEpochDay(ed);
  const t = y * 12 + (m - 1) + months;
  const ny = Math.floor(t / 12);
  const nm = (((t % 12) + 12) % 12) + 1;
  return toEpochDay({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
};

export const weekday = (ed: number): number => new Date(ed * DAY_MS).getUTCDay(); // 0 = Sunday

const WDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export const weekdayName = (ed: number): string => WDAY_NAMES[weekday(ed)];

export const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

// month/weekday words. "dec" and "oct" are format keywords, so only safe abbreviations appear.
export const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4, may: 5,
  june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  october: 10, november: 11, nov: 11, december: 12,
};

export const WDAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};

// next/previous occurrence of a weekday, never today itself
export const nearestWeekday = (fromEd: number, wday: number, dir: 1 | -1): number => {
  let delta = (((wday - weekday(fromEd)) * dir) % 7 + 7) % 7;
  if (delta === 0) delta = 7;
  return fromEd + delta * dir;
};

export interface Span {
  y: number;
  m: number;
  w: number;
  d: number;
  total: number; // whole days
}

// humanized calendar distance: whole months first (calendar-aware), remainder as weeks + days
export function humanSpan(a: number, b: number): Span {
  const from = Math.min(a, b);
  const to = Math.max(a, b);
  let months = 0;
  let cur = from;
  for (;;) {
    const nxt = addMonths(cur, 1);
    if (nxt <= to) {
      months++;
      cur = nxt;
    } else break;
  }
  const rem = to - cur;
  return { y: Math.floor(months / 12), m: months % 12, w: Math.floor(rem / 7), d: rem % 7, total: to - from };
}

// fixed cultural dates: next occurrence from today
export function holiday(name: string): number | null {
  const t = todayEpoch();
  const { y } = fromEpochDay(t);
  const pick = (m: number, d: number): number => {
    const thisYear = toEpochDay({ y, m, d });
    return thisYear >= t ? thisYear : toEpochDay({ y: y + 1, m, d });
  };
  switch (name) {
    case "christmas":
      return pick(12, 25);
    case "halloween":
      return pick(10, 31);
    case "new year":
      return toEpochDay({ y: y + 1, m: 1, d: 1 });
  }
  return null;
}
