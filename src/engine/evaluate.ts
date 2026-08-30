import { CalcError, Decimal, Disp, Unit, Value } from "./value";
import { areaUnitFor, volumeUnit, unitById } from "./units";
import { addMonths, humanSpan, toEpochDay, fromEpochDay } from "./dates";
import { epochMinToWall, wallToEpochMin, localZone } from "./times";
import { addWorkdays, countWorkdays, hoursPerWorkday } from "./workdays";
import { taxRate } from "./tax";
import { Node, Target } from "./parse";

export interface EvalEnv {
  vars: Map<string, Value>;
  lineValues: (Value | null)[];
}

const bad = (): never => {
  throw new CalcError("cannot evaluate");
};

export const toBase = (d: Decimal, u: Unit): Decimal => d.plus(u.offset ?? 0).mul(u.factor);
export const fromBase = (b: Decimal, u: Unit): Decimal => b.div(u.factor).minus(u.offset ?? 0);

const N = (d: Decimal): Value => ({ kind: "number", d });
const P = (d: Decimal): Value => ({ kind: "percent", d });
const Q = (d: Decimal, unit: Unit): Value => ({ kind: "quantity", d, unit });
const R = (d: Decimal, num: Unit | null, den: Unit): Value => ({ kind: "rate", d, num, den });

const pctFactor = (p: Decimal, sign: 1 | -1 | 0): Decimal =>
  sign === 0 ? p.div(100) : new Decimal(1).plus(p.div(100).mul(sign));

function convertQty(d: Decimal, from: Unit, to: Unit): Decimal {
  if (from.category !== to.category) bad();
  return fromBase(toBase(d, from), to);
}

// calendar-flavored duration units convert to workdays at 5 per week (Soulver's rule);
// hour-flavored ones use hoursPerWorkday via the plain factor
const CAL_UNITS = new Set(["day", "week", "month", "year", "night"]);

function durationConvert(v: Extract<Value, { kind: "quantity" }>, to: Unit): Decimal {
  const from = v.unit;
  if (to.id === "workday" && v.range) return new Decimal(countWorkdays(v.range.a, v.range.b));
  if (to.id === "workday" && CAL_UNITS.has(from.id)) {
    return toBase(v.d, from).div(86400).mul(5).div(7);
  }
  if (from.id === "workday" && CAL_UNITS.has(to.id)) {
    return v.d.mul(7).div(5).mul(86400).div(to.factor);
  }
  return convertQty(v.d, from, to);
}

// rate value expressed in (num2/den2) units
function convertRate(d: Decimal, num1: Unit | null, den1: Unit, num2: Unit | null, den2: Unit): Decimal {
  let out = d;
  if (num1 && num2) out = out.mul(num1.factor).div(num2.factor);
  else if (num1 !== null || num2 !== null) bad();
  return out.mul(den2.factor).div(den1.factor);
}

export function addValues(l: Value, r: Value): Value {
  return binop("+", l, r);
}

