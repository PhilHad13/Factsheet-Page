# Online Factsheet Prototype

This repository contains a live web factsheet prototype backed by the TAM master Excel workbook.

## Contents

- `factsheet-prototype/index.html` - the web factsheet page.
- `factsheet-prototype/data/factsheets.js` - generated website data for all available portfolios.
- `factsheet-prototype/factsheet.js` - selector, table, chart, allocation, regional exposure, and holdings rendering.
- `scripts/import-factsheet-data.mjs` - repeatable mapping from the TAM `.xlsm` workbook to website data.
- `outputs/factsheet_template/dynamic_factsheet_data_template.xlsx` - starter Excel data template retained for reference.

## Current mapping

The page currently maps 10 portfolios from `TAM Factsheet Data 30.06.2026.xlsm`:

- Active GBP and Active EUR
- Defensive 20, Cautious 40, Balanced 60, Growth 80, and High Growth 100
- Model and benchmark performance, monthly chart history, allocation, regional exposure, duration, yield, OCF, and top holdings

The latest monthly performance period present in that workbook ends on 30 April 2026, which is used as the website's data-as-of date.

## Refreshing the website data

The importer requires Node.js 20 or later. Install the declared project dependency using your configured package registry before running it:

```sh
npm install
```

Run the importer with the master workbook and desired output path:

```sh
node scripts/import-factsheet-data.mjs \
  "/path/to/TAM Factsheet Data 30.06.2026.xlsm" \
  "factsheet-prototype/data/factsheets.js"
```

The importer validates portfolio coverage, allocation totals, regional totals, monthly series completeness, and ranked holdings. The browser only needs the generated JavaScript data file; it does not need Excel or macro support.

The source workbook filename must include its date in `DD.MM.YYYY` format (for example, `TAM Factsheet Data 30.06.2026.xlsm`). This date is recorded in the generated data for traceability.

## Previewing the website

From the repository root, run `npm run preview`, then open `http://localhost:8765/factsheet-prototype/`.

## Source limitation

The workbook's `Performance Benchmark` sheet currently duplicates `Performance Model`. The importer therefore calculates available 1-, 3-, and 5-year benchmark returns from `Graph Data Benchmark`. Ten-year and inception benchmark figures display as unavailable until distinct benchmark values are supplied.
