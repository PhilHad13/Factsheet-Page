import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const sourcePath = path.resolve(
  process.argv[2] ?? "/Users/philliphadley/Downloads/TAM Factsheet Data 30.06.2026.xlsm",
);
const outputPath = path.resolve(
  process.argv[3] ?? "factsheet-prototype/data/factsheets.js",
);

function workbookDateFromPath(filePath) {
  const match = path.basename(filePath).match(/(\d{2})[.-](\d{2})[.-](\d{4})/);
  if (!match) {
    throw new Error(
      "The source filename must contain its workbook date in DD.MM.YYYY format.",
    );
  }
  const [, day, month, year] = match;
  const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() + 1 !== Number(month)
    || date.getUTCDate() !== Number(day)
  ) {
    throw new Error(`Invalid workbook date in source filename: ${match[0]}.`);
  }
  return `${year}-${month}-${day}`;
}

const workbookDate = workbookDateFromPath(sourcePath);

const riskProfiles = [
  "Defensive 20",
  "Cautious 40",
  "Balanced 60",
  "Growth 80",
  "High Growth 100",
];
const currencies = ["GBP", "EUR"];
const riskTargets = Object.fromEntries(riskProfiles.map((risk) => [risk, Number(risk.match(/\d+/)[0])]));

const numberOrNull = (value) => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && !value.startsWith("#")) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const round = (value, places = 4) => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};

const percent = (value) => {
  const parsed = numberOrNull(value);
  return parsed === null ? null : round(parsed * 100, 4);
};

const serialiseDate = (day, month, year) =>
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

function parseGraphPeriod(header) {
  const dates = String(header ?? "").match(/(\d{2})\/(\d{2})\/(\d{4})/g) ?? [];
  if (dates.length < 2) return null;
  const convert = (date) => {
    const [day, month, year] = date.split("/").map(Number);
    return serialiseDate(day, month, year);
  };
  return { from: convert(dates[0]), to: convert(dates[1]) };
}

function addMonthsLabel(isoDate) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}

function compoundReturns(returns) {
  if (!returns.length || returns.some((value) => value === null)) return null;
  return round((returns.reduce((index, value) => index * (1 + value / 100), 1) - 1) * 100, 2);
}

function annualise(cumulativeReturn, years) {
  if (cumulativeReturn === null || years <= 0) return null;
  return round(((1 + cumulativeReturn / 100) ** (1 / years) - 1) * 100, 2);
}

function annualisedVolatility(returns) {
  const values = returns.filter((value) => value !== null);
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  return round(Math.sqrt(variance) * Math.sqrt(12), 2);
}

function calendarReturns(periods, returns) {
  const byYear = new Map();
  periods.forEach((period, index) => {
    const year = period.to.slice(0, 4);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push(returns[index]);
  });
  return Object.fromEntries(
    [...byYear.entries()].map(([year, values]) => [year, compoundReturns(values)]),
  );
}

function buildHistory(periods, modelReturns, benchmarkReturns) {
  let modelIndex = 100;
  let benchmarkIndex = 100;
  const history = [{
    date: periods[0].from,
    label: addMonthsLabel(periods[0].from),
    portfolio: 100,
    benchmark: 100,
  }];

  periods.forEach((period, index) => {
    modelIndex *= 1 + modelReturns[index] / 100;
    benchmarkIndex *= 1 + benchmarkReturns[index] / 100;
    history.push({
      date: period.to,
      label: addMonthsLabel(period.to),
      portfolio: round(modelIndex, 4),
      benchmark: round(benchmarkIndex, 4),
    });
  });
  return history;
}

function makeKey(type, currency, risk) {
  return `${type}|${currency}|${risk}`;
}