export function binop(op: string, l: Value, r: Value): Value {
  switch (op) {
    case "+":
    case "-": {
      const sign = op === "+" ? 1 : -1;
      if (l.kind === "time" || r.kind === "time") {
        if (l.kind === "time" && r.kind === "time") {
          if (op === "-") return hmValue(l.d.minus(r.d).abs().toNumber());
          bad();
        }
        if (l.kind === "time") return timeShift(l, r, sign as 1 | -1);
        if (op === "+" && r.kind === "time") return timeShift(r, l, 1);
        return bad();
      }
      if (l.kind === "date" || r.kind === "date") {
        if (l.kind === "date" && r.kind === "date") {
          if (op === "-") return spanValue(l.d.toNumber(), r.d.toNumber());
          bad();
        }
        if (l.kind === "date") return dateShift(l, r, sign as 1 | -1);
        if (op === "+" && r.kind === "date") return dateShift(r, l, 1);
        return bad();
      }
      if (l.kind === "number" && r.kind === "number") return N(sign === 1 ? l.d.plus(r.d) : l.d.minus(r.d));
      if (l.kind === "percent" && r.kind === "percent") return P(sign === 1 ? l.d.plus(r.d) : l.d.minus(r.d));
      if ((l.kind === "number" || l.kind === "quantity") && r.kind === "percent") {
        const f = pctFactor(r.d, sign as 1 | -1);
        return l.kind === "number" ? N(l.d.mul(f)) : Q(l.d.mul(f), l.unit);
      }
      if (l.kind === "percent" && r.kind === "number") return P(sign === 1 ? l.d.plus(r.d.mul(100)) : l.d.minus(r.d.mul(100)));
      if (l.kind === "percent" && r.kind === "quantity") return Q(r.d.mul(pctFactor(l.d, sign as 1 | -1)), r.unit);
      if (l.kind === "quantity" && r.kind === "quantity") {
        if (l.unit.category !== r.unit.category) bad();
        if (l.unit.category === "currency") {
          const lv = convertQty(l.d, l.unit, r.unit); // mixed currencies: the right one wins
          return Q(sign === 1 ? lv.plus(r.d) : lv.minus(r.d), r.unit);
        }
        const target = l.unit.factor.gte(r.unit.factor) ? l.unit : r.unit; // larger unit wins
        const b = sign === 1 ? toBase(l.d, l.unit).plus(toBase(r.d, r.unit)) : toBase(l.d, l.unit).minus(toBase(r.d, r.unit));
        const res = Q(fromBase(b, target), target);
        // laptime arithmetic keeps the H:MM:SS face
        if (target.category === "duration" && (l.disp?.mode === "laptime" || r.disp?.mode === "laptime")) res.disp = { mode: "laptime" };
        return res;
      }
      if (l.kind === "quantity" && r.kind === "number") return Q(sign === 1 ? l.d.plus(r.d) : l.d.minus(r.d), l.unit);
      if (l.kind === "number" && r.kind === "quantity") return Q(sign === 1 ? l.d.plus(r.d) : l.d.minus(r.d), r.unit);
      if (l.kind === "rate" && r.kind === "rate") {
        if (l.den.category !== r.den.category) bad();
        const den = l.den.factor.gte(r.den.factor) ? l.den : r.den;
        const num = l.num && r.num ? r.num : null;
        if ((l.num === null) !== (r.num === null)) bad();
        if (l.num && r.num && l.num.category !== r.num.category) bad();
        const lv = convertRate(l.d, l.num, l.den, num, den);
        const rv = convertRate(r.d, r.num, r.den, num, den);
        return R(sign === 1 ? lv.plus(rv) : lv.minus(rv), num, den);
      }
      return bad();
    }

    case "*": {
      if (l.kind === "number" && r.kind === "number") return N(l.d.mul(r.d));
      if (l.kind === "percent" && r.kind === "percent") return P(l.d.mul(r.d).div(100));
      if (l.kind === "percent" && (r.kind === "number" || r.kind === "quantity"))
        return r.kind === "number" ? N(r.d.mul(l.d).div(100)) : Q(r.d.mul(l.d).div(100), r.unit);
      if (r.kind === "percent" && (l.kind === "number" || l.kind === "quantity"))
        return l.kind === "number" ? N(l.d.mul(r.d).div(100)) : Q(l.d.mul(r.d).div(100), l.unit);
      if (l.kind === "quantity" && r.kind === "number") return { ...Q(l.d.mul(r.d), l.unit), disp: l.disp?.mode === "laptime" ? { mode: "laptime" } : undefined };
      if (l.kind === "number" && r.kind === "quantity") return { ...Q(l.d.mul(r.d), r.unit), disp: r.disp?.mode === "laptime" ? { mode: "laptime" } : undefined };
      if (l.kind === "quantity" && r.kind === "quantity") {
        // money × anything counts it: $30 × 4 days = $120
        if (l.unit.category === "currency" && r.unit.category !== "currency") return Q(l.d.mul(r.d), l.unit);
        if (r.unit.category === "currency" && l.unit.category !== "currency") return Q(l.d.mul(r.d), r.unit);
        if (l.unit.category === "length" && r.unit.category === "length") {
          const area = l.unit.id === r.unit.id ? areaUnitFor(l.unit) : null;
          const baseArea = toBase(l.d, l.unit).mul(toBase(r.d, r.unit)); // m²
          if (area) return Q(fromBase(baseArea, area), area);
          const m2 = areaUnitFor({ ...l.unit, id: "m" } as Unit);
          return m2 ? Q(baseArea, m2) : bad();
        }
        const lenArea =
          l.unit.category === "area" && r.unit.category === "length"
            ? { area: l, len: r }
            : l.unit.category === "length" && r.unit.category === "area"
              ? { area: r, len: l }
              : null;
        if (lenArea) {
          const m3 = toBase(lenArea.area.d as Decimal, lenArea.area.unit as Unit).mul(toBase(lenArea.len.d as Decimal, lenArea.len.unit as Unit));
          return Q(fromBase(m3.mul(1000), volumeUnit()), volumeUnit()); // m³ -> liters base
        }
        // power × time = energy: 5 kW × 3 hours = 15 kWh
        const powDur =
          l.unit.category === "power" && r.unit.category === "duration"
            ? { p: l, t: r }
            : l.unit.category === "duration" && r.unit.category === "power"
              ? { p: r, t: l }
              : null;
        if (powDur) {
          const joules = toBase(powDur.p.d as Decimal, powDur.p.unit as Unit).mul(toBase(powDur.t.d as Decimal, powDur.t.unit as Unit));
          const eu = unitById(joules.abs().gte(3.6e6) ? "kWh" : joules.abs().gte(3600) ? "Wh" : "J");
          return Q(fromBase(joules, eu), eu);
        }
        return bad();
      }
      if (l.kind === "rate" && r.kind === "number") return R(l.d.mul(r.d), l.num, l.den);
      if (l.kind === "number" && r.kind === "rate") return R(l.d.mul(r.d), r.num, r.den);
      const rateQty =
        l.kind === "rate" && r.kind === "quantity" ? { rate: l, q: r } : l.kind === "quantity" && r.kind === "rate" ? { rate: r, q: l } : null;
      if (rateQty) {
        const { rate, q } = rateQty;
        if (q.unit.category !== rate.den.category) bad();
        const count = q.unit.category === "duration" ? durationConvert(q, rate.den) : convertQty(q.d, q.unit, rate.den);
        const v = rate.d.mul(count);
        return rate.num ? Q(v, rate.num) : N(v);
      }
      return bad();
    }

    case "/": {
      const rz = (d: Decimal) => {
        if (d.isZero()) bad();
        return d;
      };
      if (l.kind === "number" && r.kind === "number") return N(l.d.div(rz(r.d)));
      if (l.kind === "percent" && r.kind === "number") return P(l.d.div(rz(r.d)));
      if (l.kind === "number" && r.kind === "percent") return N(l.d.div(rz(r.d.div(100))));
      if (l.kind === "quantity" && r.kind === "number") return { ...Q(l.d.div(rz(r.d)), l.unit), disp: l.disp?.mode === "laptime" ? { mode: "laptime" } : undefined };
      if (l.kind === "number" && r.kind === "quantity") return R(l.d.div(rz(r.d)), null, r.unit);
      if (l.kind === "quantity" && r.kind === "quantity") {
        if (l.unit.category === r.unit.category) return N(toBase(l.d, l.unit).div(rz(toBase(r.d, r.unit))));
        // energy ÷ time = power, energy ÷ power = time
        if (l.unit.category === "energy" && r.unit.category === "duration") {
          const watts = toBase(l.d, l.unit).div(rz(toBase(r.d, r.unit)));
          const pu = unitById(watts.abs().gte(1000) ? "kW" : "W");
          return Q(fromBase(watts, pu), pu);
        }
        if (l.unit.category === "energy" && r.unit.category === "power") {
          const secs = toBase(l.d, l.unit).div(rz(toBase(r.d, r.unit)));
          const du = unitById(secs.abs().gte(3600) ? "h" : secs.abs().gte(60) ? "min" : "s");
          return Q(fromBase(secs, du), du);
        }
        return R(l.d.div(rz(r.d)), l.unit, r.unit); // 90 km / 3 days = 30 km/day
      }
      if (l.kind === "quantity" && r.kind === "rate" && r.num && l.unit.category === r.num.category) {
        // $500 / ($20/hour) = 25 hours; 3 GB / (10 MB/s) = 300 seconds
        const amount = l.unit.category === "duration" ? durationConvert(l, r.num) : convertQty(l.d, l.unit, r.num);
        return Q(amount.div(rz(r.d)), r.den);
      }
      if (l.kind === "rate" && r.kind === "number") return R(l.d.div(rz(r.d)), l.num, l.den);
      return bad();
    }

    case "^": {
      if (l.kind === "number" && r.kind === "number") return N(Decimal.pow(l.d, r.d));
      return bad();
    }

    case "mod": {
      if (l.kind === "number" && r.kind === "number") {
        if (r.d.isZero()) bad();
        return N(l.d.mod(r.d));
      }
      return bad();
    }

    case "of": {
      if (l.kind === "percent") {
        if (r.kind === "number") return N(r.d.mul(l.d).div(100));
        if (r.kind === "quantity") return Q(r.d.mul(l.d).div(100), r.unit);
        if (r.kind === "percent") return P(r.d.mul(l.d).div(100));
        return bad();
      }
      if (l.kind === "number") {
        if (r.kind === "number") return N(l.d.mul(r.d));
        if (r.kind === "quantity") return Q(l.d.mul(r.d), r.unit);
        return bad();
      }
      return bad();
    }

    case "off":
    case "on": {
      if (l.kind !== "percent") bad();
      const lp = l as Extract<Value, { kind: "percent" }>;
      const f = pctFactor(lp.d, op === "on" ? 1 : -1);
      if (r.kind === "number") return N(r.d.mul(f));
      if (r.kind === "quantity") return Q(r.d.mul(f), r.unit);
      return bad();
    }

    case "at": {
      if (l.kind === "quantity" && r.kind === "rate") {
        if (l.unit.category === r.den.category) return binop("*", l, r); // 30 hours at $30/hour
        if (r.num && l.unit.category === r.num.category) return binop("/", l, r); // $500 at $20/hour; 3 GB at 10 MB/s
      }
      return bad();
    }

    case "after":
    case "before": {
      if (r.kind === "time") {
        if (l.kind === "number" || l.kind === "quantity") return timeShift(r, l, op === "after" ? 1 : -1);
        bad();
      }
      if (r.kind !== "date") bad();
      if (l.kind === "number" || l.kind === "quantity") return dateShift(r as Extract<Value, { kind: "date" }>, l, op === "after" ? 1 : -1);
      return bad();
    }
  }
  return bad();
}

