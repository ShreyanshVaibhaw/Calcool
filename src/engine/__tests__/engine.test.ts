import { beforeEach, describe, expect, test } from "vitest";
import { evaluateSheet, renameVariable } from "../sheet";
import { formatValue, setNumFormat, setPrecision } from "../format";
import { todayEpoch, nearestWeekday, toEpochDay, isoWeek } from "../dates";
import { setWorkdayConfig } from "../workdays";
import { setTaxConfig } from "../tax";
import { setCupSystem, unitById } from "../units";
import { Decimal } from "../value";

const line = (input: string): string => evaluateSheet(input).lines[0].formatted;
const dateStr = (ed: number): string => formatValue({ kind: "date", d: new Decimal(ed) });

// input | expected answer, mirroring SPEC.md
const GOLDENS: [string, string][] = [
  // arithmetic and number forms
  ["1 + 2", "3"],
  ["30 plus 20", "50"],
  ["3,000 minus 12", "2,988"],
  ["3 multiplied by 4", "12"],
  ["1,000 divided by 200", "5"],
  ["3 to the power of 2", "9"],
  ["2 ** 10", "1,024"],
  ["21 % 5", "1"],
  ["21 mod 5", "1"],
  ["1e3", "1,000"],
  ["2.5k", "2,500"],
  ["1.4 million", "1.4M"],
  ["100,000 + 200,000", "300k"],
  ["1_000_000 + 2_000", "1,002,000"],
  ["-5 + 3", "-2"],
  ["2 (3 + 4)", "14"],
  ["0.1 + 0.2", "0.3"],
  ["1/3", "0.3333333333"],
  ["sqrt(16)", "4"],
  ["square root of 81", "9"],
  ["sqrt(16) + 2^10", "1,028"],
  ["fact(5)", "120"],
  ["min(5, 3, 7)", "3"],
  ["pi to 2 dp", "3.14"],
  ["1/3 to 2 dp", "0.33"],
  ["37 to nearest 10", "40"],
  ["0xFF to decimal", "255"],
  ["255 as hex", "0xFF"],
  ["99 in binary", "0b1100011"],
  ["123 as octal", "0o173"],
  ["10500 in sci", "1.05e4"],
  ["2/10 as fraction", "1/5"],
  ["0.35 as %", "35%"],
  ["20% as dec", "0.2"],

  // percentages, all phrase forms
  ["10% of 200", "20"],
  ["200 + 10%", "220"],
  ["200 - 10%", "180"],
  ["10% off 200", "180"],
  ["10% on 200", "220"],
  ["20 is 10% of what", "200"],
  ["180 is 10% off what", "200"],
  ["220 is 10% on what", "200"],
  ["20 as a % of 200", "10%"],
  ["20 is what % of 200", "10%"],
  ["180 is what % off 200", "10%"],
  ["180 is what % on 150", "20%"],
  ["50 to 75 is what %", "50%"],
  ["10% + 20%", "30%"],
  ["30% + 0.4", "70%"],
  ["50% × 30", "15"],
  ["2/3 of 600", "400"],
  ["$30 for lunch + 20% tip", "$36.00"],
  ["20% discount off $500", "$400.00"],

  // units
  ["10 km in m", "10,000 m"],
  ["100 pounds in kg", "45.36 kg"],

  // compound imperial
  ["3' 4\" + 9' 2\"", "12 ft 6 in"],
  ["12 feet 6 inches", "12 ft 6 in"],
  ["5'6\" in cm", "167.64 cm"],
  ["6 ft 2 inches in cm", "187.96 cm"],
  ["13.5 lb", "13 lb 8 oz"],
  ["13.5 lb in lb and oz", "13 lb 8 oz"],
  ["13.5 lb in lb", "13.5 lb"],
  ["190 cm in feet and inches", "6 ft 2.8 in"],
  ["190 cm in ft", "6.23 ft"],
  ["90 kg in stone and lb", "14 stone 2.42 lb"],
  ["2 stone 3 lb in kg", "14.06 kg"],
  ["5.999999 ft + 0 ft", "6 ft"],

  // finance phrases
  ["$1,000 after 3 years at 7%", "$1,225.04"],
  ["interest on $1k after 3 years @ 7%", "$225.04"],
  ["$1,000 after 3 years at 7% compounding monthly", "$1,232.93"],
  ["$5,000 after 18 months at 4.5% compounded quarterly", "$5,347.14"],
  ["monthly repayment on $10,000 over 6 years at 6%", "$165.73"],
  ["total repayment on $10,000 over 6 years at 6%", "$11,932.48"],
  ["yearly repayment on $10,000 over 6 years at 6%", "$2,033.63"],
  ["annual return on $1,000 invested $2,500 returned after 7 years", "13.99%"],
  ["total of 3, 4, 7 and 9", "23"],
  ["$300 + VAT", "$345.00"],
  ["$300 - VAT", "$260.87"],
  ["VAT on $300", "$45.00"],

  // energy, power, pressure, force, frequency
  ["500 kcal in kJ", "2,092 kJ"],
  ["1 kWh in MJ", "3.6 MJ"],
  ["5 kW × 3 hours", "15 kWh"],
  ["60 W × 30 minutes", "30 Wh"],
  ["15 kWh / 3 hours", "5 kW"],
  ["15 kWh / 5 kW", "3 hours"],
  ["150 hp in kW", "111.85 kW"],
  ["32 psi in bar", "2.21 bar"],
  ["1 atm in kPa", "101.33 kPa"],
  ["500 N in lbf", "112.4 lbf"],
  ["2.4 GHz in MHz", "2,400 MHz"],
  ["3000 rpm in Hz", "50 Hz"],
  ["440 hz as pitch", "A4"],
  ["261.63 Hz as pitch", "C4"],
  ["880 hz as pitch", "A5"],

  // css lengths
  ["1 cm in px", "37.8 px"],
  ["1 inch in points", "72 pt"],
  ["24 px in points", "18 pt"],

  // cooking densities
  ["300g butter in cups", "1.39 cups"],
  ["2 cups flour in grams", "250.78 g"],
  ["500 ml milk in g", "515 g"],

  // download time via generic quantity-at-rate
  ["3 GB at 10 MB/s", "300 s"],
  ["3 GB at 10 MB/s in minutes", "5 min"],
  ["700 MB / (25 MB/s)", "28 s"],

  // fuel economy
  ["30 mpg in l/100km", "7.84 l/100km"],
  ["8 l/100km in mpg", "29.4 mpg"],
  ["500 miles / 20 gallons in mpg", "25 mpg"],
  ["5.5 l per 100 km in mpg", "42.77 mpg"],
  ["30 mpg in km/l", "12.75 km/l"],

  // video timecode
  ["00:30:10:00 @ 24 fps in frames", "43,440"],
  ["00:00:01:12 @ 24 fps in frames", "36"],
  ["01:00:00:00 at 30 fps in frames", "108,000"],
  ["00:30:10:00 @ 24 fps in minutes", "30.17 min"],
  ["60 fps in Hz", "60 Hz"],
  ["$25 per hour × 14 hours", "$350.00"],

  // cpi inflation (bundled BLS CPI-U table)
  ["$500 in 1997 worth in 2020", "$806.26"],
  ["$100 from 1970 worth in 2024", "$808.48"],
  ["inflation from 1990 to 2000", "31.75%"],
  ["inflation from 1997 to 2024", "95.44%"],

  // sunrise/sunset (NOAA solar math + city coordinates)
  ["sunrise in London on December 21 2020", "21 December 2020 at 8:04 am"],
  ["sunset in New York on June 21 2020", "21 June 2020 at 8:30 pm"],
  ["sunrise in Tokyo on March 20 2021", "20 March 2021 at 5:47 am"],

  // laptimes
  ["03:04:05 + 01:02:03", "04:06:08"],
  ["01:30:00 × 2", "03:00:00"],
  ["04:00:00 / 2", "02:00:00"],
  ["1:59:30 + 0:00:45", "02:00:15"],
  ["03:04:05 in minutes", "184.08 min"],
  ["65 kg in pounds", "143.3 lb"],
  ["1km + 1,000m", "2 km"],
  ["300 + 20 km", "320 km"],
  ["5 hours 30 minutes to seconds", "19,800 s"],
  ["0 C in F", "32 °F"],
  ["32 F to C", "0 °C"],
  ["10m × 10m", "100 m²"],
  ["1 GB in MB", "1,000 MB"],
  ["1 GiB in MiB", "1,024 MiB"],
  ["1 mm in km", "0.000001 km"],

  // currency (static fallback rates: EUR 0.90/USD)
  ["$19 for breakfast + $22 for the uber", "$41.00"],
  ["$20 + 30", "$50.00"],
  ["10 USD in EUR", "€9.00"],
  ["10 EUR in USD", "$11.11"],
  ["$200 + €200", "€380.00"],
  ["usd eur", "€0.90"],
  ["$3k", "$3,000.00"],

  // rates
  ["$120 / 4 days", "$30.00/day"],
  ["$25/hour * 14 hours", "$350.00"],
  ["30 hours at $30/hour", "$900.00"],
  ["$500 at $20/hour", "25 hours"],
  ["90 km / 3 days", "30 km/day"],

  // list functions
  ["total of 3, 4, 7 and 9", "23"],
  ["average of 36, 42, 19 and 81", "44.5"],

  // 1.1 number words and multipliers
  ["five hundred thirty three", "533"],
  ["twenty-one plus 9", "30"],
  ["one hundred and five", "105"],
  ["a hundred plus 5", "105"],
  ["two thousand five hundred", "2,500"],
  ["twenty-one plus nine", "30"],
  ["lunch for five plus $10", "$15.00"],
  ["20/5 as multiplier", "4x"],
  ["50 to 75 is what x", "1.5x"],
  ["50 to 75 as multiplier", "1.5x"],
  ["100 is what multiple of 50", "2x"],
  ["20/5 as x", "4x"],

  // 1.2 bitwise and base functions
  ["0xFF & 0x0F", "15"],
  ["5 xor 3", "6"],
  ["5 | 3", "7"],
  ["1 << 4", "16"],
  ["256 >> 4", "16"],
  ["hex(99)", "0x63"],
  ["bin(10)", "0b1010"],
  ["oct(64)", "0o100"],
  ["int(0o55)", "45"],
  ["0xCAFE_F00D as number", "3,405,705,229"],

  // 1.3 mixed fractions and nearest fraction
  ["1 1/2", "1.5"],
  ["1 1/2 pounds in kg", "0.68 kg"],
  ["my 1 1/2 pounds in kg for fun", "0.68 kg"],
  ["0.534 to nearest 16th", "9/16"],
  ["0.534 to nearest 1/16", "9/16"],
  ["50% as fraction", "1/2"],

  // 1.4 logic, comparisons, math
  ["20km == 20,000 m", "true"],
  ["5 > 3", "true"],
  ["5 < 3", "false"],
  ["5 != 3", "true"],
  ["5 >= 5", "true"],
  ["20km equals 20,000 m", "true"],
  ["5 is 5", "true"],
  ["if 5 > 3 then 10 else 20", "10"],
  ["if 5 < 3 then 10 else 20", "20"],
  ["10 unless 5 > 3", ""],
  ["10 unless 5 < 3", "10"],
  ["not 5 > 3", "false"],
  ["5 > 3 and 2 < 4", "true"],
  ["5 > 3 or 2 > 4", "true"],
  ["assert(5 > 3)", "true"],
  ["half of 175", "87.5"],
  ["midpoint between 150 and 300", "225"],
  ["larger of 100 and 200", "200"],
  ["smaller of 100 and 200", "100"],
  ["6 is to 60 as 8 is to what", "80"],
  ["clamp 26 between 5 and 25", "25"],
  ["is 59 prime", "true"],
  ["is 60 prime", "false"],
  ["root 5 of 100 to 2 dp", "2.51"],
  ["npr(5, 2)", "20"],
  ["ncr(5, 2)", "10"],
  ["e to 4 dp", "2.7183"],
  ["my lunch cost 5 and 3", "3"],

  // 1.5 list stats
  ["min 5, 3, 7", "3"],
  ["max 5, 3, 7", "7"],
  ["my gcd of 12, 18 and 24 please", "6"],
  ["gcd(12, 18)", "6"],
  ["lcm of 4 and 6", "12"],
  ["standard deviation of 2, 4, 4, 4, 5, 5, 7, 9", "2"],

  // 1.6 tags (#tag stays math, "# note" stays a comment)
  ["lunch $20 #work", "$20.00"],
  ["lunch $20 # note", "$20.00"],
  ["total of #work", ""],

  // 1.7 currency extras (offline fallback table: CAD 1.36, AUD 1.52, HKD 7.8 per USD)
  ["50 EUR in USD at 1.05", "$52.50"],
  ["50 EUR in USD at 1.05 USD/EUR", "$52.50"],
  ["C$100 in USD at 0.75", "$75.00"],
  ["C$100 in USD", "$73.53"],
  ["lunch cost me C$100 in USD please", "$73.53"],
  ["A$10 in USD", "$6.58"],
  ["US$50", "$50.00"],
  ["HK$100 in USD", "$12.82"],

  // 1.8 units
  ["2 mol in mmol", "2,000 mmol"],
  ["500 mM in M", "0.5 M"],
  ["2 mol/L in M", "2 M"],
  ["0.5 M in mol/L", "0.5 mol/L"],
  ["12 V in mV", "12,000 mV"],
  ["2 A in mA", "2,000 mA"],
  ["4.7 kohm in ohm", "4,700 Ω"],
  ["1000 uF in mF", "1 mF"],
  ["5 N × 2 m", "10 Nm"],
  ["3 kg × 10 m/s²", "30 N"],
  ["32 ft/s² in m/s²", "9.75 m/s²"],
  ["10 Nm in lbft", "7.38 lb ft"],
  ["60 rpm in rad/s", "6.28 rad/s"],
  ["10 rad/s in Hz", "1.59 Hz"],
  ["360 deg/s in Hz", "1 Hz"],
  ["1 cm in px @ 326 ppi", "128.35 px"],
  ["1 cup in ml", "236.59 mL"],

  // 1.10 growth, pace, downloads
  ["time from 20k to 100k at 10% per month", "16.89 months"],
  ["time to download 3GB @ 10 MB/s", "300 s"],
  ["time to download 3GB @ 10 MB/s in minutes", "5 min"],
  ["5 km in 25 min", "05:00/km"],
  ["my 5 km morning run in 25 min", "05:00/km"],
  ["26.2 miles in 4 hours", "09:10/mi"],

  // 2.6 every region parses the same (displayed here in the default region)
  ["1,000.50", "1,000.5"],
  ["1.000,50", "1,000.5"],
  ["1 000,50", "1,000.5"],
  ["1,5 + 1", "2.5"],

  // 1.9 timestamps, timespans, ISO
  ["April 1, 2019 to timestamp", "1,554,076,800"],
  ["1559740303 to date", "5 June 2019"],
  ["5.5 minutes as timespan", "5 min 30 s"],
  ["3h 5m 10s in seconds", "11,110 s"],
  ["1.4 weeks in hours and minutes", "235 hours 12 min"],
  ["April 1, 2019 as iso8601", "2019-04-01"],
  ["2020-01-19T14:30", "19 January 2020 at 2:30 pm"],
  ["hours in June", "720 hours"],

  // word skipping
  ["lunch was $18.50 + 20% tip", "$22.20"],
  ["answer 42 costs $10", "$10.00"],
  ["flight $420 × 2", "$840.00"],
];