function performanceMap(values) {
  return new Map(
    values.slice(1)
      .filter((row) => typeof row[0] === "string" && row[0].startsWith("Active "))
      .map((row) => [row[0], {
        cumulative: {
          "1 Year": numberOrNull(row[1]),
          "3 Year": numberOrNull(row[2]),
          "5 Year": numberOrNull(row[3]),
          "10 Year": numberOrNull(row[4]),
          Inception: numberOrNull(row[5]),
        },
        calendar: {
          "2024": numberOrNull(row[6]),
          "2025": numberOrNull(row[7]),
          YTD: numberOrNull(row[8]),
        },
        return: numberOrNull(row[9]),
        volatility: numberOrNull(row[10]),
      }]),
  );
}

function graphMap(values) {
  const periods = values[0].slice(2).map(parseGraphPeriod).filter(Boolean);
  const rows = new Map();
  values.slice(1).forEach((row) => {
    if (typeof row[0] !== "string" || !row[0].startsWith("Active ")) return;
    rows.set(row[0], row.slice(2, 2 + periods.length).map(numberOrNull));
  });
  return { periods, rows };
}

function assetClassPositions(rawValues) {
  const positions = new Map();
  let assetClass = "Other";
  let subAssetClass = "Other";
  const topLevels = new Set(["Equity", "Bond", "Alternatives", "Cash"]);

  rawValues.forEach((row, index) => {
    const label = row[0];
    if (topLevels.has(label)) {
      assetClass = label === "Equity" ? "Equities" : label === "Bond" ? "Bonds" : label;
      subAssetClass = assetClass;
    } else if (typeof label === "string" && label && row.slice(1, 6).every((value) => value === null || value === "")) {
      subAssetClass = label;
    }
    positions.set(index + 1, { assetClass, subAssetClass });
  });
  return positions;
}

function parseFactsheet(values, rawValues, currency) {
  const riskColumns = new Map(values[0].slice(2, 7).map((risk, index) => [risk, index + 2]));
  const positionClasses = assetClassPositions(rawValues);
  const holdingsByRisk = new Map(riskProfiles.map((risk) => [risk, []]));
  let activeRisk = null;

  for (let rowIndex = 27; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex];
    if (riskProfiles.includes(row[1])) {
      activeRisk = row[1];
      continue;
    }
    const rank = numberOrNull(row[1]);
    const weight = percent(row[2]);
    const position = numberOrNull(row[3]);
    const name = typeof row[4] === "string" && !row[4].startsWith("#") ? row[4] : null;
    if (!activeRisk || rank === null || weight === null || position === null || !name) continue;
    const classification = positionClasses.get(position) ?? { assetClass: "Other", subAssetClass: "Other" };
    holdingsByRisk.get(activeRisk).push({
      rank,
      name,
      weight,
      position,
      ...classification,
    });
  }

  return Object.fromEntries(riskProfiles.map((risk) => {
    const column = riskColumns.get(risk);
    const targetEquity = riskTargets[risk];
    const summary = [
      { name: "Equities", allocation: percent(values[3][column]), benchmark: targetEquity },
      { name: "Bonds", allocation: percent(values[4][column]), benchmark: 100 - targetEquity },
      { name: "Alternatives", allocation: percent(values[5][column]), benchmark: 0 },
      { name: "Cash", allocation: percent(values[6][column]), benchmark: 0 },
    ].map((row) => ({ ...row, diff: round(row.allocation - row.benchmark, 2) }));

    const rawColumn = column - 1;
    const expanded = [
      summary[0],
      summary[1],
      { name: "Money Market", allocation: percent(rawValues[35][rawColumn]), benchmark: null, sub: true },
      { name: "Government", allocation: percent(rawValues[40][rawColumn]), benchmark: null, sub: true },
      { name: "Corporate", allocation: percent(rawValues[45][rawColumn]), benchmark: null, sub: true },
      { name: "Aggregate", allocation: percent(rawValues[50][rawColumn]), benchmark: null, sub: true },
      summary[2],
      { name: "Property & Infrastructure", allocation: percent(rawValues[56][rawColumn]), benchmark: null, sub: true },
      { name: "Commodities & Other", allocation: percent(rawValues[61][rawColumn]), benchmark: null, sub: true },
      summary[3],
    ].map((row) => ({
      ...row,
      diff: row.benchmark === null ? null : round(row.allocation - row.benchmark, 2),
    }));

    return [risk, {
      allocation: { summary, expanded },
      regionalExposure: [
        { name: "North America", allocation: percent(values[10][column]) },
        { name: "Europe", allocation: percent(values[11][column]) },
        { name: "Developed Asia", allocation: percent(values[12][column]) },
        { name: "Emerging Markets", allocation: percent(values[13][column]) },
      ],
      bondSplit: {
        government: percent(values[15][column]),
        corporate: percent(values[16][column]),
      },
      duration: round(numberOrNull(values[18][column]), 2),
      yield: percent(values[20][column]),
      totalHoldings: numberOrNull(values[22][column]),
      ocf: percent(values[24][column]),
      holdings: holdingsByRisk.get(risk).sort((a, b) => a.rank - b.rank),
      currency,
    }];
  }));
}