const hmValue = (mins: number): Value => ({
  kind: "quantity",
  d: new Decimal(Math.abs(mins)),
  unit: unitById("min"),
  disp: { mode: "hm" },
});

// time +/- duration; wall-clock calendar shifts for month/day parts, elapsed minutes otherwise.
// A bare number added to a time means hours.
function timeShift(tv: Extract<Value, { kind: "time" }>, dur: Value, sign: 1 | -1): Value {
  let min = tv.d.toNumber();
  const zone = tv.zone ?? localZone();
  if (dur.kind === "quantity" && dur.unit.id === "workday") {
    const w = epochMinToWall(zone, min);
    const ed = addWorkdays(toEpochDay({ y: w.y, m: w.m, d: w.d }), sign * dur.d.toNumber());
    const nd = fromEpochDay(ed);
    return { kind: "time", d: new Decimal(wallToEpochMin(zone, nd.y, nd.m, nd.d, w.mins)), zone: tv.zone, anchored: tv.anchored };
  }
  if (dur.kind === "number") {
    min += sign * Math.round(dur.d.toNumber() * 60);
  } else if (dur.kind === "quantity" && dur.unit.category === "duration") {
    const cal = dur.cal;
    if (cal && Number.isInteger(cal.months) && (cal.months !== 0 || Math.abs(cal.days) >= 1)) {
      const w = epochMinToWall(zone, min);
      let ed = toEpochDay({ y: w.y, m: w.m, d: w.d });
      if (cal.months) ed = addMonths(ed, sign * cal.months);
      const dayWhole = Math.trunc(cal.days);
      const minPart = Math.round((cal.days - dayWhole) * 1440);
      ed += sign * dayWhole;
      const nd = fromEpochDay(ed);
      min = wallToEpochMin(zone, nd.y, nd.m, nd.d, w.mins) + sign * minPart;
    } else {
      min += sign * Math.round(toBase(dur.d, dur.unit).div(60).toNumber());
    }
  } else bad();
  return { kind: "time", d: new Decimal(min), zone: tv.zone, anchored: tv.anchored };
}

