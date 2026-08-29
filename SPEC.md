# Calcool - build spec

A Windows notepad calculator modeled on Soulver (soulver.app).
Research compiled 2026-08-29 from documentation.soulver.app (all pages), soulver.app, the SoulverCore GitHub README and API docs, the official changelog through v4.0.2, and reviews (MacStories, Six Colors, Sweet Setup, HN threads).

Market note: Soulver 4 (June 2026) ships an official native Windows version, $39 direct / Microsoft Store, 60-day trial.
We are not first anymore.
Our angle: free/own product, faster iteration, and an engine we own end to end.

## The core paradigm

- A plain-text editor on the left, a live **answer column** on the right.
  Every keystroke re-evaluates the edited line and everything that depends on it.
  No equals key.
- **Word skipping** is the whole magic trick.
  The engine tokenizes a line, keeps what it understands (numbers, operators, units, keywords, variables), drops commentary words, and evaluates the last valid expression.
  `$19 for breakfast + $22 for the uber` gives `$41.00`.
  Lines with no math show nothing.
  Broken math shows nothing rather than an error banner.
- A floating **quick total** of the sheet sits bottom-right (switchable between sum / average / count / median in Soulver).
- Sheets are plain text underneath.
  Answers, tokens, and formatting are derived state.

## Engine feature inventory (Soulver 4 parity checklist)

Notation below: `input | output`.
P0/P1/P2 marks our build priority (P0 = v1).

### Arithmetic and numbers (P0)

- Operators `+ - * / × ÷ ^ **`, `%`/`mod` as remainder, parens, implicit multiplication (`2sin(pi/6)`).
- Word operators: `30 plus 20`, `3 multiplied by 4`, `1,000 divided by 200`, `3 to the power of 2`, `remainder of 21 divided by 5`.
- Thousands separators in input and output; `1_000_000` underscores; auto-insertion while typing (P1 editor behavior).
- Multiplier suffixes: `2.5k`, `5M`, `1G`, `2T`; currency forms `$3k`, `$5m`, `$7B`, `$9bn`, `USD1K`.
- Scientific input `1e3`; output `10500 in sci | 1.05e4`.
- SI display notation for big answers: `100,000 + 200,000 | 300k`, `3 million + 10% | 3.3M` (toggleable).
- Number words: `five hundred thirty three`, `1.4 million` (P1).
- Bases (P1): `0xFF`, `0b101`, `0o173` literals; `256 as hex | 0x100`, `99 in binary`, `0x2D as base 2`, `hex(99)`, `bin()`, `oct()`, `int(0o55)`; bitwise `& | xor << >>`; underscore grouping `0xCAFE_F00D`.
- Fractions (P1): `2/10 as fraction | 1/5`, `50% as fraction | 1/2`, input `1 1/2 pounds`, `0.534 to nearest 16th | 9/16`.
- Rounding phrases: `1/3 to 2 dp | 0.33`, `pi to 5 digits`, `5.5 rounded`, `rounded up/down`, `37 to nearest 10 | 40`, `21 rounded up to nearest 5 | 25`; `round() ceil() floor()`.

### Percentages (P0, all phrase forms)

- `10% of 200 | 20`, with commentary allowed: `20% discount off $500`, `5% gratuity on $95`.
- Add/subtract: `200 + 10% | 220`, `10% on 200 | 220`, `200 - 10% | 180`, `10% off 200 | 180`.
- Reverse: `20 is 10% of what | 200`, `180 is 10% off what | 200`, `220 is 10% on what | 200`.
- As-percent: `20 as a % of 200 | 10%`, `20 is what % of 200 | 10%`, `0.35 as % | 35%`, `2/5 as percent | 40%`.
- Change: `50 to 75 is what % | 50%`, `180 is what % off 200 | 10%`, `180 is what % on 150 | 20%`.
- Percent arithmetic: `10% + 20% | 30%`, `30% + 0.4 | 70%`, `50% × 30 | 15`.
- Multipliers (P1): `20/5 as multiplier | 4x`, `50 to 75 is what x | 1.5x`, `100 is what multiple of 50 | 2x`.

