import { describe, expect, test } from "vitest";
import { sheetRows, toCSV, toHTML, copyLineText, plainAnswer } from "./export";

describe("sheetRows", () => {
  test("pairs lines with live answers", () => {
    expect(sheetRows("1 + 2\njust words")).toEqual([
      { line: "1 + 2", answer: "3" },
      { line: "just words", answer: "" },
    ]);
  });
  test("a sheet with totals exports every row including the total", () => {
    const rows = sheetRows("rent = $1,450\nrent * 12\ntotal");
    expect(rows).toEqual([
      { line: "rent = $1,450", answer: "$1,450.00" },
      { line: "rent * 12", answer: "$17,400.00" },
      { line: "total", answer: "$18,850.00" },
    ]);
    expect(toCSV(rows)).toContain('total,"$18,850.00"');
    expect(toHTML("Budget", rows)).toContain("<td>total</td><td>$18,850.00</td>");
  });
});

describe("toCSV", () => {
  test("escapes commas, quotes, and newlines", () => {
    const csv = toCSV([
      { line: 'lunch, "dinner"', answer: "$22.20" },
      { line: "plain", answer: "" },
      { line: "two\nlines", answer: "3" },
    ]);
    expect(csv).toBe('line,answer\n"lunch, ""dinner""",$22.20\nplain,\n"two\nlines",3\n');
  });
});

describe("toHTML", () => {
  test("escapes markup and keeps answers right-aligned", () => {
    const html = toHTML("A&B", [{ line: "<b>1+1</b>", answer: "2" }]);
    expect(html).toContain("<title>A&amp;B</title>");
    expect(html).toContain("<td>&lt;b&gt;1+1&lt;/b&gt;</td><td>2</td>");
  });
});

describe("copyLineText", () => {
  test("joins line and answer, bare lines copy as-is", () => {
    expect(copyLineText("lunch $20", "$20.00")).toBe("lunch $20 = $20.00");
    expect(copyLineText("just words", "")).toBe("just words");
  });
});

describe("plainAnswer", () => {
  test("strips commas and leading currency", () => {
    expect(plainAnswer("$1,234.56")).toBe("1234.56");
    expect(plainAnswer("C$73.53")).toBe("73.53");
    expect(plainAnswer("-$5.00")).toBe("-5.00");
  });
  test("keeps units, percent, pace, and words", () => {
    expect(plainAnswer("45.36 kg")).toBe("45.36 kg");
    expect(plainAnswer("10%")).toBe("10%");
    expect(plainAnswer("05:00/km")).toBe("05:00/km");
    expect(plainAnswer("true")).toBe("true");
    expect(plainAnswer("")).toBe("");
  });
});