// epoch minutes for span math; dates count as local midnight
function instantMin(v: Value): number {
  if (v.kind === "time") return v.d.toNumber();
  const ed = coerceDate(v);
  const { y, m, d } = fromEpochDay(ed);
  return wallToEpochMin(localZone(), y, m, d, 0);
}

// date +/- duration, calendar-aware when the duration knows its month/day parts
function dateShift(dateV: Extract<Value, { kind: "date" }>, dur: Value, sign: 1 | -1): Value {
  let ed = dateV.d.toNumber();
  if (dur.kind === "quantity" && dur.unit.id === "workday") {
    return { kind: "date", d: new Decimal(addWorkdays(ed, sign * dur.d.toNumber())) };
  }
  if (dur.kind === "number") {
    ed += sign * Math.round(dur.d.toNumber());
  } else if (dur.kind === "quantity" && dur.unit.category === "duration") {
    if (dur.cal && Number.isInteger(dur.cal.months)) {
      if (dur.cal.months) ed = addMonths(ed, sign * dur.cal.months);
      ed += sign * Math.round(dur.cal.days);
    } else {
      ed += sign * Math.round(toBase(dur.d, dur.unit).div(86400).toNumber());
    }
  } else bad();
  return { kind: "date", d: new Decimal(ed) };
}

