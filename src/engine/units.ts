import { Decimal, Unit, UnitCategory } from "./value";

const D = (v: Decimal.Value) => new Decimal(v);

interface Def {
  id: string;
  cat: UnitCategory;
  factor: Decimal.Value;
  offset?: Decimal.Value;
  symbol: string;
  exact?: string[]; // case-sensitive names (single letters, data units)
  names?: string[]; // case-insensitive names
  dp?: number;
  prefix?: boolean;
  recip?: boolean;
}

const DEFS: Def[] = [
  // length, base meter
  { id: "mm", cat: "length", factor: 0.001, symbol: "mm", names: ["mm", "millimeter", "millimeters", "millimetre", "millimetres"] },
  { id: "cm", cat: "length", factor: 0.01, symbol: "cm", names: ["cm", "centimeter", "centimeters", "centimetre", "centimetres"] },
  { id: "m", cat: "length", factor: 1, symbol: "m", exact: ["m"], names: ["meter", "meters", "metre", "metres"] },
  { id: "km", cat: "length", factor: 1000, symbol: "km", names: ["km", "kilometer", "kilometers", "kilometre", "kilometres", "kms"] },
  { id: "inch", cat: "length", factor: 0.0254, symbol: "in", names: ["inch", "inches", '"'] },
  { id: "ft", cat: "length", factor: 0.3048, symbol: "ft", names: ["ft", "foot", "feet", "'"] },
  { id: "yd", cat: "length", factor: 0.9144, symbol: "yd", names: ["yd", "yard", "yards"] },
  { id: "mi", cat: "length", factor: 1609.344, symbol: "mi", names: ["mi", "mile", "miles"] },
  { id: "nmi", cat: "length", factor: 1852, symbol: "nmi", names: ["nmi", "nautical mile", "nautical miles"] },
  // CSS reference pixel (96/in) and typographic point (72/in)
  { id: "px", cat: "length", factor: D("0.0254").div(96), symbol: "px", names: ["px", "pixel", "pixels"] },
  // "pt" itself is claimed by the Pacific timezone, so the point goes by name
  { id: "pt", cat: "length", factor: D("0.0254").div(72), symbol: "pt", names: ["point", "points"] },

  // mass, base kilogram
  { id: "mg", cat: "mass", factor: 1e-6, symbol: "mg", names: ["mg", "milligram", "milligrams"] },
  { id: "g", cat: "mass", factor: 0.001, symbol: "g", exact: ["g"], names: ["gram", "grams"] },
  { id: "kg", cat: "mass", factor: 1, symbol: "kg", names: ["kg", "kgs", "kilogram", "kilograms", "kilo", "kilos"] },
  { id: "tonne", cat: "mass", factor: 1000, symbol: "t", exact: ["t"], names: ["tonne", "tonnes", "metric ton", "metric tons"] },
  { id: "ton", cat: "mass", factor: 907.18474, symbol: "tons", names: ["ton", "tons", "short ton", "short tons"] },
  { id: "oz", cat: "mass", factor: 0.028349523125, symbol: "oz", names: ["oz", "ounce", "ounces"] },
  { id: "lb", cat: "mass", factor: 0.45359237, symbol: "lb", names: ["lb", "lbs", "pound", "pounds"] },
  { id: "stone", cat: "mass", factor: 6.35029318, symbol: "stone", names: ["stone", "stones"] },

  // duration, base second (month = 30.436875 d, year = 365.2425 d, matching Soulver)
  { id: "ms", cat: "duration", factor: 0.001, symbol: "ms", names: ["ms", "millisecond", "milliseconds"] },
  { id: "s", cat: "duration", factor: 1, symbol: "s", exact: ["s"], names: ["sec", "secs", "second", "seconds"] },
  { id: "min", cat: "duration", factor: 60, symbol: "min", names: ["min", "mins", "minute", "minutes"] },
  { id: "h", cat: "duration", factor: 3600, symbol: "hours", exact: ["h"], names: ["hr", "hrs", "hour", "hours"] },
  { id: "day", cat: "duration", factor: 86400, symbol: "days", names: ["day", "days"] },
  { id: "week", cat: "duration", factor: 604800, symbol: "weeks", names: ["week", "weeks", "wk", "wks"] },
  { id: "month", cat: "duration", factor: 2629746, symbol: "months", names: ["month", "months", "mo"] },
  { id: "year", cat: "duration", factor: 31556952, symbol: "years", names: ["year", "years", "yr", "yrs"] },
  { id: "night", cat: "duration", factor: 86400, symbol: "nights", names: ["night", "nights"] },
  // workday hour-math uses hoursPerWorkday (8h default); week/date math has special rules in evaluate.ts
  { id: "workday", cat: "duration", factor: 28800, symbol: "workdays", names: ["workday", "workdays", "work day", "work days", "working day", "working days", "business day", "business days"] },
  { id: "workhour", cat: "duration", factor: 3600, symbol: "work hours", names: ["workhour", "workhours", "work hour", "work hours"] },

  // temperature, base kelvin: base = (v + offset) * factor
  { id: "K", cat: "temperature", factor: 1, symbol: "K", exact: ["K"], names: ["kelvin", "kelvins"] },
  { id: "C", cat: "temperature", factor: 1, offset: 273.15, symbol: "°C", exact: ["C"], names: ["°c", "celsius", "centigrade"] },
  { id: "F", cat: "temperature", factor: D(5).div(9), offset: 459.67, symbol: "°F", exact: ["F"], names: ["°f", "fahrenheit"] },

  // data, base byte (decimal kB/MB..., binary KiB..., bit variants)
  { id: "bit", cat: "data", factor: 0.125, symbol: "bit", exact: ["b"], names: ["bit", "bits"] },
  { id: "byte", cat: "data", factor: 1, symbol: "B", exact: ["B"], names: ["byte", "bytes"] },
  { id: "kB", cat: "data", factor: 1e3, symbol: "kB", exact: ["kB", "KB"], names: ["kilobyte", "kilobytes"] },
  { id: "MB", cat: "data", factor: 1e6, symbol: "MB", exact: ["MB"], names: ["mb", "megabyte", "megabytes"] },
  { id: "GB", cat: "data", factor: 1e9, symbol: "GB", exact: ["GB"], names: ["gb", "gigabyte", "gigabytes"] },
  { id: "TB", cat: "data", factor: 1e12, symbol: "TB", exact: ["TB"], names: ["tb", "terabyte", "terabytes"] },
  { id: "PB", cat: "data", factor: 1e15, symbol: "PB", exact: ["PB"], names: ["pb", "petabyte", "petabytes"] },
  { id: "KiB", cat: "data", factor: 1024, symbol: "KiB", exact: ["KiB"], names: ["kib", "kibibyte", "kibibytes"] },
  { id: "MiB", cat: "data", factor: 1048576, symbol: "MiB", exact: ["MiB"], names: ["mib", "mebibyte", "mebibytes"] },
  { id: "GiB", cat: "data", factor: 1073741824, symbol: "GiB", exact: ["GiB"], names: ["gib", "gibibyte", "gibibytes"] },
  { id: "TiB", cat: "data", factor: 1099511627776, symbol: "TiB", exact: ["TiB"], names: ["tib", "tebibyte", "tebibytes"] },
  { id: "kbit", cat: "data", factor: 125, symbol: "kb", exact: ["kb"], names: ["kilobit", "kilobits"] },
  { id: "Mbit", cat: "data", factor: 125e3, symbol: "Mb", exact: ["Mb"], names: ["megabit", "megabits"] },
  { id: "Gbit", cat: "data", factor: 125e6, symbol: "Gb", exact: ["Gb"], names: ["gigabit", "gigabits"] },

  // speed, base m/s
  { id: "mps", cat: "speed", factor: 1, symbol: "m/s", names: ["mps"] },
  { id: "kmh", cat: "speed", factor: D(1000).div(3600), symbol: "km/h", names: ["kmh", "kph"] },
  { id: "mph", cat: "speed", factor: D("1609.344").div(3600), symbol: "mph", names: ["mph"] },
  { id: "knot", cat: "speed", factor: D(1852).div(3600), symbol: "knots", names: ["knot", "knots", "kn"] },

  // area, base m²
  { id: "cm2", cat: "area", factor: 1e-4, symbol: "cm²", names: ["cm2", "cm²", "square centimeter", "square centimeters", "sq cm"] },
  { id: "m2", cat: "area", factor: 1, symbol: "m²", names: ["m2", "m²", "sqm", "square meter", "square meters", "square metre", "square metres", "sq m"] },
  { id: "km2", cat: "area", factor: 1e6, symbol: "km²", names: ["km2", "km²", "square kilometer", "square kilometers", "sq km"] },
  { id: "in2", cat: "area", factor: 0.00064516, symbol: "in²", names: ["in2", "sqin", "square inch", "square inches", "sq in"] },
  { id: "ft2", cat: "area", factor: 0.09290304, symbol: "ft²", names: ["ft2", "ft²", "sqft", "square foot", "square feet", "sq ft"] },
  { id: "acre", cat: "area", factor: 4046.8564224, symbol: "acres", names: ["acre", "acres"] },
  { id: "ha", cat: "area", factor: 1e4, symbol: "ha", names: ["ha", "hectare", "hectares"] },

  // volume, base liter
  { id: "ml", cat: "volume", factor: 0.001, symbol: "mL", names: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"] },
  { id: "l", cat: "volume", factor: 1, symbol: "L", exact: ["L", "l"], names: ["liter", "liters", "litre", "litres"] },
  { id: "m3", cat: "volume", factor: 1000, symbol: "m³", names: ["m3", "m³", "cubic meter", "cubic meters", "cubic metre", "cubic metres"] },
  { id: "gal", cat: "volume", factor: 3.785411784, symbol: "gal", names: ["gal", "gallon", "gallons"] },
  { id: "qt", cat: "volume", factor: 0.946352946, symbol: "qt", names: ["qt", "quart", "quarts"] },
  { id: "pint", cat: "volume", factor: 0.473176473, symbol: "pints", names: ["pint", "pints"] },
  { id: "cup", cat: "volume", factor: 0.2365882365, symbol: "cups", names: ["cup", "cups"] },
  { id: "tbsp", cat: "volume", factor: 0.01478676478125, symbol: "tbsp", names: ["tbsp", "tablespoon", "tablespoons"] },
  { id: "tsp", cat: "volume", factor: 0.00492892159375, symbol: "tsp", names: ["tsp", "teaspoon", "teaspoons"] },
  { id: "floz", cat: "volume", factor: 0.0295735295625, symbol: "fl oz", names: ["floz", "fl oz", "fluid ounce", "fluid ounces"] },

  // energy, base joule
  { id: "J", cat: "energy", factor: 1, symbol: "J", exact: ["J"], names: ["joule", "joules"] },
  { id: "kJ", cat: "energy", factor: 1e3, symbol: "kJ", exact: ["kJ"], names: ["kj", "kilojoule", "kilojoules"] },
  { id: "MJ", cat: "energy", factor: 1e6, symbol: "MJ", exact: ["MJ"], names: ["mj", "megajoule", "megajoules"] },
  { id: "cal", cat: "energy", factor: 4.184, symbol: "cal", names: ["cal", "calorie", "calories"] },
  { id: "kcal", cat: "energy", factor: 4184, symbol: "kcal", names: ["kcal", "kilocalorie", "kilocalories"] },
  { id: "Wh", cat: "energy", factor: 3600, symbol: "Wh", exact: ["Wh"], names: ["wh", "watt hour", "watt hours"] },
  { id: "kWh", cat: "energy", factor: 3.6e6, symbol: "kWh", exact: ["kWh"], names: ["kwh", "kilowatt hour", "kilowatt hours"] },
  { id: "MWh", cat: "energy", factor: 3.6e9, symbol: "MWh", exact: ["MWh"], names: ["mwh", "megawatt hour", "megawatt hours"] },
  { id: "BTU", cat: "energy", factor: 1055.05585262, symbol: "BTU", names: ["btu", "btus"] },

  // power, base watt
  { id: "W", cat: "power", factor: 1, symbol: "W", exact: ["W"], names: ["watt", "watts"] },
  { id: "kW", cat: "power", factor: 1e3, symbol: "kW", exact: ["kW"], names: ["kw", "kilowatt", "kilowatts"] },
  { id: "MW", cat: "power", factor: 1e6, symbol: "MW", exact: ["MW"], names: ["megawatt", "megawatts"] },
  { id: "GW", cat: "power", factor: 1e9, symbol: "GW", exact: ["GW"], names: ["gw", "gigawatt", "gigawatts"] },
  { id: "hp", cat: "power", factor: 745.69987158227022, symbol: "hp", names: ["hp", "horsepower"] },

  // pressure, base pascal
  { id: "Pa", cat: "pressure", factor: 1, symbol: "Pa", exact: ["Pa"], names: ["pa", "pascal", "pascals"] },
  { id: "kPa", cat: "pressure", factor: 1e3, symbol: "kPa", exact: ["kPa"], names: ["kpa", "kilopascal", "kilopascals"] },
  { id: "MPa", cat: "pressure", factor: 1e6, symbol: "MPa", exact: ["MPa"], names: ["mpa", "megapascal", "megapascals"] },
  { id: "bar", cat: "pressure", factor: 1e5, symbol: "bar", names: ["bar", "bars"] },
  { id: "psi", cat: "pressure", factor: 6894.757293168, symbol: "psi", names: ["psi"] },
  { id: "atm", cat: "pressure", factor: 101325, symbol: "atm", names: ["atm", "atmosphere", "atmospheres"] },
  { id: "mmHg", cat: "pressure", factor: 133.322387415, symbol: "mmHg", names: ["mmhg"] },

  // force, base newton ("kn" stays knots, so kilonewton is case-sensitive)
  { id: "N", cat: "force", factor: 1, symbol: "N", exact: ["N"], names: ["newton", "newtons"] },
  { id: "kN", cat: "force", factor: 1e3, symbol: "kN", exact: ["kN"], names: ["kilonewton", "kilonewtons"] },
  { id: "lbf", cat: "force", factor: 4.4482216152605, symbol: "lbf", names: ["lbf"] },

  // frequency, base hertz
  { id: "Hz", cat: "frequency", factor: 1, symbol: "Hz", names: ["hz", "hertz"] },
  { id: "kHz", cat: "frequency", factor: 1e3, symbol: "kHz", names: ["khz", "kilohertz"] },
  { id: "MHz", cat: "frequency", factor: 1e6, symbol: "MHz", names: ["mhz", "megahertz"] },
  { id: "GHz", cat: "frequency", factor: 1e9, symbol: "GHz", names: ["ghz", "gigahertz"] },
  { id: "rpm", cat: "frequency", factor: D(1).div(60), symbol: "rpm", names: ["rpm"] },
  { id: "fps", cat: "frequency", factor: 1, symbol: "fps", names: ["fps"] },

  // fuel economy, base km/l; l/100km is reciprocal (base = 100 / v)
  { id: "kmpl", cat: "fuel", factor: 1, symbol: "km/l", names: ["kmpl"] },
  { id: "mpg", cat: "fuel", factor: D("1.609344").div("3.785411784"), symbol: "mpg", names: ["mpg"] },
  { id: "l100km", cat: "fuel", factor: 100, recip: true, symbol: "l/100km", names: ["l100km"] },

  // angle, base radian
  { id: "rad", cat: "angle", factor: 1, symbol: "rad", names: ["rad", "radian", "radians"] },
  { id: "deg", cat: "angle", factor: D("3.141592653589793238462643383279503").div(180), symbol: "°", names: ["deg", "degree", "degrees"] },
];

// Currencies. factor = USD per 1 unit, from a static fallback table (units per USD below);
// live rates overwrite via setCurrencyRates. Approximate is fine: this is the offline fallback.
interface CurDef {
  code: string;
  perUsd: number;
  symbol: string;
  dp?: number;
  names?: string[];
}

const CURRENCIES: CurDef[] = [
  { code: "USD", perUsd: 1, symbol: "$", names: ["dollar", "dollars"] },
  { code: "EUR", perUsd: 0.9, symbol: "€", names: ["euro", "euros"] },
  { code: "GBP", perUsd: 0.78, symbol: "£" },
  { code: "JPY", perUsd: 155, symbol: "¥", dp: 0, names: ["yen"] },
  { code: "INR", perUsd: 84, symbol: "₹", names: ["rupee", "rupees"] },
  { code: "AUD", perUsd: 1.52, symbol: "A$" },
  { code: "CAD", perUsd: 1.36, symbol: "C$" },
  { code: "CHF", perUsd: 0.88, symbol: "CHF" },
  { code: "CNY", perUsd: 7.2, symbol: "CN¥", names: ["yuan", "renminbi"] },
  { code: "HKD", perUsd: 7.8, symbol: "HK$" },
  { code: "NZD", perUsd: 1.66, symbol: "NZ$" },
  { code: "SEK", perUsd: 10.5, symbol: "kr" },
  { code: "NOK", perUsd: 10.8, symbol: "kr" },
  { code: "DKK", perUsd: 6.7, symbol: "kr" },
  { code: "SGD", perUsd: 1.33, symbol: "S$" },
  { code: "KRW", perUsd: 1380, symbol: "₩", dp: 0, names: ["won"] },
  { code: "RUB", perUsd: 92, symbol: "₽", names: ["ruble", "rubles"] },
  { code: "BRL", perUsd: 5.4, symbol: "R$" },
  { code: "MXN", perUsd: 18.5, symbol: "MX$" },
  { code: "ZAR", perUsd: 18, symbol: "R" },
  { code: "TRY", perUsd: 34, symbol: "₺", names: ["lira"] },
  { code: "AED", perUsd: 3.67, symbol: "AED" },
  { code: "PLN", perUsd: 3.9, symbol: "zł" },
  { code: "THB", perUsd: 34.5, symbol: "฿", names: ["baht"] },
  { code: "IDR", perUsd: 16200, symbol: "Rp", dp: 0 },
  { code: "PHP", perUsd: 58, symbol: "₱" },
  { code: "MYR", perUsd: 4.4, symbol: "RM" },
  { code: "VND", perUsd: 25400, symbol: "₫", dp: 0 },
  { code: "ILS", perUsd: 3.7, symbol: "₪", names: ["shekel", "shekels"] },
  { code: "CZK", perUsd: 22.8, symbol: "Kč" },
  { code: "HUF", perUsd: 355, symbol: "Ft", dp: 0 },
  { code: "BTC", perUsd: 0.0000152, symbol: "₿", dp: 8, names: ["bitcoin", "bitcoins"] },
  { code: "ETH", perUsd: 0.0003, symbol: "Ξ", dp: 6, names: ["ether", "ethereum"] },
];

const units: Unit[] = DEFS.map((d) => ({
  id: d.id,
  category: d.cat,
  factor: D(d.factor),
  offset: d.offset === undefined ? undefined : D(d.offset),
  symbol: d.symbol,
  recip: d.recip,
}));

const currencyUnits = new Map<string, Unit>();
for (const c of CURRENCIES) {
  currencyUnits.set(c.code, {
    id: c.code,
    category: "currency",
    factor: D(1).div(c.perUsd),
    symbol: c.symbol,
    dp: c.dp ?? 2,
    prefix: true,
  });
}

const byId = new Map<string, Unit>();
for (const u of units) byId.set(u.id, u);

// Lookup maps: exact (case-sensitive; single letters and data units) then lowercase.
const exactMap = new Map<string, Unit>();
const lowerMap = new Map<string, Unit>();
const twoWordMap = new Map<string, Unit>();

DEFS.forEach((d, i) => {
  const u = units[i];
  for (const n of d.exact ?? []) exactMap.set(n, u);
  for (const n of d.names ?? []) {
    if (n.includes(" ")) twoWordMap.set(n, u);
    else lowerMap.set(n.toLowerCase(), u);
  }
});
for (const c of CURRENCIES) {
  const u = currencyUnits.get(c.code)!;
  lowerMap.set(c.code.toLowerCase(), u);
  for (const n of c.names ?? []) lowerMap.set(n, u);
}

// "pounds" must mean mass, not GBP, so mass wins on collision (map insert order handles it:
// DEFS run first and lowerMap.set for currencies would overwrite; guard against that).
for (const d of DEFS) for (const n of d.names ?? []) if (!n.includes(" ")) lowerMap.set(n.toLowerCase(), byId.get(d.id)!);

const CUR_SYMBOLS: Record<string, string> = {
  $: "USD", "€": "EUR", "£": "GBP", "¥": "JPY", "₹": "INR", "₽": "RUB", "₩": "KRW", "฿": "THB", "₺": "TRY",
};

export function unitById(id: string): Unit {
  const u = byId.get(id) ?? currencyUnits.get(id);
  if (!u) throw new Error(`unknown unit ${id}`);
  return u;
}

// cooking densities in g/ml (= kg/l), for "300g butter in cups"
const SUBSTANCES: Record<string, number> = {
  water: 1,
  milk: 1.03,
  butter: 0.911,
  flour: 0.53,
  sugar: 0.845,
  honey: 1.42,
  oil: 0.92,
  rice: 0.85,
  oats: 0.41,
  cocoa: 0.52,
  salt: 1.217,
  cream: 1.01,
  yogurt: 1.03,
};

export function lookupSubstance(word: string): Decimal | null {
  const d = SUBSTANCES[word.toLowerCase()];
  return d === undefined ? null : D(d);
}

export function lookupUnitWord(word: string): Unit | null {
  return exactMap.get(word) ?? lowerMap.get(word.toLowerCase()) ?? null;
}

export function lookupTwoWord(a: string, b: string): Unit | null {
  return twoWordMap.get(`${a.toLowerCase()} ${b.toLowerCase()}`) ?? null;
}

export function currencyBySymbol(ch: string): Unit | null {
  const code = CUR_SYMBOLS[ch];
  return code ? currencyUnits.get(code)! : null;
}

// length unit -> matching area unit for "10m × 10m"
const AREA_OF: Record<string, string> = { m: "m2", km: "km2", cm: "cm2", ft: "ft2", inch: "in2" };
export function areaUnitFor(lengthUnit: Unit): Unit | null {
  const id = AREA_OF[lengthUnit.id];
  return id ? byId.get(id)! : null;
}
export function volumeUnit(): Unit {
  return byId.get("m3")!;
}

// Live rates: {"EUR": 0.91, ...} meaning units per USD. Called by the UI after fetching.
export function setCurrencyRates(perUsd: Record<string, number>) {
  for (const [code, rate] of Object.entries(perUsd)) {
    const u = currencyUnits.get(code.toUpperCase());
    if (u && rate > 0) u.factor = D(1).div(rate);
  }
}