### Units (P0 core categories, P1 the rest)

- Convert with `in / to / as`: `10 km in m`, `100 pounds in kg | 45.36 kg`, `5 hours 30 minutes to seconds | 19,800 seconds`, reverse phrasing `days in 3 weeks | 21 days`, bare pair `km m | 1,000 m`.
- Assimilation: `300 + 20 km | 320 km`, `$20 + 30 | $50.00`; mixed compatible units, larger wins: `1km + 1,000m | 2 km`.
- `10m × 10m | 100 m²`; incompatible multiplication errors; `3 kg × 10 m/s² | 30 N` (P2).
- P0 categories: length, mass, temperature (affine!), duration, data storage (decimal + binary, bits + bytes), speed, area, volume, angle.
- P1: energy, power, frequency, data transfer, CSS px/em/pt, fuel, pressure, force.
- P2 (Soulver 4 additions): chemistry (mol, molarity), electrical (ohm/volt/amp/farad...), angular velocity (rpm), torque, music pitch (`440 hz as pitch | A4`), PPI/DPI (`1 cm in px @ 326 ppi`).
- Compound imperial: `3' 4" + 9' 2" | 12 feet 6 inches`, `13.5 lb | 13 lb 8 oz` (P1).
- Custom units (P2): `1 watermelon = 20 lb`, and whole new unit types (`operation = new unit`).
- Cooking density (P2): `300g butter in cups | 1.32 cup`, ~200 substances.
- Measurement system setting: US / Imperial / Metric cups, pints, gallons (P2).

### Currency (P0)

- `10 USD in EUR`, `30 USD in €`, symbol or 3-letter code, ~170 fiat + major crypto.
- Rates refresh hourly in Soulver; static fallback table when offline.
- Custom rate: `50 EUR in USD at 1.05 USD/EUR` (P1).
- Historical rates `10 USD in EUR on March 20` (P2, needs a paid data source).
- Currency rounding: display and propagate at the currency's preferred decimal places (2 most, 0 JPY, 3 BHD); variables keep unrounded values.
- `$` maps to the user's local currency; `US$ C$ A$ HK$` prefixes.

### Rates (P1)

- `$25/hour * 14 hours | $350.00`, `30 hours at $30/hour | $900.00`, `$500 at $20/hour | 25 hours`.
- `$99 per week`, `$20/day + $300/week | $440.00/week`, `€30/day in €/month`, `90 km / 3 days | 30 km/day`.
- Implicit rate: `$30 × 4 days | $120.00`.

### Variables and references (P0)

- `discount = 10%`, `Monthly Rent = $1500` (multi-word names), use below the declaration; redefinition applies to later lines; `+=` and `-=` (P1).
- Line references: token inserted by clicking a previous answer, or typing `line3`; only lines above; live-updating (P0 minimal: `line3`; P1: click-to-insert token UI).
- Autocomplete for variable names (P1).

### Totals and structure (P0)

- A line saying `total` / `sum` sums the run of result lines above (back to blank line, heading, or previous total).
  `average`, `count`, `median`, `min`, `max` likewise (P1 beyond total/average).
- List functions: `total of 3, 4, 7 and 9 | 23`, `average of 36, 42, 19 and 81 | 44.5`, `min 5, 3, 7`, `max`, `gcd`, `lcm`, `standard deviation` (P1).
- Headings: `# groceries` (bold, no answer, resets total scope).
- Labels: `rent: $1,500 | $1,500.00` (bold label, still calculates).
- Comments: `// whole line`, trailing `//`, trailing `#`, `(parenthetical with words)` ignored, `"quoted text"` ignored.
- A bare `10%` line inside a block applies to the running subtotal (tax/tip pattern) (P2).
- Tags `#work` on lines + `total of #work` (P2, Soulver 4).
- Dividers `---` (P2).

### Dates and times (P1, big but table-stakes)