function spanValue(a: number, b: number, unit?: Unit): Value {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (unit?.id === "workday") return { kind: "quantity", d: new Decimal(countWorkdays(lo, hi)), unit };
  if (unit?.id === "workhour") return { kind: "quantity", d: new Decimal(countWorkdays(lo, hi) * hoursPerWorkday()), unit };
  const sp = humanSpan(a, b);
  if (unit) return { kind: "quantity", d: new Decimal(sp.total).mul(86400).div(unit.factor), unit };
  return {
    kind: "quantity",
    d: new Decimal(sp.total),
    unit: unitById("day"),
    disp: { mode: "span", span: { y: sp.y, m: sp.m, w: sp.w, d: sp.d } },
    range: { a: lo, b: hi },
  };
}

const coerceDate = (v: Value): number => {
  if (v.kind === "date") return v.d.toNumber();
  if (v.kind === "number" && v.d.isInteger() && v.d.gte(1500) && v.d.lte(2999)) {
    return toEpochDay({ y: v.d.toNumber(), m: 1, d: 1 });
  }
  bad();
  return 0;
};

// comparable scalar for min/max/median
function baseKey(v: Value): Decimal {
  if (v.kind === "quantity") return toBase(v.d, v.unit);
  return v.d;
}

function foldSum(args: Value[]): Value {
  let acc: Value | null = null;
  for (const v of args) {
    acc = acc === null ? v : binop("+", acc, v);
  }
  if (!acc) bad();
  return acc!;
}

