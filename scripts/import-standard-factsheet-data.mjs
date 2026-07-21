import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = path.resolve(
  process.argv[2] ?? "/Users/philliphadley/Downloads/dynamic_factsheet_data_30_Jun_2026.xlsx",
);
const outputPath = path.resolve(
  process.argv[3] ?? "factsheet-prototype/data/factsheets.js",
);

const requiredSheets = [
  "Factsheets",
  "Portfolio_Info",
  "Monthly_Series",
  "Asset_Allocation",
  "Regional_Exposure",
  "Holdings",
];

const round = (value, places = 4) => {
  if (!Number.isFinite(Number(value))) return null;
  const scale = 10 ** places;
  return Math.round((Number(value) + Number.EPSILON) * scale) / scale;
};

const asNumber = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value.replaceAll(",", "").replace("%", ""));
  return Number.isFinite(parsed) ? parsed : null;
};

const asPercent = (value) => {
  const parsed = asNumber(value);
  if (parsed === null) return null;
  if (typeof value === "string" && value.includes("%")) return round(parsed, 4);
  return round(Math.abs(parsed) <= 1 ? parsed * 100 : parsed, 4);
};

function excelDateToIso(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + value * 86400000).toISOString().slice(0, 10);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid Excel date: ${value}.`);
  return date.toISOString().slice(0, 10);
}

function recordsFromSheet(sheet) {
  const values = sheet.getUsedRange().values;
  const headerRowIndex = values.findIndex((row) => String(row[0] ?? "").trim() === "portfolio_id");
  if (headerRowIndex < 0) throw new Error(`Sheet ${sheet.name} does not contain a portfolio_id header.`);
  const headers = values[headerRowIndex].map((value) => String(value ?? "").trim());
  return values.slice(headerRowIndex + 1)
    .filter((row) => row.some((value) => value !== null && value !== ""))
    .map((row) => {
      const record = Object.fromEntries(headers.map((header, index) => [header, row[index]]));
      record.portfolio_id = String(record.portfolio_id ?? "").trim().replaceAll(" ", "_");
      return record;
    });
}

function groupBy(records, field) {
  const grouped = new Map();
  for (const record of records) {
    const key = String(record[field] ?? "").trim();
    if (!key) continue;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }
  return grouped;
}

function compoundReturns(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  return round((values.reduce((index, value) => index * (1 + value / 100), 1) - 1) * 100, 2);
}

function annualise(cumulativeReturn, years) {
  if (cumulativeReturn === null || years <= 0) return null;
  return round(((1 + cumulativeReturn / 100) ** (1 / years) - 1) * 100, 2);
}

function annualisedVolatility(values) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(12), 2);
}

function monthLabel(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
}

function priorMonthEnd(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0)).toISOString().slice(0, 10);
}

function validateMonthlySeries(portfolioId, records) {
  for (let index = 1; index < records.length; index += 1) {
    const previous = new Date(`${records[index - 1].date}T00:00:00Z`);
    const expected = new Date(Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth() + 2, 0))
      .toISOString().slice(0, 10);
    if (records[index].date !== expected) {
      throw new Error(`${portfolioId}: monthly series has a gap before ${records[index].date}.`);
    }
  }
}

function buildPerformance(portfolioId, monthlyRecords) {
  const series = monthlyRecords.map((record) => ({
    date: excelDateToIso(record.month_end),
    portfolio: asPercent(record.portfolio_monthly_return_pct),
    benchmark: asPercent(record.benchmark_monthly_return_pct),
  })).sort((a, b) => a.date.localeCompare(b.date));

  if (!series.length || series.some((row) => row.portfolio === null || row.benchmark === null)) {
    throw new Error(`${portfolioId}: monthly portfolio or benchmark returns are missing.`);
  }
  if (new Set(series.map((row) => row.date)).size !== series.length) {
    throw new Error(`${portfolioId}: monthly series contains duplicate dates.`);
  }
  validateMonthlySeries(portfolioId, series);

  const history = [{
    date: priorMonthEnd(series[0].date),
    label: monthLabel(priorMonthEnd(series[0].date)),
    portfolio: 100,
    benchmark: 100,
  }];
  let portfolioIndex = 100;
  let benchmarkIndex = 100;
  for (const row of series) {
    portfolioIndex *= 1 + row.portfolio / 100;
    benchmarkIndex *= 1 + row.benchmark / 100;
    history.push({
      date: row.date,
      label: monthLabel(row.date),
      portfolio: round(portfolioIndex, 4),
      benchmark: round(benchmarkIndex, 4),
    });
  }

  const periods = [
    ["1 Year", 12, 1],
    ["3 Year", 36, 3],
    ["5 Year", 60, 5],
  ];
  const cumulativePortfolio = {};
  const cumulativeBenchmark = {};
  const annualisedPortfolio = {};
  const annualisedBenchmark = {};
  for (const [label, months, years] of periods) {
    const portfolioReturn = series.length >= months
      ? compoundReturns(series.slice(-months).map((row) => row.portfolio))
      : null;
    const benchmarkReturn = series.length >= months
      ? compoundReturns(series.slice(-months).map((row) => row.benchmark))
      : null;
    cumulativePortfolio[label] = portfolioReturn;
    cumulativeBenchmark[label] = benchmarkReturn;
    annualisedPortfolio[label] = years === 1 ? portfolioReturn : annualise(portfolioReturn, years);
    annualisedBenchmark[label] = years === 1 ? benchmarkReturn : annualise(benchmarkReturn, years);
  }
  annualisedPortfolio.Volatility = annualisedVolatility(series.map((row) => row.portfolio));
  annualisedBenchmark.Volatility = annualisedVolatility(series.map((row) => row.benchmark));

  const currentYear = series.at(-1).date.slice(0, 4);
  const byYear = new Map();
  for (const row of series) {
    const year = row.date.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(row);
  }
  const calendarColumns = [...byYear.entries()]
    .filter(([year, rows]) => rows.length === 12 || year === currentYear)
    .slice(-5)
    .map(([year]) => year === currentYear ? `${year} YTD` : year);
  const calendarPortfolio = {};
  const calendarBenchmark = {};
  for (const label of calendarColumns) {
    const year = label.slice(0, 4);
    const rows = byYear.get(year);
    calendarPortfolio[label] = compoundReturns(rows.map((row) => row.portfolio));
    calendarBenchmark[label] = compoundReturns(rows.map((row) => row.benchmark));
  }

  return {
    cumulative: {
      columns: periods.map(([label]) => label),
      portfolio: cumulativePortfolio,
      benchmark: cumulativeBenchmark,
    },
    annualised: {
      columns: [...periods.map(([label]) => label), "Volatility"],
      portfolio: annualisedPortfolio,
      benchmark: annualisedBenchmark,
    },
    calendar: {
      columns: calendarColumns,
      portfolio: calendarPortfolio,
      benchmark: calendarBenchmark,
    },
    history,
  };
}

const normaliseAssetClass = (name) => ({
  "Fixed Interest/Bonds": "Bonds",
  Bond: "Bonds",
  Equity: "Equities",
}[name] ?? name);

const normaliseRegion = (name) => ({
  "Dev. Asia": "Developed Asia",
  EM: "Emerging Markets",
}[name] ?? name);

const cleanText = (value) => String(value ?? "").trim().replace(/\s+/g, " ");

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);
for (const sheetName of requiredSheets) workbook.worksheets.getItem(sheetName);

const factsheets = recordsFromSheet(workbook.worksheets.getItem("Factsheets"));
const informationByPortfolio = groupBy(recordsFromSheet(workbook.worksheets.getItem("Portfolio_Info")), "portfolio_id");
const monthlyByPortfolio = groupBy(recordsFromSheet(workbook.worksheets.getItem("Monthly_Series")), "portfolio_id");
const allocationByPortfolio = groupBy(recordsFromSheet(workbook.worksheets.getItem("Asset_Allocation")), "portfolio_id");
const regionsByPortfolio = groupBy(recordsFromSheet(workbook.worksheets.getItem("Regional_Exposure")), "portfolio_id");
const holdingsByPortfolio = groupBy(recordsFromSheet(workbook.worksheets.getItem("Holdings")), "portfolio_id");

if (!factsheets.length) throw new Error("The Factsheets sheet does not contain any portfolio rows.");

const warnings = [];
const portfolios = {};
for (const factsheet of factsheets) {
  const portfolioId = String(factsheet.portfolio_id);
  const portfolioName = cleanText(factsheet.portfolio_name);
  const currency = cleanText(factsheet.currency);
  const [type = "Active", ...riskParts] = portfolioName.split(/\s+/);
  const risk = riskParts.join(" ") || portfolioName;
  const targetEquity = Number(risk.match(/\d+/)?.[0] ?? 0);
  const information = (informationByPortfolio.get(portfolioId) ?? [])
    .sort((a, b) => Number(a.field_order) - Number(b.field_order))
    .map((row) => ({ label: cleanText(row.field_label), value: cleanText(row.field_value) }))
    .filter((row) => row.label);
  const allocationRows = (allocationByPortfolio.get(portfolioId) ?? [])
    .sort((a, b) => Number(a.display_order) - Number(b.display_order))
    .map((row) => {
      const allocation = asPercent(row.weight_pct);
      const benchmark = asPercent(row.benchmark_weight_pct);
      return {
        name: normaliseAssetClass(cleanText(row.asset_class)),
        allocation,
        benchmark,
        diff: allocation === null || benchmark === null ? null : round(allocation - benchmark, 2),
      };
    });
  const regionalExposure = (regionsByPortfolio.get(portfolioId) ?? [])
    .sort((a, b) => Number(a.display_order) - Number(b.display_order))
    .map((row) => ({
      name: normaliseRegion(cleanText(row.region)),
      allocation: asPercent(row.weight_pct),
    }));
  const holdingsRecords = holdingsByPortfolio.get(portfolioId) ?? [];
  const holdings = holdingsRecords.map((row, index) => ({
    rank: index + 1,
    name: cleanText(row.holding_name),
    weight: asPercent(row.weight_pct),
    assetClass: normaliseAssetClass(cleanText(row.Asset_Class || "Other")),
  }));
  const totalHoldings = asNumber(holdingsRecords[0]?.holding_count_total) ?? holdings.length;

  const allocationTotal = allocationRows.reduce((sum, row) => sum + (row.allocation ?? 0), 0);
  const regionTotal = regionalExposure.reduce((sum, row) => sum + (row.allocation ?? 0), 0);
  if (Math.abs(allocationTotal - 100) > 0.05) warnings.push(`${portfolioId}: allocation totals ${round(allocationTotal, 2)}%.`);
  if (Math.abs(regionTotal - 100) > 0.1) warnings.push(`${portfolioId}: regional exposure totals ${round(regionTotal, 2)}%.`);
  if (!information.length) warnings.push(`${portfolioId}: no portfolio information rows were supplied.`);
  if (!String(factsheet.objective ?? "").trim()) warnings.push(`${portfolioId}: objective text is blank.`);

  const ocfValue = information.find((row) => /underlying fund (ocf|ter)/i.test(row.label))?.value;
  portfolios[`${type}|${currency}|${risk}`] = {
    id: portfolioId,
    type,
    currency,
    risk,
    name: portfolioName.endsWith(currency) ? portfolioName : `${portfolioName} ${currency}`,
    displayTitle: String(factsheet.display_title ?? ""),
    websiteSlug: cleanText(factsheet.website_slug),
    pdfFileName: cleanText(factsheet.pdf_file_name),
    objective: cleanText(factsheet.objective),
    benchmarkName: cleanText(factsheet.benchmark_name),
    targetEquity,
    information,
    ocf: asPercent(ocfValue),
    allocation: { summary: allocationRows, expanded: allocationRows },
    regionalExposure,
    totalHoldings,
    holdings,
    performance: buildPerformance(portfolioId, monthlyByPortfolio.get(portfolioId) ?? []),
  };
}

const reportDates = factsheets.map((row) => excelDateToIso(row.report_date)).sort();
const output = {
  meta: {
    sourceFile: path.basename(sourcePath),
    workbookDate: reportDates.at(-1),
    dataAsOf: reportDates.at(-1),
    generatedAt: new Date().toISOString(),
    warnings,
  },
  options: {
    types: [...new Set(Object.values(portfolios).map((portfolio) => portfolio.type))],
    currencies: [...new Set(Object.values(portfolios).map((portfolio) => portfolio.currency))],
    risks: [...new Set(Object.values(portfolios).map((portfolio) => portfolio.risk))],
  },
  portfolios,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(outputPath, `window.TAM_FACTSHEET_DATA = ${JSON.stringify(output, null, 2)};\n`);

console.log(`Mapped ${Object.keys(portfolios).length} portfolio(s).`);
console.log(`Data as of ${output.meta.dataAsOf}.`);
console.log(`Wrote ${outputPath}.`);
for (const warning of warnings) console.warn(`Warning: ${warning}`);
