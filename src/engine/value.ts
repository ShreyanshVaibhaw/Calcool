import Decimal from "decimal.js";

// 34 significant digits, always fixed notation (formatter handles display).
Decimal.set({ precision: 34, toExpNeg: -9e15, toExpPos: 9e15 });

export { Decimal };

export type UnitCategory =
  | "length"
  | "mass"
  | "duration"
  | "temperature"
  | "data"
  | "speed"
  | "area"
  | "volume"
  | "angle"
  | "currency";

export interface Unit {
  id: string;
  category: UnitCategory;
  // value_in_base = (v + offset) * factor. Offset only used by temperature.
  factor: Decimal;
  offset?: Decimal;
  symbol: string;
  dp?: number; // currency display decimals
  prefix?: boolean; // currency symbol before the number
}

// Display hints attached by "as hex", "to 2 dp" etc. They change rendering, not the value.
export interface Disp {
  mode?: "hex" | "bin" | "oct" | "sci" | "fraction" | "weekday" | "span" | "hm";
  dp?: number;
  span?: { y: number; m: number; w: number; d: number }; // humanized date distance
}

// durations remember their calendar parts so "3 months 5 days" applies to dates correctly
export interface CalParts {
  months: number;
  days: number;
}

export type Value =
  | { kind: "number"; d: Decimal; disp?: Disp }
  | { kind: "percent"; d: Decimal; disp?: Disp } // 10% -> d = 10
  | { kind: "quantity"; d: Decimal; unit: Unit; disp?: Disp; cal?: CalParts; range?: { a: number; b: number } } // range: the epoch days a date-span came from
  | { kind: "rate"; d: Decimal; num: Unit | null; den: Unit; disp?: Disp } // $/hour, km/day, 30/week
  | { kind: "date"; d: Decimal; disp?: Disp } // d = epoch day (days since 1970-01-01)
  | { kind: "time"; d: Decimal; zone?: string; anchored?: boolean; disp?: Disp }; // d = epoch minutes; anchored = tied to a real date/zone

export const num = (d: Decimal.Value): Value => ({ kind: "number", d: new Decimal(d) });
export const pct = (d: Decimal.Value): Value => ({ kind: "percent", d: new Decimal(d) });
export const qty = (d: Decimal.Value, unit: Unit): Value => ({ kind: "quantity", d: new Decimal(d), unit });

// Internal evaluation error; callers catch it and render the line as "no answer".
export class CalcError extends Error {}