function applyFn(name: string, args: Value[]): Value {
  const one = args[0];
  const asNum = (v: Value): Decimal => {
    if (v.kind === "number") return v.d;
    bad();
    return v.d;
  };
  const mathFn = (f: (x: number) => number, deg = false): Value => {
    let x = asNum(one).toNumber();
    if (deg) x = (x * Math.PI) / 180;
    const y = f(x);
    if (!isFinite(y)) bad();
    return N(new Decimal(y));
  };

  switch (name) {
    case "sqrt":
      return N(Decimal.sqrt(asNum(one)));
    case "cbrt":
      return N(Decimal.cbrt(asNum(one)));
    case "abs":
      return { ...one, d: one.d.abs() };
    case "round":
      return { ...one, d: one.d.toDecimalPlaces(0, Decimal.ROUND_HALF_UP) };
    case "ceil":
      return { ...one, d: one.d.toDecimalPlaces(0, Decimal.ROUND_CEIL) };
    case "floor":
      return { ...one, d: one.d.toDecimalPlaces(0, Decimal.ROUND_FLOOR) };
    case "fact": {
      const n = asNum(one);
      if (!n.isInteger() || n.isNeg() || n.gt(500)) bad();
      let acc = new Decimal(1);
      for (let i = 2; i <= n.toNumber(); i++) acc = acc.mul(i);
      return N(acc);
    }
    case "ln":
      return N(Decimal.ln(asNum(one)));
    case "log":
    case "log10":
      return N(Decimal.log(asNum(one), 10));
    case "log2":
      return N(Decimal.log(asNum(one), 2));
    case "exp":
      return N(Decimal.exp(asNum(one)));
    case "sin":
      return mathFn(Math.sin);
    case "cos":
      return mathFn(Math.cos);
    case "tan":
      return mathFn(Math.tan);
    case "sind":
      return mathFn(Math.sin, true);
    case "cosd":
      return mathFn(Math.cos, true);
    case "tand":
      return mathFn(Math.tan, true);
    case "asin":
      return mathFn(Math.asin);
    case "acos":
      return mathFn(Math.acos);
    case "atan":
      return mathFn(Math.atan);
    case "sinh":
      return mathFn(Math.sinh);
    case "cosh":
      return mathFn(Math.cosh);
    case "tanh":
      return mathFn(Math.tanh);
    case "min":
    case "max": {
      if (!args.length) bad();
      let best = args[0];
      for (const v of args.slice(1)) {
        const better = name === "min" ? baseKey(v).lt(baseKey(best)) : baseKey(v).gt(baseKey(best));
        if (better) best = v;
      }
      return best;
    }
    case "total":
    case "sum":
      return foldSum(args);
    case "average": {
      const s = foldSum(args);
      return binop("/", s, N(new Decimal(args.length)));
    }
    case "count":
      return N(new Decimal(args.length));
    case "median": {
      if (!args.length) bad();
      const sorted = [...args].sort((a, b) => baseKey(a).cmp(baseKey(b)));
      const mid = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 1) return sorted[mid];
      return binop("/", binop("+", sorted[mid - 1], sorted[mid]), N(new Decimal(2)));
    }
  }
  return bad();
}

