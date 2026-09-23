// Built-in sample sheets: plain text only, every line evaluates offline.
// Added to the book from the sidebar Samples button; skipped when a same-named sheet exists.

export interface SampleSheet {
  title: string;
  text: string;
}

export const SAMPLE_SHEETS: SampleSheet[] = [
  {
    title: "Household budget",
    text: `# Household budget
Monthly take-home and bills.

paycheck = $3,200
rent = $1,450
groceries = $520
transport = $180
fun = $240
savings = paycheck - rent - groceries - transport - fun
savings is what % of paycheck
total
`,
  },
  {
    title: "Trip conversions",
    text: `# Trip conversions
Packing and driving math.

pack weight = 23 kg
pack weight in lb
320 miles in km
32 C in F
68 F in C
30 mpg in l/100km
2 cups flour in grams
`,
  },
];