describe("golden single lines", () => {
  for (const [input, expected] of GOLDENS) {
    test(`${input} => ${expected}`, () => {
      expect(line(input)).toBe(expected);
    });
  }
});

describe("custom units", () => {
  test("1 watermelon = 20 lb defines a unit-like variable", () => {
    const r = evaluateSheet(["1 watermelon = 20 lb", "5 watermelons", "5 watermelons in kg", "3 watermelons + 2 watermelons"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["20 lb", "100 lb", "45.36 kg", "100 lb"]);
  });
});

describe("conditionals", () => {
  test("tax = if earnings > threshold then a else b assigns the taken branch", () => {
    const high = evaluateSheet(["earnings = $40k", "tax = if earnings > $30k then 20% else 5%", "tax of 100"].join("\n"));
    expect(high.lines.map((l) => l.formatted)).toEqual(["$40,000.00", "20%", "20"]);
    const low = evaluateSheet(["earnings = $20k", "tax = if earnings > $30k then 20% else 5%", "tax of 100"].join("\n"));
    expect(low.lines.map((l) => l.formatted)).toEqual(["$20,000.00", "5%", "5"]);
  });
  test("random number between 1 and 10 stays in range", () => {
    for (let i = 0; i < 50; i++) {
      const n = parseFloat(line("random number between 1 and 10").replace(/,/g, ""));
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(10);
      expect(Number.isInteger(n)).toBe(true);
    }
  });
});

describe("block aggregates and bare percent", () => {
  test("min/max/count/total share block scope", () => {
    const r = evaluateSheet(["10", "20", "30", "min", "", "5", "20", "max", "", "7", "count"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["10", "20", "30", "10", "", "5", "20", "20", "", "7", "1"]);
  });
  test("bare percent applies to the subtotal above", () => {
    const r = evaluateSheet(["100", "20", "10%"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["100", "20", "12"]);
  });
  test("tip pattern with money and total", () => {
    const r = evaluateSheet(["dinner was $100", "drinks $20", "tip 10%", "total"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["$100.00", "$20.00", "$12.00", "$132.00"]);
  });
});

describe("tags and dividers", () => {
  test("total of #work sums only tagged lines", () => {
    const r = evaluateSheet(["lunch $20 #work", "coffee $5 #work", "movie $15 #fun", "total of #work"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["$20.00", "$5.00", "$15.00", "$25.00"]);
  });
  test("plain total still sums tagged lines", () => {
    const r = evaluateSheet(["lunch $20 #work", "coffee $5 #fun", "total"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["$20.00", "$5.00", "$25.00"]);
  });
  test("count of #work counts tagged lines", () => {
    const r = evaluateSheet(["a 10 #work", "b 20", "c 30 #work", "count of #work"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["10", "20", "30", "2"]);
  });
  test("--- resets total scope", () => {
    const r = evaluateSheet(["10", "20", "---", "30", "total"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["10", "20", "", "30", "30"]);
  });
});

describe("compound assignment and redefinition", () => {
  test("x += 5 adds to the last value above", () => {
    const r = evaluateSheet(["x = 5", "x += 3", "x"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["5", "8", "8"]);
  });
  test("x -= 5 subtracts", () => {
    const r = evaluateSheet(["x = 10", "x -= 4", "x"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["10", "6", "6"]);
  });
  test("compound assignment on an unset variable stays silent", () => {
    expect(line("nope += 3")).toBe("");
  });
  test("later redefinition never changes earlier lines", () => {
    const r = evaluateSheet(["x = 5", "y = x", "x = 10", "y", "x"].join("\n"));
    expect(r.lines.map((l) => l.formatted)).toEqual(["5", "5", "10", "5", "10"]);
  });
});

describe("renameVariable", () => {
  test("renames definitions and uses", () => {
    const before = ["rent = $1,450", "rent × 12", "lunch was rent + $5"].join("\n");
    expect(renameVariable(before, "rent", "lease")).toBe(["lease = $1,450", "lease × 12", "lunch was lease + $5"].join("\n"));
  });
  test("skips comments, quoted text, and partial words", () => {
    const before = ["// rent is due", 'say "rent" loudly', "rental = 5", "rent = 1"].join("\n");
    expect(renameVariable(before, "rent", "lease")).toBe(["// rent is due", 'say "rent" loudly', "rental = 5", "lease = 1"].join("\n"));
  });
  test("renames multi-word variables", () => {
    const before = ["monthly rent = 5", "monthly  rent + 1"].join("\n");
    expect(renameVariable(before, "monthly rent", "rent")).toBe(["rent = 5", "rent + 1"].join("\n"));
  });
});

describe("configurable sales tax", () => {
  test("renamed tax word and rate apply", () => {
    setTaxConfig({ name: "GST", rate: 18 });
    expect(line("$100 + GST")).toBe("$118.00");
    expect(line("$300 + VAT")).toBe("$300.00"); // old word is plain prose again, word-skipped
    setTaxConfig({ name: "VAT", rate: 15 });
  });
});

describe("cup system", () => {
  test("metric and imperial cups convert", () => {
    try {
      setCupSystem("metric");
      expect(line("1 cup in ml")).toBe("250 mL");
      setCupSystem("imperial");
      expect(line("1 cup in ml")).toBe("284.13 mL");
    } finally {
      setCupSystem("us");
    }
  });
});

describe("number region and precision", () => {
  test("answers render in the configured region", () => {
    try {
      setNumFormat("de");
      expect(line("1234.5 + 0")).toBe("1.234,5");
      expect(line("$1234.5")).toBe("$1.234,50");
      setNumFormat("fr");
      expect(line("1234.5 + 0")).toBe("1 234,5");
    } finally {
      setNumFormat("en");
    }
  });

  test("precision caps plain decimals", () => {
    try {
      setPrecision(2);
      expect(line("10 / 3")).toBe("3.33");
      expect(line("100 m in km")).toBe("0.1 km");
    } finally {
      setPrecision(10);
    }
  });
});

describe("timestamps and calendar queries", () => {
  test("current timestamp is now", () => {
    const n = parseInt(line("current timestamp").replace(/,/g, ""), 10);
    expect(n).toBeGreaterThan(1700000000);
    expect(Date.now() / 1000 - n).toBeLessThan(60);
  });
  test("days left in 2026 tracks today", () => {
    const left = toEpochDay({ y: 2027, m: 1, d: 1 }) - todayEpoch();
    expect(line("days left in 2026")).toBe(formatValue({ kind: "quantity", d: new Decimal(left), unit: unitById("day") }));
  });
  test("week of year is the ISO week", () => {
    expect(line("week of year")).toBe(String(isoWeek(todayEpoch())));
  });
});

describe("lines that must stay silent", () => {
  for (const input of ["just some words", "meeting next week", "// a comment", "# a heading"]) {
    test(JSON.stringify(input), () => {
      expect(line(input)).toBe("");
    });
  }
});

describe("date math", () => {
  const FIXED: [string, string][] = [
    // year-independent: June 10 + 21 days is always July 1
    ["June 10 + 3 weeks", "1 July"],
    ["April 1, 2019 - 3 months 5 days", "27 December 2018"],
    ["January 31 2020 + 1 month", "29 February 2020"],
    ["3 weeks after March 14, 2019", "4 April 2019"],
    ["28 days before March 12, 2020", "13 February 2020"],
    ["2020-01-19 + 10", "29 January 2020"],
    ["days between 3 March 2020 and 30 May 2020", "88 days"],
    ["3 March 2020 to 30 May 2020", "2 months 3 weeks 6 days"],
    ["January 10 2020 - February 5 2020", "3 weeks 5 days"],
    ["1978 to 2021", "43 years"],
    ["day of the week on January 24, 1984", "Tuesday"],
    ["weekday on March 9, 2024", "Saturday"],
    ["days in February 2020", "29 days"],
    ["days in 2020", "366 days"],
  ["hours in June", "720 hours"],
    ["days in 3 weeks", "21 days"],
    ["days until tomorrow", "1 day"],
    ["days since yesterday", "1 day"],
  ];
  for (const [input, expected] of FIXED) {
    test(`${input} => ${expected}`, () => {
      expect(line(input)).toBe(expected);
    });
  }

  test("today-relative dates", () => {
    const t = todayEpoch();
    expect(line("today + 3 weeks")).toBe(dateStr(t + 21));
    expect(line("2 weeks from today")).toBe(dateStr(t + 14));
    expect(line("1 week ago")).toBe(dateStr(t - 7));
    expect(line("next friday")).toBe(dateStr(nearestWeekday(t, 5, 1)));
    expect(line("tomorrow")).toBe(dateStr(t + 1));
  });

  test("christmas", () => {
    expect(line("christmas")).toMatch(/^25 December/);
    expect(line("days until christmas")).toMatch(/^\d+ days?$/);
  });

  test("date variables cascade", () => {
    const s = evaluateSheet("deadline = June 10 2027\ndeadline + 3 weeks");
    expect(s.lines[1].formatted).toBe("1 July 2027");
  });

  test("trailing date annotations do not hijack money lines", () => {
    expect(line("lunch $20 on March 5")).toBe("$20.00");
  });

  test("dates never join totals", () => {
    const s = evaluateSheet("$10\ntomorrow\n$20\ntotal");
    expect(s.lines[3].formatted).toBe("$30.00");
  });

  test("prose weekdays stay silent", () => {
    expect(line("meeting on Monday")).toBe("");
    expect(line("June")).toBe("");
  });
});

describe("clock times and timezones", () => {
  const FIXED: [string, string][] = [
    ["17:30 to 20:45", "3 hours 15 min"],
    ["4pm to 3am", "11 hours"],
    ["5pm - 7pm", "2 hours"],
    ["noon + 90 minutes", "1:30 pm"],
    ["midnight + 1 hour", "1:00 am"],
    ["16:00 + 3 hours 12 minutes", "7:12 pm"],
    ["3:45pm + 5", "8:45 pm"],
    ["9:45 am - 15 hours 10 minutes", "Yesterday at 6:35 pm"],
    ["10:15 to decimal", "10.25"],
    ["time difference between GMT and GMT+8", "8 hours"],
    ["hours between 9am and 5:30pm", "8.5 hours"],
    // fully anchored, so DST resolves the same on any run date
    ["January 15 2027 2am PST to GMT", "15 January 2027 at 10:00 am"],
    ["March 5 2027 6pm Sydney in Chicago", "5 March 2027 at 1:00 am"],
  ];
  for (const [input, expected] of FIXED) {
    test(`${input} => ${expected}`, () => {
      expect(line(input)).toBe(expected);
    });
  }

  test("zone re-display keeps the instant", () => {
    // the wall date may differ from the local one, but the clock must read 5:00 pm
    expect(line("3pm GMT to GMT+2")).toMatch(/5:00 pm$/);
  });

  test("time in <zone> answers something time-shaped", () => {
    expect(line("time in Tokyo")).toMatch(/\d{1,2}:\d{2} (am|pm)$/);
  });

  test("time annotations do not hijack money lines", () => {
    expect(line("lunch $20 at 1pm")).toBe("$20.00");
  });

  test("a lone clock still answers", () => {
    expect(line("meeting at 4pm")).toBe("4:00 pm");
  });

  test("times stay out of totals", () => {
    const s = evaluateSheet("$10\n4pm\n$20\ntotal");
    expect(s.lines[3].formatted).toBe("$30.00");
  });
});

describe("workdays and holidays", () => {
  beforeEach(() => setWorkdayConfig({ region: "US" }));

  const FIXED: [string, string][] = [
    // Christmas 2027 falls on Saturday, observed Friday Dec 24; two workdays later is Tuesday
    ["December 24 2027 + 2 workdays", "28 December 2027"],
    ["workdays in 3 weeks", "15 workdays"],
    ["10 March 2027 to 17 March 2027 in workdays", "5 workdays"],
    ["workdays from April 12 2027 to June 15 2027", "45 workdays"],
    // June 2027 has 22 weekdays minus Juneteenth observed on Friday the 18th
    ["workdays in June 2027", "21 workdays"],
    ["55 hours in work days", "6.88 workdays"],
    ["$500/workday × 4 weeks", "$10,000.00"],
    ["work hours between March 12 2027 and March 25 2027", "72 work hours"],
  ];
  for (const [input, expected] of FIXED) {
    test(`${input} => ${expected}`, () => {
      expect(line(input)).toBe(expected);
    });
  }

  test("India region skips Republic Day", () => {
    setWorkdayConfig({ region: "IN" });
    expect(line("January 25 2027 + 1 workday")).toBe("27 January 2027");
    setWorkdayConfig({ region: "US" });
  });
});

describe("sheet behavior", () => {
  test("total sums the block above", () => {
    const s = evaluateSheet("3\n4\n7\ntotal");
    expect(s.lines[3].formatted).toBe("14");
  });

  test("total stops at headings", () => {
    const s = evaluateSheet("10\n20\n# expenses\n5\n6\ntotal");
    expect(s.lines[5].formatted).toBe("11");
  });

  test("second total only covers its own block", () => {
    const s = evaluateSheet("$100\n$50\ntotal\n$20\ntotal");
    expect(s.lines[2].formatted).toBe("$150.00");
    expect(s.lines[4].formatted).toBe("$20.00");
  });

  test("variables", () => {
    const s = evaluateSheet("rent = $1,450\nrent × 12");
    expect(s.lines[0].formatted).toBe("$1,450.00");
    expect(s.lines[1].formatted).toBe("$17,400.00");
  });

  test("percent variable applies to money", () => {
    const s = evaluateSheet("a = 10%\nprice = $200\nprice - a");
    expect(s.lines[2].formatted).toBe("$180.00");
  });

  test("line references", () => {
    const s = evaluateSheet("100\nline1 + 10");
    expect(s.lines[1].formatted).toBe("110");
  });

  test("labels still calculate", () => {
    const s = evaluateSheet("flights: $420 × 2");
    expect(s.lines[0].formatted).toBe("$840.00");
    expect(s.lines[0].sem.some((t) => t.type === "label")).toBe(true);
  });

  test("paren commentary is ignored", () => {
    expect(line("$999 (for the phone)")).toBe("$999.00");
  });

  test("comments produce no answer but math after // is dead", () => {
    const s = evaluateSheet("// note\n5 + 5 // ten");
    expect(s.lines[0].formatted).toBe("");
    expect(s.lines[1].formatted).toBe("10");
  });

  test("quick total", () => {
    const s = evaluateSheet("$10\n$20");
    expect(s.totalFormatted).toBe("$30.00");
  });

  test("quick total prefers explicit totals", () => {
    const s = evaluateSheet("$10\n$20\ntotal\n\n$5");
    expect(s.totalFormatted).toBe("$30.00");
  });

  test("quick total modes cover the same pool", () => {
    const s = evaluateSheet("$10\n$20\n$30");
    expect(s.modes).toEqual({ sum: "$60.00", average: "$20.00", count: "3", median: "$20.00" });
  });

  test("quick total modes skip answer-less lines", () => {
    const s = evaluateSheet("hello\n$10\n\n$20");
    expect(s.modes.count).toBe("2");
    expect(s.modes.sum).toBe("$30.00");
  });
});