export function convertValue(v: Value, t: Target): Value {
  switch (t.k) {
    case "unit": {
      // asking for a unit by name means decimal display, unless a remainder unit was named too
      const uDisp: Disp = t.sub ? { sub: t.sub.id } : { plain: true };
      if (v.kind === "quantity") {
        if (v.unit.category === "duration" && t.unit.category === "duration") return Q(durationConvert(v, t.unit), t.unit);
        if (v.unit.category === t.unit.category) return { ...Q(convertQty(v.d, v.unit, t.unit), t.unit), disp: uDisp };
        // a substance density bridges mass and volume: 300g butter in cups
        if (v.dens) {
          if (v.unit.category === "mass" && t.unit.category === "volume") {
            return { ...Q(fromBase(toBase(v.d, v.unit).div(v.dens), t.unit), t.unit), disp: uDisp }; // kg / (kg/l) = l
          }
          if (v.unit.category === "volume" && t.unit.category === "mass") {
            return { ...Q(fromBase(toBase(v.d, v.unit).mul(v.dens), t.unit), t.unit), disp: uDisp };
          }
        }
        bad();
      }
      if (v.kind === "rate") {
        // km/day -> mph style: bridge through m/s when the target is a speed unit
        if (t.unit.category === "speed" && v.num?.category === "length" && v.den.category === "duration") {
          const mps = v.d.mul(v.num.factor).div(v.den.factor);
          return Q(fromBase(mps, t.unit), t.unit);
        }
        bad();
      }
      if (v.kind === "number") return Q(v.d, t.unit);
      bad();
      break;
    }
    case "rate": {
      if (v.kind === "rate") return R(convertRate(v.d, v.num, v.den, t.num, t.den), t.num, t.den);
      if (v.kind === "quantity" && v.unit.category === "speed" && t.num.category === "length" && t.den.category === "duration") {
        const mps = toBase(v.d, v.unit);
        return R(mps.mul(t.den.factor).div(t.num.factor), t.num, t.den);
      }
      if (v.kind === "number") return R(v.d, null, t.den);
      bad();
      break;
    }
    case "fmt": {
      switch (t.fmt) {
        case "num":
          return N(v.d);
        case "dec":
          if (v.kind === "time") {
            const w = epochMinToWall(v.zone ?? localZone(), v.d.toNumber());
            return N(new Decimal(w.mins).div(60)); // 10:15 -> 10.25
          }
          if (v.kind === "percent") return N(v.d.div(100));
          return N(v.d);
        case "percent":
          if (v.kind === "percent") return v;
          if (v.kind === "number") return P(v.d.mul(100));
          bad();
          break;
        case "fraction":
          if (v.kind === "percent") return { kind: "number", d: v.d.div(100), disp: { mode: "fraction" } };
          if (v.kind === "number") return { ...v, disp: { ...v.disp, mode: "fraction" } };
          bad();
          break;
        case "hex":
        case "bin":
        case "oct":
        case "sci":
          if (v.kind === "number") return { ...v, disp: { ...v.disp, mode: t.fmt } };
          bad();
          break;
        case "pitch":
          // 440 hz as pitch = A4
          if (v.kind === "quantity" && v.unit.category === "frequency" && v.d.gt(0)) return { ...v, disp: { ...v.disp, mode: "pitch" } };
          bad();
          break;
      }
      bad();
      break;
    }
    case "zone": {
      if (v.kind === "time") return { kind: "time", d: v.d, zone: t.zone, anchored: true, disp: v.disp };
      bad();
      break;
    }
    case "dp":
      return { ...v, disp: { ...v.disp, dp: t.n } };
    case "nearest": {
      if (t.m.isZero()) bad();
      if (v.kind === "number" || v.kind === "quantity" || v.kind === "percent")
        return { ...v, d: v.d.div(t.m).toDecimalPlaces(0, Decimal.ROUND_HALF_UP).mul(t.m) };
      bad();
    }
  }
  return bad();
}

// scalar magnitude used by the percent phrase machinery: quantities compare in base units
const phraseKey = (v: Value): Decimal => (v.kind === "quantity" ? toBase(v.d, v.unit) : v.d);