- `today + 3 weeks`, `10 June + 3 weeks | 1 July`, `April 1, 2019 - 3 months 5 days`, `tomorrow`, `3 days ago`, `2 weeks from today`.
- Intervals: `January 10 - February 5 | 3 weeks 5 days`, `days since July 15`, `days until Christmas`, `days between 3 March and 30 May | 88 days`, `1978 to 2021 | 42 years`.
- Weekdays: `next friday`, `Monday in 3 weeks`, `day of the week on January 24, 1984 | Tuesday`.
- Quantities: `days in February 2020 | 29 days`, `hours in June`, `days left in 2026`, ISO week `week of year`.
- Calendar-aware month math: `Jan 31 2020 + 1 month | Feb 29 2020`.
- Workdays (P2): `workdays in 3 weeks | 15 workdays`, `December 24 + 2 workdays`, public holidays per region, `work hours between ...`.
- Clock times: `now + 3 hours 15 minutes`, `9:45 am - 15 hours`, `7:30 to 20:45 | 3 hours 15 min`, `4pm to 3am | 11 hours`, DST-aware.
- Time zones (P2): `6pm Sydney in Chicago`, `2am PST to GMT`, `time in Paris`, `9am SFO to JFK`, ~500 cities + airport codes + zone abbreviations.
- Timespans: `5.5 minutes as timespan | 5 min 30 s`, `3h 5m 10s in seconds`, double units `1.4 weeks in hours and minutes`.
- Timestamps: `April 1, 2019 to timestamp | 1554109200`, `1559740303 to date`, `current timestamp`, ISO 8601 both ways.
- Laptimes `03:04:05 + 01:02:03`, video timecode `00:30:10:00 @ 24 fps in frames` (P3).
- Sunrise/sunset/astronomy (P3, needs data).

### Finance (P2)

- Compound interest: `$1,000 after 3 years at 7% | $1,225.04`, `compounding monthly`, `interest on $1k after 3 years @ 7%`.
- Loans: `monthly repayment on $10,000 over 6 years at 6% | $165.73`, daily/annual/total variants, interest-only variants.
- ROI: `annual return on $1,000 invested $2,500 returned after 7 years | 13.99%`; present value; `deposit needed for $42k/year at 7.5%`.
- Sales tax phrases with configurable name+rate: `$300 + VAT | $345.00`, `VAT on $300`, `$300 - VAT | $260.87` (divides by 1.15, does not subtract 15%).
- Inflation via CPI (`what was $500 worth in 1997`), income tax per country: P3, needs data.
- Growth/transfer phrases: `time from 20k to 100k at 10% per month`, `time to download 3GB @ 10 MB/s`, pace `5 km in 25 min | 05:00/km`.

### Logic and misc functions (P1)

- `if earnings > $30k then tax = 20% else tax = 5%`, `unless`, `and/or`, comparisons `20km == 20,000 m | true`, `assert(expenses < $400)`.
- sqrt/cbrt/`root 5 of 100`, exp/ln/log/log2/`log 20 base 4`, abs, factorial, full trig + hyperbolic + degree variants (`sind(90)`), constants pi/tau/phi.
- `half of 175`, `midpoint between 150 and 300`, `larger of 100 and 200`, rule of three `6 is to 60 as 8 is to what | 80`, `random number between 1 and 10`, `clamp 26 between 5 and 25`, `is 59 prime`, permutations/combinations.
- Knowledge assistant `= ?` lines (Wolfram/LLM): P3, out of scope for now.
- Live stocks and weather: P3, out of scope for now.

### Output formatting

- Per-line and default decimal places; display rounding is cosmetic, full precision flows onward (except currency, see above).
- `as number` strips units/symbols; `to decimal` (`10:15 to decimal | 10.25`, `20% as dec | 0.2`).
- Format specifiers: `as fraction`, `as %`, `as multiplier`, `as hex/binary/octal/base N`, `as sci`, `as timespan`, `as laptime`, `as iso8601`, `to timestamp`, `to date`, `in X and Y`, `to N dp`, `to nearest N`.

## App feature inventory (the shell around the engine)

### Editor (P0)