const input = await FileBlob.load(sourcePath);
const workbook = await SpreadsheetFile.importXlsx(input);
const getValues = (sheetName, range) => workbook.worksheets.getItem(sheetName).getRange(range).values;

const performanceModelValues = getValues("Performance Model", "A1:K171");
const performanceBenchmarkValues = getValues("Performance Benchmark", "A1:K171");
const performance = performanceMap(performanceModelValues);
const graphModel = graphMap(getValues("Graph Data Model", "A1:BJ15"));
const graphBenchmark = graphMap(getValues("Graph Data Benchmark", "A1:BJ11"));

if (JSON.stringify(graphModel.periods) !== JSON.stringify(graphBenchmark.periods)) {
  throw new Error("Model and benchmark graph periods do not align.");
}

const factsheets = Object.fromEntries(currencies.map((currency) => [currency, parseFactsheet(
  getValues(`Active ${currency} (Factsheet)`, "A1:H87"),
  getValues(`Active ${currency}`, "A1:J236"),
  currency,
)]));

const portfolios = {};
const validationWarnings = [];
for (const currency of currencies) {
  for (const risk of riskProfiles) {
    const name = `Active ${risk} ${currency}`;
    const benchmarkGraphName = `Active ${risk} Benchmark ${currency}`;
    const modelReturns = graphModel.rows.get(name);
    const benchmarkReturns = graphBenchmark.rows.get(benchmarkGraphName);
    const modelPerformance = performance.get(name);
    const factsheet = factsheets[currency][risk];

    if (!modelReturns || !benchmarkReturns || !modelPerformance) {
      throw new Error(`Missing performance series for ${name}.`);
    }
    if (modelReturns.some((value) => value === null) || benchmarkReturns.some((value) => value === null)) {
      throw new Error(`Incomplete monthly performance series for ${name}.`);
    }

    const benchmarkCumulative = {
      "1 Year": compoundReturns(benchmarkReturns.slice(-12)),
      "3 Year": compoundReturns(benchmarkReturns.slice(-36)),
      "5 Year": compoundReturns(benchmarkReturns.slice(-60)),
      "10 Year": null,
      Inception: null,
    };
    const modelCalendar = calendarReturns(graphModel.periods, modelReturns);
    const benchmarkCalendar = calendarReturns(graphModel.periods, benchmarkReturns);
    const benchmarkAnnualised = {
      "1 Year": benchmarkCumulative["1 Year"],
      "3 Year": annualise(benchmarkCumulative["3 Year"], 3),
      "5 Year": annualise(benchmarkCumulative["5 Year"], 5),
      "10 Year": null,
      Volatility: annualisedVolatility(benchmarkReturns),
    };
    const modelAnnualised = {
      "1 Year": modelPerformance.cumulative["1 Year"],
      "3 Year": annualise(modelPerformance.cumulative["3 Year"], 3),
      "5 Year": annualise(modelPerformance.cumulative["5 Year"], 5),
      "10 Year": annualise(modelPerformance.cumulative["10 Year"], 10),
      Volatility: modelPerformance.volatility,
    };

    const allocationTotal = factsheet.allocation.summary.reduce((sum, row) => sum + row.allocation, 0);
    const regionTotal = factsheet.regionalExposure.reduce((sum, row) => sum + row.allocation, 0);
    if (Math.abs(allocationTotal - 100) > 0.05) {
      validationWarnings.push(`${name}: allocation totals ${round(allocationTotal, 2)}%.`);
    }
    if (factsheet.allocation.summary[0].allocation > 0 && Math.abs(regionTotal - 100) > 0.1) {
      validationWarnings.push(`${name}: regional exposure totals ${round(regionTotal, 2)}%.`);
    }
    if (factsheet.holdings.length !== Math.min(10, factsheet.totalHoldings)) {
      validationWarnings.push(
        `${name}: expected ${Math.min(10, factsheet.totalHoldings)} ranked holdings but found ${factsheet.holdings.length}.`,
      );
    }

    portfolios[makeKey("Active", currency, risk)] = {
      id: `active-${risk.toLowerCase().replaceAll(" ", "-")}-${currency.toLowerCase()}`,
      type: "Active",
      currency,
      risk,
      name,
      benchmarkName: `${riskTargets[risk]}% Global Equity${riskTargets[risk] < 100 ? `, ${100 - riskTargets[risk]}% Global Bond` : ""}`,
      targetEquity: riskTargets[risk],
      ...factsheet,
      performance: {
        cumulative: {
          columns: ["1 Year", "3 Year", "5 Year", "10 Year", "Inception"],
          portfolio: modelPerformance.cumulative,
          benchmark: benchmarkCumulative,
        },
        annualised: {
          columns: ["1 Year", "3 Year", "5 Year", "10 Year", "Volatility"],
          portfolio: modelAnnualised,
          benchmark: benchmarkAnnualised,
        },
        calendar: {
          columns: ["2022", "2023", "2024", "2025", "2026 YTD"],
          portfolio: {
            "2022": modelCalendar["2022"],
            "2023": modelCalendar["2023"],
            "2024": modelPerformance.calendar["2024"] ?? modelCalendar["2024"],
            "2025": modelPerformance.calendar["2025"] ?? modelCalendar["2025"],
            "2026 YTD": modelPerformance.calendar.YTD ?? modelCalendar["2026"],
          },
          benchmark: {
            "2022": benchmarkCalendar["2022"],
            "2023": benchmarkCalendar["2023"],
            "2024": benchmarkCalendar["2024"],
            "2025": benchmarkCalendar["2025"],
            "2026 YTD": benchmarkCalendar["2026"],
          },
        },
        history: buildHistory(graphModel.periods, modelReturns, benchmarkReturns),
      },
    };
  }
}

const performanceSheetsMatch = JSON.stringify(performanceModelValues) === JSON.stringify(performanceBenchmarkValues);
if (performanceSheetsMatch) {
  validationWarnings.push(
    "Performance Benchmark duplicates Performance Model; benchmark 1/3/5-year figures are calculated from monthly benchmark data, while 10-year and inception benchmark figures remain unavailable.",
  );
}

const output = {
  meta: {
    sourceFile: path.basename(sourcePath),
    workbookDate,
    dataAsOf: graphModel.periods.at(-1).to,
    generatedAt: new Date().toISOString(),
    warnings: validationWarnings,
  },
  options: {
    types: ["Active"],
    currencies,
    risks: riskProfiles,
  },
  portfolios,
};

await fs.mkdir(path.dirname(outputPath), { recursive: true });
await fs.writeFile(
  outputPath,
  `window.TAM_FACTSHEET_DATA = ${JSON.stringify(output, null, 2)};\n`,
);

console.log(`Mapped ${Object.keys(portfolios).length} portfolios.`);
console.log(`Data as of ${output.meta.dataAsOf}.`);
console.log(`Wrote ${outputPath}.`);
for (const warning of validationWarnings) console.warn(`Warning: ${warning}`);
