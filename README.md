# Online Factsheet Prototype

This repository contains a live web factsheet prototype backed by the TAM master Excel workbook.

## Contents

- `factsheet-prototype/index.html` - the web factsheet page.
- `factsheet-prototype/data/factsheets.js` - generated website data for all available portfolios.
- `factsheet-prototype/factsheet.js` - selector, table, chart, allocation, regional exposure, and holdings rendering.
- `scripts/import-standard-factsheet-data.mjs` - repeatable mapping from the standard factsheet `.xlsx` workbook to website data.
- `scripts/import-factsheet-data.mjs` - retained importer for the original legacy `.xlsm` workbook.
- `outputs/factsheet_template/dynamic_factsheet_data_template.xlsx` - starter Excel data template retained for reference.

## Current mapping

The page maps the portfolios present in the standard factsheet workbook. Each portfolio's objective, portfolio information, performance, allocation, regional exposure, and holdings are read from the matching workbook sheets.

The workbook report date is used as the website's data-as-of date.

## Refreshing the website data

The importer requires Node.js 20 or later. Install the declared project dependency using your configured package registry before running it:

```sh
npm install
```

Run the importer with the master workbook and desired output path:

```sh
node scripts/import-standard-factsheet-data.mjs \
  "/path/to/dynamic_factsheet_data_30_Jun_2026.xlsx" \
  "factsheet-prototype/data/factsheets.js"
```

The importer validates portfolio coverage, allocation totals, regional totals, monthly series completeness, and ranked holdings. The browser only needs the generated JavaScript data file; it does not need Excel or macro support.

The report date is read from the workbook rather than inferred from its filename.

## Previewing the website

From the repository root, run `npm run preview`, then open `http://localhost:8765/`. The root page forwards to the factsheet automatically, matching the behaviour expected from GitHub Pages.
