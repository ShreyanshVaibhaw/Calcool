import { beforeEach, describe, expect, test } from "vitest";
import { evaluateSheet } from "../sheet";
import { formatValue } from "../format";
import { todayEpoch, nearestWeekday } from "../dates";
import { setWorkdayConfig } from "../workdays";
import { setTaxConfig } from "../tax";
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

describe("configurable sales tax", () => {
  test("renamed tax word and rate apply", () => {
    setTaxConfig({ name: "GST", rate: 18 });
    expect(line("$100 + GST")).toBe("$118.00");
    expect(line("$300 + VAT")).toBe("$300.00"); // old word is plain prose again, word-skipped
    setTaxConfig({ name: "VAT", rate: 15 });
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
});