export function evalNode(node: Node, env: EvalEnv): Value {
  switch (node.n) {
    case "value":
      return node.v;
    case "neg": {
      const c = evalNode(node.c, env);
      return { ...c, d: c.d.neg() };
    }
    case "bin":
      return binop(node.op, evalNode(node.l, env), evalNode(node.r, env));
    case "fn":
      return applyFn(node.name, node.args.map((a) => evalNode(a, env)));
    case "convert":
      return convertValue(evalNode(node.c, env), node.t);
    case "aspct": {
      const x = phraseKey(evalNode(node.x, env));
      const y = phraseKey(evalNode(node.y, env));
      if (y.isZero()) bad();
      if (node.form === "of") return P(x.div(y).mul(100));
      if (node.form === "off") return P(y.minus(x).div(y).mul(100));
      return P(x.minus(y).div(y).mul(100));
    }
    case "what": {
      const x = evalNode(node.x, env);
      const p = evalNode(node.p, env);
      if (p.kind !== "percent") bad();
      const pp = (p as Extract<Value, { kind: "percent" }>).d;
      const f = node.form === "of" ? pp.div(100) : node.form === "off" ? new Decimal(1).minus(pp.div(100)) : new Decimal(1).plus(pp.div(100));
      if (f.isZero()) bad();
      if (x.kind === "number") return N(x.d.div(f));
      if (x.kind === "quantity") return Q(x.d.div(f), x.unit);
      bad();
      break;
    }
    case "change": {
      const a = phraseKey(evalNode(node.a, env));
      const b = phraseKey(evalNode(node.b, env));
      if (a.isZero()) bad();
      return P(b.minus(a).div(a).mul(100));
    }
    case "ref": {
      const v = env.lineValues[node.idx];
      if (!v) bad();
      return v!;
    }
    case "var": {
      const v = env.vars.get(node.name);
      if (!v) bad();
      return v!;
    }
    case "span": {
      const av = evalNode(node.a, env);
      const bv = evalNode(node.b, env);
      if (av.kind === "time" || bv.kind === "time") {
        const am = instantMin(av);
        let bm = instantMin(bv);
        const bothAnchored = (av.kind !== "time" || !!av.anchored) && (bv.kind !== "time" || !!bv.anchored);
        if (!bothAnchored && bm < am) bm += 1440; // 4pm to 3am wraps forward
        const diff = Math.abs(bm - am);
        if (node.unit) return { kind: "quantity", d: new Decimal(diff).mul(60).div(node.unit.factor), unit: node.unit };
        return hmValue(diff);
      }
      const a = coerceDate(av);
      const b = coerceDate(bv);
      return spanValue(a, b, node.unit);
    }
    case "wdname": {
      const c = evalNode(node.c, env);
      if (c.kind !== "date") bad();
      return { kind: "date", d: (c as Extract<Value, { kind: "date" }>).d, disp: { mode: "weekday" } };
    }
    case "fin": {
      const yearsV = evalNode(node.years, env);
      const t =
        yearsV.kind === "quantity" && yearsV.unit.category === "duration"
          ? yearsV.d.mul(yearsV.unit.factor).div(unitById("year").factor)
          : yearsV.kind === "number"
            ? yearsV.d
            : bad();
      if (t.lte(0)) bad();
      const pV = evalNode(node.p, env);
      if (pV.kind !== "quantity" && pV.kind !== "number") bad();
      const money = (d: Decimal): Value => (pV.kind === "quantity" ? { kind: "quantity", d, unit: pV.unit } : { kind: "number", d });
      if (node.op === "cagr") {
        const rV = evalNode(node.ret!, env);
        if (rV.kind !== "quantity" && rV.kind !== "number") bad();
        return { kind: "percent", d: rV.d.div(pV.d).pow(new Decimal(1).div(t)).minus(1).mul(100) };
      }
      const rateV = evalNode(node.rate!, env);
      if (rateV.kind !== "percent") bad();
      const freq = new Decimal(node.freq ?? 1);
      const rp = rateV.d.div(100).div(freq); // rate per period
      const n = t.mul(freq); // number of periods
      if (node.op === "loan") {
        const pay = rp.isZero() ? pV.d.div(n) : pV.d.mul(rp).div(new Decimal(1).minus(new Decimal(1).plus(rp).pow(n.neg())));
        return money(node.total ? pay.mul(n) : pay);
      }
      const fv = pV.d.mul(new Decimal(1).plus(rp).pow(n));
      return money(node.op === "interest" ? fv.minus(pV.d) : fv);
    }
    case "tax": {
      const c = evalNode(node.c, env);
      if (c.kind !== "quantity" && c.kind !== "number") bad();
      const f = new Decimal(1).plus(taxRate().div(100));
      const d = node.mode === "add" ? c.d.mul(f) : node.mode === "remove" ? c.d.div(f) : c.d.mul(taxRate().div(100));
      return { ...c, d };
    }
  }
  return bad();
}
