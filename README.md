# Calcool

A notepad calculator for Windows, modeled on [Soulver](https://soulver.app).
Type math as plain sentences; answers appear live in a column on the right.

```
lunch was $18.50 + 20% tip        $22.20
100 pounds in kg                  45.36 kg
rent = $1,450
rent × 12                         $17,400.00
total
```

## Stack

Tauri 2 (Rust shell) + React + TypeScript + CodeMirror 6.
The calculation engine is our own TypeScript library in `src/engine/` built on decimal.js: a word-skipping tokenizer, a Pratt parser with percent/conversion phrase forms, a typed evaluator (numbers, percents, unit quantities, rates), and a sheet layer for variables, line references, and totals.
[SPEC.md](SPEC.md) holds the full Soulver feature research and the roadmap.

## Commands

```
npm install          # once
npm run dev          # engine + UI in the browser (Vite, port 1420)
npm test             # engine golden tests (vitest)
npm run tauri dev    # the actual Windows app, debug
npm run tauri build  # release build; installers land in src-tauri/target/release/bundle/
```

## Works today

- Live per-line answers, word skipping, syntax highlighting, click-to-copy, quick total pill, autosave
- Multi-sheet sidebar: sheetbook store, titles from the first line, double-click a title to rename (empty reverts to auto), most-recent-first, search matches text and names, Ctrl+N new sheet, Ctrl+\ toggle, delete with a 20-entry trash kept in the store for recovery
- Quick popup on a global hotkey: Alt+Space, falling back through Ctrl+Alt+Space / Alt+Shift+Space / Ctrl+Shift+Space / Alt+Q when a launcher owns the earlier ones (Flow Launcher and PowerToys Run both squat on Alt+Space). One-line calculator, always on top; Enter copies the answer and closes, Esc or losing focus closes. Bare entries auto-convert QuickSoulver-style: `21 miles` answers `33.8 km`, `31 C` answers `87.8 °F`, foreign currency answers in USD
- Arithmetic incl. word operators, `2.5k`/`5M` multipliers, `1e3`, `0xFF`/`0b`/`0o`, thousands separators
- Every common percent phrase: `10% of 200`, `200 - 10%`, `20 is what % of 160`, `180 is 10% off what`, `50 to 75 is what %`
- Units with conversion and assimilation: length, mass, duration, temperature, data, speed, area, volume, angle, energy, power, pressure, force, frequency, CSS px and points
- Cross-unit physics: `5 kW × 3 hours` gives `15 kWh`, `15 kWh / 5 kW` gives `3 hours`, and any quantity divides by a matching rate - `3 GB at 10 MB/s in minutes` gives `5 min`
- Cooking densities: `300g butter in cups`, `2 cups flour in grams` (water, milk, butter, flour, sugar, honey, oil, rice, oats, cocoa, salt, cream, yogurt)
- Music pitch: `440 hz as pitch` gives `A4`
- Custom units: `1 watermelon = 20 lb`, then `5 watermelons` gives `100 lb` and `5 watermelons in kg` converts (plural forms find the singular definition)
- Laptimes: a full `H:MM:SS` is a duration - `03:04:05 + 01:02:03` gives `04:06:08`, `01:30:00 × 2` gives `03:00:00`, `03:04:05 in minutes` goes decimal; clock math like `7:30 + 90 minutes` is untouched
- Compound imperial units: `3' 4" + 9' 2"` gives `12 ft 6 in`, `5'6" in cm`, `12 feet 6 inches`, `13.5 lb` shows as `13 lb 8 oz`, `190 cm in feet and inches`, `90 kg in stone and lb`. Asking for a single unit (`in ft`) keeps the plain decimal
- Currency with hourly-cached live rates (open.er-api.com) and an offline fallback table
- Rates: `$25/hour × 14 hours`, `$500 at $20/hour`, `90 km / 3 days`
- Finance phrases: compound interest (`$1,000 after 3 years at 7%`, `compounding monthly`, `interest on $1k after 3 years @ 7%`), loan repayments (`monthly repayment on $10,000 over 6 years at 6%`, `total`/`yearly`/`weekly` variants), and annualized return (`annual return on $1,000 invested $2,500 returned after 7 years`)
- Sales tax with a configurable word and rate (default VAT at 15%): `$300 + VAT` gives `$345.00`, `VAT on $300` gives the tax portion, and `$300 - VAT` divides included tax back out (`$260.87`)
- Settings (Ctrl+,): theme, workday holiday region, hours per workday, sales-tax word and rate, quick-popup hotkey picker - calculation changes re-evaluate open sheets immediately
- Real file sheets: each sheet is a `.calcool` text file in `Documents\Calcool` named after its title, with a `book.json` index. Existing sheets migrate on first launch, files dropped into the folder become sheets, files deleted outside heal out of the index, and settings has an Open sheets folder button. The browser dev build keeps localStorage
- Variables (`rent = $1,450`, multi-word names), `total`/`average` lines, headings, labels, `//` and `#` comments
- Live reference tokens: `lineN` renders as a pill showing the referenced answer; double-click an answer (or drag it into a line) to insert one, Ctrl+\ references the nearest answer above, and typing an operator on an empty line auto-references the previous answer. Tokens renumber themselves when lines are added or removed; deleting a referenced line breaks its tokens loudly (struck-through pill) instead of silently repointing them
- Scrubbable numbers: hold Alt and drag any number sideways (or Alt+scroll) to change it live and watch every dependent line follow. Steps by the number's last decimal place, keeps digit grouping, and a whole drag is one undo
- Rounding and display forms: `to 2 dp`, `to nearest 10`, `as hex`, `as fraction`, `in sci`, `as %`
- Date math, calendar-aware: `today + 3 weeks`, `April 1, 2019 - 3 months 5 days`, `Jan 31 2020 + 1 month` clamps to Feb 29, `days until christmas`, `next friday`, `3 March to 30 May` gives `2 months 3 weeks 6 days`, `weekday on March 9, 2024`, `days in February 2020`, `1978 to 2021`
- Clock times: `now + 3 hours 15 minutes`, `4pm to 3am` gives `11 hours`, `noon + 90 minutes`, `3:45pm + 5`, `hours between 9am and 5:30pm`, `10:15 to decimal`
- Workdays and holidays: `December 24 2027 + 2 workdays` skips the observed Christmas, `workdays from April 12 to June 15`, `10 March to 17 March in workdays`, `workdays in June 2027`, `workdays left in 2026`, `work hours between two dates`, `55h in work days`, `$500/workday × 4 weeks`. Holiday rules are computed in-app (US federal, UK bank incl. Easter, India national), region picked from the OS locale
- Timezones, DST-correct via the platform ICU (nothing shipped): `6pm Sydney in Chicago`, `2am PST to GMT`, `time in Tokyo`, `9am SFO to JFK`, `3pm GMT+8 to Paris`, `time difference between London and Tokyo`, ~200 cities/countries/abbreviations/airport codes

## Next (see SPEC.md for the full list)

The P0-P2 roadmap is shipped. Remaining SPEC ideas: fuel economy, video timecode at a frame rate, CPI inflation data.
