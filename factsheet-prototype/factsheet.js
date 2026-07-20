(() => {
  const dataset = window.TAM_FACTSHEET_DATA;
  if (!dataset?.portfolios) {
    document.body.innerHTML = "<p style='padding:2rem;font-family:sans-serif'>Factsheet data could not be loaded.</p>";
    return;
  }

  const selection = {
    type: dataset.options.types.includes("Active") ? "Active" : dataset.options.types[0],
    currency: dataset.options.currencies.includes("GBP") ? "GBP" : dataset.options.currencies[0],
    risk: dataset.options.risks.includes("Balanced 60") ? "Balanced 60" : dataset.options.risks[0],
  };
  const regionColours = ["#386a9f", "#6e95c6", "#98b1d7", "#b9c7df"];
  let selectedChartYears = 5;
  let allocationView = "summary";
  let holdingsCount = 5;

  const escapeHtml = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  const portfolioKey = () => `${selection.type}|${selection.currency}|${selection.risk}`;
  const currentPortfolio = () => dataset.portfolios[portfolioKey()];
  const formatPercent = (value, { signed = false, decimals = 2 } = {}) => {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
    const number = Number(value);
    const prefix = signed && number > 0 ? "+" : "";
    return `${prefix}${number.toFixed(decimals)}`;
  };
  const formatDate = (isoDate) => new Date(`${isoDate}T00:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  function syncSelectors() {
    const optionKeys = { type: "types", currency: "currencies", risk: "risks" };
    document.querySelectorAll(".selector-options[data-filter-group]").forEach((group) => {
      const field = group.dataset.filterGroup;
      const available = new Set(dataset.options[optionKeys[field]]);
      group.querySelectorAll(".choice").forEach((button) => {
        const unavailable = !available.has(button.dataset.value);
        button.disabled = unavailable;
        button.title = unavailable ? "No data available" : "";
        const active = button.dataset.value === selection[field];
        button.classList.toggle("is-active", active);
        button.setAttribute("aria-pressed", String(active));
      });
    });
  }

  function syncChartRangeButtons(portfolio) {
    const history = portfolio.performance.history;
    const firstDate = new Date(`${history[0].date}T00:00:00Z`);
    const lastDate = new Date(`${history.at(-1).date}T00:00:00Z`);
    const availableYears = (lastDate - firstDate) / 31557600000;
    const buttons = [...document.querySelectorAll(".range-button")];

    buttons.forEach((button) => {
      const unavailable = Number(button.dataset.years) > availableYears + 0.05;
      button.disabled = unavailable;
      button.title = unavailable ? "Not enough performance history available" : "";
    });

    const selectedButton = buttons.find((button) => Number(button.dataset.years) === selectedChartYears);
    if (selectedButton?.disabled) {
      const availableRanges = buttons
        .filter((button) => !button.disabled)
        .map((button) => Number(button.dataset.years));
      selectedChartYears = Math.max(...availableRanges);
    }
    buttons.forEach((button) => {
      const active = Number(button.dataset.years) === selectedChartYears;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function syncHoldingsButtons(portfolio) {
    document.querySelectorAll(".holdings-button").forEach((button) => {
      const requestedCount = Number(button.dataset.holdingsCount);
      const availableCount = Math.min(requestedCount, portfolio.holdings.length);
      const active = requestedCount === holdingsCount;
      button.textContent = `Top ${availableCount}`;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
  }

  function renderHeading(portfolio) {
    document.getElementById("selectedPortfolio").textContent = portfolio.name;
    document.getElementById("portfolioLegend").textContent = portfolio.name;
    document.getElementById("dataAsOf").textContent = formatDate(dataset.meta.dataAsOf);
    document.title = `TAM MPS Information Hub - ${portfolio.name}`;
  }

  function renderObjective(portfolio) {
    const nonEquity = 100 - portfolio.targetEquity;
    const allocationSentence = nonEquity > 0
      ? `The portfolio will typically comprise ${portfolio.targetEquity}% equity and ${nonEquity}% non-equity, although weightings may deviate within the permitted investment parameters.`
      : "The portfolio is designed as an equity-focused strategy, although cash and diversifying assets may be held within the permitted investment parameters.";
    document.getElementById("objectiveText").innerHTML = `
      <p>This portfolio comprises diversified investment vehicles, including unit trusts, mutual funds and exchange-traded funds (ETFs), whose managers aim to outperform their respective markets.</p>
      <p>${escapeHtml(portfolio.name)} seeks to generate capital growth over the medium term, with the aim of riding out short-term fluctuations in value.</p>
      <p>${escapeHtml(allocationSentence)}</p>
    `;
  }

  function renderPortfolioInformation(portfolio) {
    const rows = [
      ["Portfolio Benchmark", portfolio.benchmarkName],
      ["Inception Date", "Not provided in source workbook"],
      ["Accessibility", "Direct, Pension, Life Bond, Trust"],
      ["Suggested Investment Horizon", "5 years+"],
      ["Minimum Investment", `${portfolio.currency} 7,500`],
      ["Underlying Fund OCF", `${formatPercent(portfolio.ocf, { decimals: 2 })}%`],
    ];
    document.getElementById("portfolioInfoRows").innerHTML = rows
      .map(([label, value]) => `<tr><th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
      .join("");
  }

  function cumulativeHistoryReturn(history, months, field) {
    if (!Array.isArray(history) || history.length <= months) return null;
    const latest = history.at(-1)?.[field];
    const starting = history.at(-(months + 1))?.[field];
    if (!Number.isFinite(latest) || !Number.isFinite(starting) || starting === 0) return null;
    return Number((((latest / starting) - 1) * 100).toFixed(2));
  }

  function renderPerformanceTable(section, headId, rowsId, mobileRowsId, reverseMobile = false) {
    const visibleColumns = section.columns.filter((column) => column !== "10 Year" && column !== "Inception");
    document.getElementById(headId).innerHTML = `<tr><th></th>${visibleColumns
      .map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr>`;
    const difference = Object.fromEntries(visibleColumns.map((column) => {
      const portfolioValue = section.portfolio[column];
      const benchmarkValue = section.benchmark[column];
      return [column, portfolioValue === null || benchmarkValue === null
        ? null
        : Number((portfolioValue - benchmarkValue).toFixed(2))];
    }));
    const performanceValue = (value, signed = false) =>
      value === null || value === undefined ? "—" : `${formatPercent(value, { signed })}%`;
    const performanceClass = (value) => {
      if (value === null || value === undefined || Number(value) === 0) return "";
      return Number(value) > 0 ? "performance-positive" : "performance-negative";
    };
    const row = (label, values, className, signed = false) => `
      <tr class="${className}">
        <th>${label}</th>
        ${visibleColumns.map((column) => `<td class="${performanceClass(values[column])}">${performanceValue(values[column], signed)}</td>`).join("")}
      </tr>`;
    document.getElementById(rowsId).innerHTML = [
      row("Portfolio", section.portfolio, "portfolio-row"),
      row("Benchmark", section.benchmark, "benchmark-row"),
      row("Difference", difference, "difference-row", true),
    ].join("");

    const mobileColumns = reverseMobile ? [...visibleColumns].reverse() : visibleColumns;
    document.getElementById(mobileRowsId).innerHTML = mobileColumns.map((column) => `
      <tr>
        <td>${escapeHtml(column)}</td>
        <td class="${performanceClass(section.portfolio[column])}">${performanceValue(section.portfolio[column])}</td>
        <td class="${performanceClass(section.benchmark[column])}">${performanceValue(section.benchmark[column])}</td>
        <td class="${performanceClass(difference[column])}">${performanceValue(difference[column], true)}</td>
      </tr>`).join("");
  }

  function renderPerformance(portfolio) {
    const cumulative = portfolio.performance.cumulative;
    const cumulativeWithSixMonths = cumulative.columns.includes("6 Month") ? cumulative : {
      columns: ["6 Month", ...cumulative.columns],
      portfolio: {
        "6 Month": cumulativeHistoryReturn(portfolio.performance.history, 6, "portfolio"),
        ...cumulative.portfolio,
      },
      benchmark: {
        "6 Month": cumulativeHistoryReturn(portfolio.performance.history, 6, "benchmark"),
        ...cumulative.benchmark,
      },
    };
    renderPerformanceTable(cumulativeWithSixMonths, "cumulativeHead", "cumulativeRows", "cumulativeMobileRows");
    renderPerformanceTable(portfolio.performance.annualised, "annualisedHead", "annualisedRows", "annualisedMobileRows");
    renderPerformanceTable(portfolio.performance.calendar, "calendarHead", "calendarRows", "calendarMobileRows", true);
  }

  function renderAllocation(portfolio, view = allocationView) {
    const rows = portfolio.allocation[view];
    document.getElementById("allocationRows").innerHTML = rows.map((row) => {
      const hasDifference = row.diff !== null && row.diff !== undefined;
      const direction = hasDifference && row.diff >= 0 ? "positive" : "negative";
      const varianceWidth = hasDifference ? Math.min(Math.abs(row.diff) * 2, 50) : 0;
      return `
        <div class="allocation-row">
          <span class="allocation-name${row.sub ? " sub-allocation" : ""}">${escapeHtml(row.name)}</span>
          <div class="allocation-bar-cell"><span class="allocation-value">${formatPercent(row.allocation, { decimals: 1 })}%</span><div class="allocation-track"><div class="allocation-fill" style="--allocation:${Math.max(0, row.allocation)}%;"></div></div></div>
          <div class="variance-cell"><span class="allocation-diff ${hasDifference ? direction : ""}">${hasDifference ? `${formatPercent(row.diff, { signed: true, decimals: 1 })}%` : "—"}</span><div class="variance-track"><div class="variance-fill ${hasDifference ? direction : ""}" style="--variance:${varianceWidth}%;"></div></div></div>
        </div>`;
    }).join("");

    const mainAssetClasses = ["Equities", "Bonds", "Alternatives", "Cash"];
    const mobileRows = portfolio.allocation.summary.filter((row) => mainAssetClasses.includes(row.name));
    const circumference = 2 * Math.PI * 62;
    let offset = 0;
    const circles = mobileRows.map((row, index) => {
      const length = circumference * (row.allocation / 100);
      const circle = `<circle cx="90" cy="90" r="62" fill="none" stroke="${regionColours[index]}" stroke-width="34" stroke-dasharray="${length.toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="-${offset.toFixed(2)}" transform="rotate(-90 90 90)"></circle>`;
      offset += length;
      return circle;
    }).join("");
    document.getElementById("mobileAllocationChart").innerHTML = `${circles}<circle cx="90" cy="90" r="37" fill="#ffffff"></circle>`;
    document.getElementById("mobileAllocationRows").innerHTML = mobileRows.map((row, index) => `
      <tr>
        <td><span class="region-name"><i class="dot" style="background:${regionColours[index]};"></i>${escapeHtml(row.name)}</span></td>
        <td>${formatPercent(row.allocation, { decimals: 1 })}%</td>
      </tr>`).join("");
  }

  function renderRegions(portfolio) {
    const circumference = 2 * Math.PI * 62;
    let offset = 0;
    const circles = portfolio.regionalExposure.map((region, index) => {
      const length = circumference * (region.allocation / 100);
      const circle = `<circle cx="90" cy="90" r="62" fill="none" stroke="${regionColours[index]}" stroke-width="34" stroke-dasharray="${length.toFixed(2)} ${circumference.toFixed(2)}" stroke-dashoffset="-${offset.toFixed(2)}" transform="rotate(-90 90 90)"></circle>`;
      offset += length;
      return circle;
    }).join("");
    document.getElementById("regionalChart").innerHTML = `${circles}<circle cx="90" cy="90" r="37" fill="#ffffff"></circle>`;
    document.getElementById("regionalRows").innerHTML = portfolio.regionalExposure.map((region, index) => `
      <tr>
        <td><span class="region-name"><i class="dot" style="background:${regionColours[index]};"></i>${escapeHtml(region.name)}</span></td>
        <td>${formatPercent(region.allocation, { decimals: 1 })}%</td>
      </tr>`).join("");
  }

  function renderHoldings(portfolio, requestedCount = holdingsCount) {
    const count = Math.min(requestedCount, portfolio.holdings.length);
    const rows = portfolio.holdings.slice(0, count);
    const totalWeight = rows.reduce((sum, holding) => sum + holding.weight, 0);
    document.getElementById("holdingsTitle").textContent = `Top ${count} Holdings`;
    document.getElementById("holdingsRows").innerHTML = `
      ${rows.map((holding) => `
        <tr>
          <td>${escapeHtml(holding.name)}</td>
          <td>${escapeHtml(holding.assetClass)}</td>
          <td>${formatPercent(holding.weight)}%</td>
        </tr>`).join("")}
      <tr class="total"><td>Top ${count} holdings as % of whole portfolio</td><td></td><td>${totalWeight.toFixed(2)}%</td></tr>
      <tr class="total"><td>Total number of holdings</td><td></td><td>${portfolio.totalHoldings}</td></tr>`;
  }

  function chartDataForYears(history, years) {
    const lastDate = new Date(`${history.at(-1).date}T00:00:00Z`);
    const cutoff = new Date(lastDate);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
    let data = history.filter((point) => new Date(`${point.date}T00:00:00Z`) >= cutoff);
    if (data.length < 2) data = history;
    const portfolioBase = data[0].portfolio;
    const benchmarkBase = data[0].benchmark;
    return data.map((point) => ({
      ...point,
      portfolio: (point.portfolio / portfolioBase) * 100,
      benchmark: (point.benchmark / benchmarkBase) * 100,
    }));
  }

  function drawPerformanceChart(portfolio, years = selectedChartYears) {
    const svg = document.getElementById("performanceChart");
    const width = 760;
    const height = 300;
    const margin = { top: 20, right: 28, bottom: 38, left: 48 };
    const plotWidth = width - margin.left - margin.right;
    const plotHeight = height - margin.top - margin.bottom;
    const chartData = chartDataForYears(portfolio.performance.history, years);
    const values = chartData.flatMap((point) => [point.portfolio, point.benchmark]);
    let min = Math.floor(Math.min(...values) - 1);
    let max = Math.ceil(Math.max(...values) + 1);
    if (max === min) max += 1;
    const x = (index) => margin.left + (index / Math.max(chartData.length - 1, 1)) * plotWidth;
    const y = (value) => margin.top + ((max - value) / (max - min)) * plotHeight;
    const line = (field) => chartData.map((point, index) => `${index === 0 ? "M" : "L"} ${x(index).toFixed(2)} ${y(point[field]).toFixed(2)}`).join(" ");
    const gridStep = Math.max(1, Math.ceil((max - min) / 4));
    const gridValues = Array.from({ length: 6 }, (_, index) => min + index * gridStep).filter((value) => value <= max);
    const tickEvery = Math.max(1, Math.round(chartData.length / Math.min(5, chartData.length)));
    const availableYears = (new Date(`${chartData.at(-1).date}T00:00:00Z`) - new Date(`${chartData[0].date}T00:00:00Z`)) / 31557600000;
    const viewLabel = availableYears + 0.05 < years
      ? `${availableYears.toFixed(1)} years available, rebased to 100`
      : `${years} year view, rebased to 100`;

    svg.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"></rect>
      ${gridValues.map((value) => `<line class="grid-line" x1="${margin.left}" x2="${width - margin.right}" y1="${y(value)}" y2="${y(value)}"></line><text class="axis-label" x="10" y="${y(value) + 4}">${value}</text>`).join("")}
      ${chartData.map((point, index) => index % tickEvery === 0 || index === chartData.length - 1 ? `<text class="axis-label" x="${x(index) - 18}" y="${height - 12}">${escapeHtml(point.label)}</text>` : "").join("")}
      <path d="${line("benchmark")}" fill="none" stroke="#c77700" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${line("portfolio")}" fill="none" stroke="#005daa" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      <text class="axis-label" x="${width - 226}" y="18">${viewLabel}</text>`;
  }

  function renderPortfolio() {
    const portfolio = currentPortfolio();
    if (!portfolio) return;
    syncSelectors();
    renderHeading(portfolio);
    renderObjective(portfolio);
    renderPortfolioInformation(portfolio);
    renderPerformance(portfolio);
    syncChartRangeButtons(portfolio);
    renderAllocation(portfolio);
    renderRegions(portfolio);
    syncHoldingsButtons(portfolio);
    renderHoldings(portfolio);
    drawPerformanceChart(portfolio);
  }

  document.querySelectorAll(".selector-options[data-filter-group]").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest(".choice");
      if (!button || button.disabled) return;
      selection[group.dataset.filterGroup] = button.dataset.value;
      renderPortfolio();
    });
  });

  document.querySelectorAll(".allocation-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".allocation-button").forEach((option) => {
        option.classList.remove("is-active");
        option.setAttribute("aria-pressed", "false");
      });
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
      allocationView = button.dataset.allocationView;
      renderAllocation(currentPortfolio());
    });
  });

  document.querySelectorAll(".holdings-button").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".holdings-button").forEach((option) => {
        option.classList.remove("is-active");
        option.setAttribute("aria-pressed", "false");
      });
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
      holdingsCount = Number(button.dataset.holdingsCount);
      renderHoldings(currentPortfolio());
    });
  });

  document.querySelectorAll(".range-button").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.disabled) return;
      document.querySelectorAll(".range-button").forEach((option) => {
        option.classList.remove("is-active");
        option.setAttribute("aria-pressed", "false");
      });
      button.classList.add("is-active");
      button.setAttribute("aria-pressed", "true");
      selectedChartYears = Number(button.dataset.years);
      drawPerformanceChart(currentPortfolio());
    });
  });

  document.getElementById("downloadFactsheet").addEventListener("click", (event) => event.preventDefault());
  renderPortfolio();
})();