- Answer column vertically aligned per line, correct even for wrapped lines.
- Syntax highlighting: numbers, units/currencies, operators, variables, keywords, comments, headings, labels; light + dark palettes.
- Click an answer: copy it.
  Double-click an answer from another line: insert a live reference token (P1).
- Quick total bottom-right.
- Autosave, restore on launch.

### Beyond v1

- P1: multi-sheet sidebar with folders, search, autosaved sheetbook (single JSON file), `.slvr`-style export/import, plain text export, find and replace.
- P1: Quick popup window on a global hotkey (Alt+Space style), tray icon, auto-converting single entries (`21 miles | 33.8 km`).
- P2: scrubbable numbers (drag to change a number, watch dependents update), `Ctrl+D` duplicate line, move lines by dragging answers, `Ctrl+/` comment toggle, `Ctrl+T` subtotal, `Ctrl+L` + number line references, variable rename refactor.
- P2: CSV/HTML/PDF export, print, copy line+answer, copy unformatted answer.
- P2: settings: number format region (1,000.5 vs 1.000,5 vs 1 000,5), default precision, currency symbol mapping, sales tax name/rate, hours per workday, theme, fonts.
- P3: sheet sync via user's cloud folder, CLI (`calcool "June 20 + 3 weeks"`), Soulver Studio-style single-sheet export, localization.

### File formats (for interop)

- Soulver 3/4 sheets are JSON (`.slvr`); the sheetbook is one JSON library file.
  Worth matching loosely so people can migrate.

## Licensing and prior-art notes

- SoulverCore itself ships prebuilt Windows DLLs (SoulverCore-Multiplatform repo): free for personal projects, commercial use needs a license.
  Wrapping it would be the fastest path but we would own nothing and ship a closed Swift-runtime blob.
  Decision: build our own engine.
- NoteCalc (Rust/WASM) is AGPL: read for ideas only.
  Qalculate/libqalculate is GPL: same.
  Numbat and fend (Rust, MIT/Apache) are permissive references for unit-engine design.
- Nobody in the Windows-native space has Soulver's word-skipping natural language quality.
  That parser is the product.

## Tech stack (decided)

- **Shell: Tauri 2** (Rust). ~10 MB installer, WebView2 is preinstalled on Win 11, gives us global hotkey + tray + single-instance plugins for the quick-popup window, auto-updater, MSI/NSIS bundling.
- **UI: React 18 + TypeScript + Vite + CodeMirror 6.** The editor is the app; CM6 provides decorations (syntax highlighting), per-line geometry (aligned answer column with wrapping), undo/IME/accessibility.
- **Engine: our own TypeScript library** (`src/engine/`), pure and DOM-free, decimal.js for arithmetic.
  Runs in the webview, so zero IPC per keystroke; portable to a future web or mobile build; goldens tested with vitest.
- Dates later via Luxon (uses the OS Intl timezone data, nothing to ship).
- Currency rates: open.er-api.com (free, no key, 160+ currencies) cached to disk daily, static fallback table baked in.
- Not chosen: C#/WPF (answer-column editor is far more work in AvalonEdit, no web portability), Electron (10x the size for nothing Tauri lacks here), engine in Rust (adds IPC or WASM plumbing now; we can port the hot path later if profiling ever demands it, which for a notepad it will not), wrapping SoulverCore (license + black box).

## Engine architecture

```
line text
  -> tokenizer      numbers (all literal forms), words, operators, symbols; spans kept for highlighting
  -> classifier     words become units / currencies / functions / keywords / variables, or get dropped (word skipping)
  -> parser         Pratt parser; percent phrases and conversions as special forms; falls back to "last valid expression"
  -> evaluator      Value = number | percent | unit quantity | rate; decimal.js; affine temperature; currency via rate table
  -> formatter      thousands separators, precision, SI notation, per-currency dp
sheet layer: top-down pass per edit; variables, line refs, total lines, dependency reevaluation
```

Golden tests in `src/engine/__tests__/` are the spec above turned into `input | output` assertions.
