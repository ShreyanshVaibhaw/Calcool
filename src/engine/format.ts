import { Decimal, Unit, Value } from "./value";
import { unitById } from "./units";
import { MONTH_NAMES, fromEpochDay, todayEpoch, toEpochDay, weekdayName } from "./dates";
import { epochMinToWall, localZone } from "./times";

const group = (intPart: string) => intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

function groupFixed(s: string): string {
  const neg = s.startsWith("-");
  if (neg) s = s.slice(1);
  const [int, frac] = s.split(".");
  return (neg ? "-" : "") + group(int) + (frac !== undefined ? "." + frac : "");
}

// SI notation for large clean numbers: 300,000 -> 300k, 3,300,000 -> 3.3M
function siCompact(d: Decimal): string | null {
  if (d.abs().lt(1e5)) return null;
  const steps: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e6, "M"],
    [1e3, "k"],
  ];
  for (const [div, sfx] of steps) {
    const q = d.div(div);
    if (q.abs().gte(1) && q.abs().lt(1000) && q.dp() <= 1) return groupFixed(q.toFixed()) + sfx;
  }
  return null;
}

function trimZeros(s: string): string {
  if (!s.includes(".")) return s;
  s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

export function formatDecimal(d: Decimal, opts: { maxDp?: number; si?: boolean } = {}): string {
  const maxDp = opts.maxDp ?? 10;
  if (opts.si !== false) {
    const c = siCompact(d);
    if (c) return c;
  }
  let s = trimZeros(d.toDecimalPlaces(maxDp).toFixed());
  if ((s === "0" || s === "-0") && !d.isZero()) s = trimZeros(d.toSignificantDigits(6).toFixed());
  return groupFixed(s);
}

function fraction(d: Decimal): string {
  const [n, den] = d.toFraction(1000);
  if (den.eq(1)) return groupFixed(n.toFixed());
  const neg = n.isNeg();
  const an = n.abs();
  const whole = an.divToInt(den);
  const rem = an.mod(den);
  const sign = neg ? "-" : "";
  if (whole.isZero()) return `${sign}${rem.toFixed()}/${den.toFixed()}`;
  return `${sign}${whole.toFixed()} ${rem.toFixed()}/${den.toFixed()}`;
}

function baseFmt(d: Decimal, mode: "hex" | "bin" | "oct"): string {
  const i = d.round();
  const s = mode === "hex" ? i.toHexadecimal() : mode === "bin" ? i.toBinary() : i.toOctal();
  // uppercase hex digits but keep the 0x prefix lowercase
  if (mode === "hex") return s.replace(/^(-?)0x(.*)$/, (_, m, body) => `${m}0x${body.toUpperCase()}`);
  return s;
}

function sci(d: Decimal): string {
  return d.toExponential().replace("e+", "e");
}

// singular form for word-like unit symbols: "days" -> "day"
function unitLabel(u: Unit, d: Decimal): string {
  let s = u.symbol;
  if (s.length > 3 && s.endsWith("s") && d.abs().eq(1)) s = s.slice(0, -1);
  return s;
}

// imperial units that display their fraction as a smaller unit: 12.5 ft -> 12 ft 6 in
const AUTO_SUB: Record<string, string> = { ft: "inch", lb: "oz", stone: "lb" };

function compoundStr(d: Decimal, big: Unit, sub: Unit, maxDp: number): string {
  const sign = d.isNeg() ? "-" : "";
  const abs = d.abs();
  let whole = abs.floor();
  let rem = abs.minus(whole).mul(big.factor).div(sub.factor).toDecimalPlaces(maxDp);
  if (rem.gte(big.factor.div(sub.factor))) {
    // remainder rounded up to a full big unit: carry
    whole = whole.plus(1);
    rem = new Decimal(0);
  }
  const bigS = `${groupFixed(whole.toFixed())} ${unitLabel(big, whole)}`;
  if (rem.isZero()) return sign + bigS;
  const remS = `${trimZeros(rem.toFixed())} ${unitLabel(sub, rem)}`;
  return sign + (whole.isZero() ? remS : `${bigS} ${remS}`);
}

function currencyStr(d: Decimal, unit: Unit, allowSi = true): string {
  if (allowSi) {
    const c = siCompact(d);
    if (c) return c.startsWith("-") ? `-${unit.symbol}${c.slice(1)}` : `${unit.symbol}${c}`;
  }
  const s = groupFixed(d.toFixed(unit.dp ?? 2));
  return s.startsWith("-") ? `-${unit.symbol}${s.slice(1)}` : `${unit.symbol}${s}`;
}

export function formatValue(v: Value): string {
  const disp = v.disp ?? {};
  switch (v.kind) {
    case "number": {
      if (disp.mode === "hex" || disp.mode === "bin" || disp.mode === "oct") return baseFmt(v.d, disp.mode);
      if (disp.mode === "sci") return sci(v.d);
      if (disp.mode === "fraction") return fraction(v.d);
      return formatDecimal(v.d, { maxDp: disp.dp ?? 10, si: disp.dp === undefined });
    }
    case "percent":
      return formatDecimal(v.d, { maxDp: disp.dp ?? 2, si: false }) + "%";
    case "quantity": {
      if (disp.mode === "hm") {
        const total = Math.round(v.d.toNumber());
        const h = Math.floor(total / 60);
        const m = total % 60;
        const parts: string[] = [];
        if (h) parts.push(`${h} ${h === 1 ? "hour" : "hours"}`);
        if (m || !h) parts.push(`${m} min`);
        return parts.join(" ");
      }
      if (disp.mode === "span" && disp.span) {
        const parts: string[] = [];
        const push = (n: number, w: string) => {
          if (n) parts.push(`${n} ${n === 1 ? w : w + "s"}`);
        };
        push(disp.span.y, "year");
        push(disp.span.m, "month");
        push(disp.span.w, "week");
        push(disp.span.d, "day");
        return parts.length ? parts.join(" ") : "0 days";
      }
      if (v.unit.category === "currency") return currencyStr(v.d, v.unit, disp.dp === undefined);
      const subId = disp.sub ?? (!disp.plain && disp.dp === undefined && AUTO_SUB[v.unit.id] && !v.d.isInteger() ? AUTO_SUB[v.unit.id] : undefined);
      if (subId) return compoundStr(v.d, v.unit, unitById(subId), disp.dp ?? 2);
      const dNum = formatDecimal(v.d, { maxDp: disp.dp ?? 2, si: false });
      return `${dNum} ${unitLabel(v.unit, v.d)}`;
    }
    case "date": {
      const ed = v.d.toNumber();
      if (disp.mode === "weekday") return weekdayName(ed);
      const { y, m, d } = fromEpochDay(ed);
      const cur = fromEpochDay(todayEpoch()).y;
      return `${d} ${MONTH_NAMES[m - 1]}` + (y !== cur ? ` ${y}` : "");
    }
    case "time": {
      const w = epochMinToWall(v.zone ?? localZone(), v.d.toNumber());
      const h = Math.floor(w.mins / 60);
      const m = w.mins % 60;
      const clock = `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
      const today = todayEpoch();
      const wEd = toEpochDay({ y: w.y, m: w.m, d: w.d });
      if (wEd === today) return clock;
      if (wEd === today + 1) return `Tomorrow at ${clock}`;
      if (wEd === today - 1) return `Yesterday at ${clock}`;
      const curY = fromEpochDay(today).y;
      return `${w.d} ${MONTH_NAMES[w.m - 1]}${w.y !== curY ? ` ${w.y}` : ""} at ${clock}`;
    }
    case "rate": {
      const den = v.den.symbol.length > 3 && v.den.symbol.endsWith("s") ? v.den.symbol.slice(0, -1) : v.den.symbol;
      if (v.num?.category === "currency") return `${currencyStr(v.d, v.num, false)}/${den}`;
      if (v.num) return `${formatDecimal(v.d, { maxDp: 2, si: false })} ${v.num.symbol}/${den}`;
      return `${formatDecimal(v.d, { maxDp: 2, si: false })}/${den}`;
    }
  }
}
