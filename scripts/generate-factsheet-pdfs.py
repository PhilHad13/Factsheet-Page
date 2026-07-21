import json
import math
import os
import re
import statistics
import textwrap
from datetime import datetime

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4, landscape
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


ROOT = "/Users/philliphadley/Documents/GitHub/Factsheet Page"
DATA_PATH = os.path.join(ROOT, "factsheet-prototype/data/factsheets.js")
OUTPUT_DIR = os.path.join(ROOT, "output/pdf")
SITE_OUTPUT_DIR = os.path.join(ROOT, "factsheet-prototype/pdfs")
LOGO_PATH = os.path.join(ROOT, "factsheet-prototype/assets/tam-international-white.png")

BLUE = HexColor("#005DAA")
NAVY = HexColor("#133B5C")
DEEP_NAVY = HexColor("#0A2942")
AMBER = HexColor("#C77700")
PALE_BLUE = HexColor("#EAF2F8")
PALE_AMBER = HexColor("#FBF2E5")
LIGHT = HexColor("#F4F7F9")
LINE = HexColor("#D5DFE5")
TEXT = HexColor("#273640")
MUTED = HexColor("#61717C")
GREEN = HexColor("#237A57")
RED = HexColor("#B5473C")
REGION_COLORS = [HexColor(x) for x in ["#386A9F", "#6E95C6", "#98B1D7", "#B9C7DF"]]
ASSET_COLORS = [BLUE, AMBER, HexColor("#D9A15A"), HexColor("#EBCFA5")]

FULL_DISCLAIMER = (
    "The information contained on this factsheet is provided for general information purposes only and does not constitute financial, investment, legal or tax advice, nor should it be regarded as an offer, solicitation or recommendation to buy or sell any investment or financial product. "
    "Portfolio information, asset allocations, holdings, performance data and other statistics are believed to be accurate as at the date shown but may change without notice. Whilst reasonable care has been taken in preparing this information, TAM Asset Management International Ltd does not warrant its accuracy or completeness. "
    "The value of investments, and any income derived from them, may rise or fall due to market movements, and investors may receive back less than the amount originally invested. Past performance is not a reliable indicator of future results. "
    "Investment decisions should not be based solely on the information contained in these factsheets. Investors should consider the relevant offering documentation and, where appropriate, seek independent professional advice before making any investment decision."
)


def load_data():
    raw = open(DATA_PATH, "r", encoding="utf-8").read()
    payload = re.sub(r"^\s*window\.TAM_FACTSHEET_DATA\s*=\s*", "", raw).strip().rstrip(";")
    data = json.loads(payload)
    return data, data["portfolios"]["Active|GBP|Balanced 60"]


DATA, P = load_data()


def clean(value):
    return str(value).replace("\u2013", "-").replace("\u2014", "-").replace("\u2011", "-")


def pct(value, decimals=2, sign=False):
    if value is None:
        return "-"
    prefix = "+" if sign and value > 0 else ""
    return f"{prefix}{value:.{decimals}f}%"


def date_label(iso):
    if not iso:
        return "Not recovered"
    return datetime.strptime(iso, "%Y-%m-%d").strftime("%d %B %Y").lstrip("0")


def monthly_returns(field):
    history = P["performance"]["history"]
    return [((history[i][field] / history[i - 1][field]) - 1) * 100 for i in range(1, len(history))]


def risk_stats(field):
    values = monthly_returns(field)
    mean = statistics.mean(values)
    volatility = statistics.stdev(values) * math.sqrt(12)
    downside = math.sqrt(sum(min(value, 0) ** 2 for value in values) / len(values)) * math.sqrt(12)
    return {
        "volatility": volatility,
        "best": max(values),
        "worst": min(values),
        "positive": sum(value > 0 for value in values) / len(values) * 100,
        "downside": downside,
        "mean": mean,
    }


def drawdown_stats(field):
    history = P["performance"]["history"]
    peak_value = history[0][field]
    peak_index = 0
    max_drawdown = 0
    max_peak_index = 0
    trough_index = 0
    for index, point in enumerate(history):
        value = point[field]
        if value > peak_value:
            peak_value = value
            peak_index = index
        drawdown = (value / peak_value - 1) * 100
        if drawdown < max_drawdown:
            max_drawdown = drawdown
            max_peak_index = peak_index
            trough_index = index
    recovery_index = None
    max_peak_value = history[max_peak_index][field]
    for index in range(trough_index + 1, len(history)):
        if history[index][field] >= max_peak_value:
            recovery_index = index
            break
    latest_peak = max(point[field] for point in history)
    return {
        "maximum": max_drawdown,
        "peak": history[max_peak_index]["date"],
        "trough": history[trough_index]["date"],
        "months_to_trough": trough_index - max_peak_index,
        "recovery": history[recovery_index]["date"] if recovery_index is not None else None,
        "months_to_recovery": recovery_index - trough_index if recovery_index is not None else None,
        "current": (history[-1][field] / latest_peak - 1) * 100,
    }


PORT_RISK = risk_stats("portfolio")
BENCH_RISK = risk_stats("benchmark")
PORT_DD = drawdown_stats("portfolio")
BENCH_DD = drawdown_stats("benchmark")


def set_font(c, size, bold=False, color=TEXT):
    c.setFont("Helvetica-Bold" if bold else "Helvetica", size)
    c.setFillColor(color)


def wrapped_lines(text, width, font="Helvetica", size=8.5):
    words = clean(text).split()
    lines, current = [], ""
    for word in words:
        proposed = word if not current else f"{current} {word}"
        if stringWidth(proposed, font, size) <= width:
            current = proposed
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines


def paragraph(c, text, x, y, width, size=8.5, leading=12, color=TEXT, max_lines=None):
    lines = wrapped_lines(text, width, size=size)
    if max_lines:
        lines = lines[:max_lines]
    set_font(c, size, color=color)
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def brand(c, x, y, color=white, compact=False):
    width = 154 if compact else 174
    height = width * 776 / 5000
    c.drawImage(LOGO_PATH, x, y - height * 0.35, width=width, height=height, mask="auto")


def footer(c, width, page_no, concept):
    c.setStrokeColor(LINE)
    c.line(28, 27, width - 28, 27)
    set_font(c, 6.3, color=MUTED)
    c.drawString(28, 16, f"{concept} - design concept only - not for distribution")
    c.drawRightString(width - 28, 16, f"TAM MPS | {date_label(DATA['meta']['dataAsOf'])} | {page_no}")


def production_footer(c, width, page_no):
    c.setStrokeColor(LINE)
    c.line(28, 27, width - 28, 27)
    set_font(c, 6.3, color=MUTED)
    c.drawCentredString(width / 2, 16, "TAM Asset Management International Ltd")
    c.drawRightString(width - 28, 16, f"Monthly factsheet | {date_label(DATA['meta']['dataAsOf'])} | {page_no}")


def panel(c, x, y, w, h, title=None, title_color=NAVY, fill=white, radius=6):
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.roundRect(x, y - h, w, h, radius, fill=1, stroke=1)
    if title:
        set_font(c, 9, True, title_color)
        c.drawString(x + 11, y - 17, title.upper())
        c.setStrokeColor(LINE)
        c.line(x + 11, y - 24, x + w - 11, y - 24)


def performance_chart(c, x, y, w, h, show_legend=True, background=white):
    history = P["performance"]["history"]
    c.setFillColor(background)
    c.rect(x, y - h, w, h, fill=1, stroke=0)
    margin_l, margin_r, margin_t, margin_b = 30, 10, 12, 22
    px, py = x + margin_l, y - h + margin_b
    pw, ph = w - margin_l - margin_r, h - margin_t - margin_b
    values = [p[k] for p in history for k in ("portfolio", "benchmark")]
    vmin, vmax = min(values), max(values)
    pad = max((vmax - vmin) * 0.08, 2)
    vmin, vmax = vmin - pad, vmax + pad
    for i in range(5):
        value = vmin + (vmax - vmin) * i / 4
        yy = py + ph * i / 4
        c.setStrokeColor(LINE)
        c.setLineWidth(0.5)
        c.line(px, yy, px + pw, yy)
        set_font(c, 5.8, color=MUTED)
        c.drawRightString(px - 4, yy - 2, f"{value:.0f}")

    def points(field):
        return [
            (px + pw * i / (len(history) - 1), py + ph * (point[field] - vmin) / (vmax - vmin))
            for i, point in enumerate(history)
        ]

    for field, color, line_width in [("benchmark", AMBER, 1.5), ("portfolio", BLUE, 2.2)]:
        pts = points(field)
        path = c.beginPath()
        path.moveTo(*pts[0])
        for point in pts[1:]:
            path.lineTo(*point)
        c.setStrokeColor(color)
        c.setLineWidth(line_width)
        c.drawPath(path, stroke=1, fill=0)

    for index in [0, 12, 24, 36, 48, 60]:
        point = history[index]
        xx = px + pw * index / (len(history) - 1)
        set_font(c, 5.8, color=MUTED)
        c.drawCentredString(xx, py - 12, datetime.strptime(point["date"], "%Y-%m-%d").strftime("%b %y"))

    if show_legend:
        set_font(c, 6.5, True, BLUE)
        c.drawString(x + w - 126, y - 8, "Portfolio")
        set_font(c, 6.5, True, AMBER)
        c.drawString(x + w - 68, y - 8, "Benchmark")


def simple_table(c, x, y, w, headers, rows, row_h=18, header_fill=NAVY, font_size=7.2, colored_series=True, highlight_last=False, color_series_rows=False):
    col_w = [w / len(headers)] * len(headers)
    c.setFillColor(header_fill)
    c.rect(x, y - row_h, w, row_h, fill=1, stroke=0)
    for i, header in enumerate(headers):
        set_font(c, font_size, True, white)
        c.drawCentredString(x + sum(col_w[:i]) + col_w[i] / 2, y - row_h + 6, clean(header))
    current_y = y - row_h
    for row_index, row in enumerate(rows):
        current_y -= row_h
        row_fill = PALE_BLUE if highlight_last and row_index == len(rows) - 1 else LIGHT if row_index % 2 else white
        c.setFillColor(row_fill)
        c.rect(x, current_y, w, row_h, fill=1, stroke=0)
        c.setStrokeColor(LINE)
        c.line(x, current_y, x + w, current_y)
        for i, value in enumerate(row):
            color = TEXT
            if color_series_rows:
                color = BLUE if row_index == 0 else AMBER if row_index == 1 else TEXT
            elif colored_series and i > 0:
                color = BLUE if i == 1 else AMBER if i == 2 else TEXT
            set_font(c, font_size, i == 0, color)
            if i == 0:
                c.drawString(x + 6, current_y + 6, clean(value))
            else:
                c.drawCentredString(x + sum(col_w[:i]) + col_w[i] / 2, current_y + 6, clean(value))
    c.setStrokeColor(LINE)
    c.rect(x, current_y, w, row_h * (len(rows) + 1), fill=0, stroke=1)
    return current_y


def donut(c, cx, cy, radius, values, colors, hole=0.55):
    start = 90
    total = sum(values)
    for value, color in zip(values, colors):
        if value <= 0:
            continue
        extent = -360 * value / total
        c.setFillColor(color)
        c.setStrokeColor(white)
        c.wedge(cx - radius, cy - radius, cx + radius, cy + radius, start, extent, fill=1, stroke=1)
        start += extent
    c.setFillColor(white)
    c.circle(cx, cy, radius * hole, fill=1, stroke=0)


def horizontal_bars(c, x, y, w, rows, max_value=100, row_h=21):
    for index, row in enumerate(rows):
        yy = y - index * row_h
        set_font(c, 7.2, True, TEXT)
        c.drawString(x, yy, clean(row["name"]))
        c.setFillColor(LINE)
        c.roundRect(x + 82, yy - 2, w - 122, 6, 3, fill=1, stroke=0)
        c.setFillColor(BLUE)
        c.roundRect(x + 82, yy - 2, (w - 122) * row["allocation"] / max_value, 6, 3, fill=1, stroke=0)
        set_font(c, 7.2, True, BLUE)
        c.drawRightString(x + w, yy, pct(row["allocation"], 1))


def profile_strip(c, x, y, w, selected="Balanced 60", dark=False):
    profiles = ["Defensive 20", "Cautious 40", "Balanced 60", "Growth 80", "High Growth 100"]
    line_color = HexColor("#7798B1") if dark else LINE
    c.setStrokeColor(line_color)
    c.setLineWidth(2)
    c.line(x + 20, y, x + w - 20, y)
    for i, profile in enumerate(profiles):
        xx = x + 20 + (w - 40) * i / 4
        active = profile == selected
        c.setFillColor(AMBER if active else (white if dark else HexColor("#AFC0CB")))
        c.circle(xx, y, 6 if active else 4, fill=1, stroke=0)
        set_font(c, 5.8, active, white if dark else MUTED)
        c.drawCentredString(xx, y - 15, profile.replace(" ", "\n") if False else profile)


def draw_info_rows(c, x, y, w, rows, row_h=18, size=7.2):
    for i, row in enumerate(rows):
        yy = y - i * row_h
        c.setStrokeColor(LINE)
        c.line(x, yy - 6, x + w, yy - 6)
        set_font(c, size, True, MUTED)
        c.drawString(x, yy, clean(row["label"]))
        set_font(c, size, True, TEXT)
        c.drawRightString(x + w, yy, clean(row["value"]))


def disclaimer(c, x, y, w, size=5.8, lines=5, color=MUTED):
    text = (
        "Past performance is not a reliable indicator of future results. The value of investments and any income from them may fall as well as rise, and investors may receive back less than they invested. "
        "This document is for general information only and does not constitute investment, legal or tax advice. Portfolio information may change without notice."
    )
    paragraph(c, text, x, y, w, size=size, leading=size + 2, color=color, max_lines=lines)


def full_disclaimer(c, x, y, w):
    paragraph(c, FULL_DISCLAIMER, x, y, w, size=5.2, leading=7.1, color=MUTED)


def create_classic(path):
    width, height = A4
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle("TAM Factsheet Concept 1 - Classic Institutional")

    # Page 1
    c.setFillColor(NAVY)
    c.rect(0, height - 105, width, 105, fill=1, stroke=0)
    brand(c, 30, height - 38)
    set_font(c, 18, True, white)
    c.drawString(30, height - 70, P["name"])
    set_font(c, 8, color=white)
    c.drawString(30, height - 88, "MODEL PORTFOLIO FACTSHEET")
    c.drawRightString(width - 30, height - 88, f"AS AT {date_label(DATA['meta']['dataAsOf']).upper()}")

    panel(c, 28, height - 122, width - 56, 70, "Portfolio risk profile", fill=PALE_BLUE)
    profile_strip(c, 42, height - 165, width - 84)

    panel(c, 28, height - 207, width - 56, 100, "Investment objective")
    paragraph(c, P["objective"], 40, height - 240, width - 80, 8.1, 11.2, max_lines=6)

    info_y = height - 322
    panel(c, 28, info_y, 250, 158, "Portfolio information")
    draw_info_rows(c, 40, info_y - 39, 226, P["information"], row_h=19)

    panel(c, 290, info_y, width - 318, 158, "Performance growth of 100")
    performance_chart(c, 298, info_y - 29, width - 334, 118)

    table_y = height - 500
    cumulative = P["performance"]["cumulative"]
    annual = P["performance"]["annualised"]
    simple_table(c, 28, table_y, 258, ["Cumulative", "Portfolio", "Benchmark"], [
        [period, pct(cumulative["portfolio"][period]), pct(cumulative["benchmark"][period])]
        for period in cumulative["columns"]
    ], row_h=18)
    simple_table(c, 298, table_y, width - 326, ["Annualised", "Portfolio", "Benchmark"], [
        [period, pct(annual["portfolio"][period]), pct(annual["benchmark"][period])]
        for period in annual["columns"]
    ], row_h=18)

    cal_y = height - 597
    calendar = P["performance"]["calendar"]
    headers = ["Calendar year"] + calendar["columns"]
    simple_table(c, 28, cal_y, width - 56, headers, [
        ["Portfolio"] + [pct(calendar["portfolio"][period]) for period in calendar["columns"]],
        ["Benchmark"] + [pct(calendar["benchmark"][period]) for period in calendar["columns"]],
    ], row_h=19, colored_series=False)
    set_font(c, 6.2, color=MUTED)
    c.drawString(28, height - 678, "Performance is shown net of investment management fees where applicable and in GBP.")
    disclaimer(c, 28, height - 700, width - 56, size=5.8, lines=5)
    footer(c, width, 1, "Concept 1: Classic institutional")
    c.showPage()

    # Page 2
    c.setFillColor(NAVY)
    c.rect(0, height - 62, width, 62, fill=1, stroke=0)
    brand(c, 28, height - 37, compact=True)
    set_font(c, 13, True, white)
    c.drawRightString(width - 28, height - 37, "PORTFOLIO COMPOSITION AND RISK")

    panel(c, 28, height - 80, 260, 165, "Asset allocation")
    horizontal_bars(c, 40, height - 121, 235, P["allocation"]["summary"], row_h=26)
    panel(c, 300, height - 80, width - 328, 165, "Regional exposure")
    regions = P["regionalExposure"]
    donut(c, 372, height - 157, 46, [r["allocation"] for r in regions], REGION_COLORS)
    for i, region in enumerate(regions):
        yy = height - 112 - i * 23
        c.setFillColor(REGION_COLORS[i])
        c.circle(433, yy + 2, 3, fill=1, stroke=0)
        set_font(c, 6.8, True, TEXT)
        c.drawString(441, yy, clean(region["name"]))
        c.drawRightString(width - 40, yy, pct(region["allocation"], 1))

    holdings_y = height - 265
    panel(c, 28, holdings_y, width - 56, 205, "Top 10 holdings")
    simple_table(c, 39, holdings_y - 31, width - 78, ["Holding", "Asset class", "Weight"], [
        [h["name"], h["assetClass"], pct(h["weight"], 2)] for h in P["holdings"]
    ], row_h=15, font_size=6.4, colored_series=False)

    risk_y = height - 489
    panel(c, 28, risk_y, 258, 205, "Risk statistics")
    simple_table(c, 39, risk_y - 31, 236, ["Measure", "Portfolio", "Benchmark"], [
        ["Annualised volatility", pct(PORT_RISK["volatility"]), pct(BENCH_RISK["volatility"])],
        ["Best month", pct(PORT_RISK["best"]), pct(BENCH_RISK["best"])],
        ["Worst month", pct(PORT_RISK["worst"]), pct(BENCH_RISK["worst"])],
        ["Positive months", pct(PORT_RISK["positive"], 1), pct(BENCH_RISK["positive"], 1)],
        ["Downside volatility", pct(PORT_RISK["downside"]), pct(BENCH_RISK["downside"])],
    ], row_h=18, font_size=6.7)

    panel(c, 298, risk_y, width - 326, 205, "Drawdown analysis")
    simple_table(c, 309, risk_y - 31, width - 348, ["Measure", "Portfolio", "Benchmark"], [
        ["Maximum drawdown", pct(PORT_DD["maximum"]), pct(BENCH_DD["maximum"])],
        ["Peak date", date_label(PORT_DD["peak"]), date_label(BENCH_DD["peak"])],
        ["Trough date", date_label(PORT_DD["trough"]), date_label(BENCH_DD["trough"])],
        ["Months to trough", str(PORT_DD["months_to_trough"]), str(BENCH_DD["months_to_trough"])],
        ["Recovery date", date_label(PORT_DD["recovery"]), date_label(BENCH_DD["recovery"])],
        ["Current drawdown", pct(PORT_DD["current"]), pct(BENCH_DD["current"])],
    ], row_h=18, font_size=6.3)
    disclaimer(c, 28, height - 715, width - 56, size=5.7, lines=5)
    footer(c, width, 2, "Concept 1: Classic institutional")
    c.save()


def create_dashboard(path):
    width, height = A4
    c = canvas.Canvas(path, pagesize=A4)
    c.setTitle("TAM Factsheet Concept 2 - One Page Dashboard")
    c.setFillColor(LIGHT)
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(DEEP_NAVY)
    c.rect(0, height - 92, width, 92, fill=1, stroke=0)
    brand(c, 28, height - 35)
    set_font(c, 17, True, white)
    c.drawString(28, height - 64, P["name"])
    set_font(c, 7.2, color=white)
    c.drawRightString(width - 28, height - 64, f"MONTHLY FACTSHEET | {date_label(DATA['meta']['dataAsOf']).upper()}")

    metrics = [
        ("1 YEAR RETURN", P["performance"]["cumulative"]["portfolio"]["1 Year"], BLUE),
        ("3 YEAR ANNUALISED", P["performance"]["annualised"]["portfolio"]["3 Year"], BLUE),
        ("VOLATILITY", PORT_RISK["volatility"], NAVY),
        ("MAX DRAWDOWN", PORT_DD["maximum"], AMBER),
    ]
    card_w = (width - 56 - 24) / 4
    for i, (label, value, color) in enumerate(metrics):
        x = 28 + i * (card_w + 8)
        panel(c, x, height - 108, card_w, 62, fill=white)
        set_font(c, 6.1, True, MUTED)
        c.drawString(x + 9, height - 127, label)
        set_font(c, 17, True, color)
        c.drawString(x + 9, height - 153, pct(value, 2))

    panel(c, 28, height - 180, width - 56, 186, "Five year performance")
    performance_chart(c, 39, height - 211, width - 78, 144)

    top = height - 382
    col_w = (width - 72) / 3
    panel(c, 28, top, col_w, 181, "Asset allocation")
    allocations = P["allocation"]["summary"]
    donut(c, 28 + col_w / 2, top - 75, 48, [a["allocation"] for a in allocations], REGION_COLORS)
    for i, row in enumerate(allocations):
        yy = top - 137 - i * 12
        c.setFillColor(REGION_COLORS[i])
        c.circle(39, yy + 2, 2.4, fill=1, stroke=0)
        set_font(c, 5.8, True, TEXT)
        c.drawString(46, yy, row["name"])
        c.drawRightString(28 + col_w - 10, yy, pct(row["allocation"], 1))

    x2 = 36 + col_w
    panel(c, x2, top, col_w, 181, "Regional exposure")
    regions = P["regionalExposure"]
    donut(c, x2 + col_w / 2, top - 75, 48, [r["allocation"] for r in regions], REGION_COLORS)
    for i, row in enumerate(regions):
        yy = top - 137 - i * 12
        c.setFillColor(REGION_COLORS[i])
        c.circle(x2 + 11, yy + 2, 2.4, fill=1, stroke=0)
        set_font(c, 5.8, True, TEXT)
        c.drawString(x2 + 18, yy, clean(row["name"]))
        c.drawRightString(x2 + col_w - 10, yy, pct(row["allocation"], 1))

    x3 = 44 + col_w * 2
    panel(c, x3, top, col_w, 181, "Top five holdings")
    for i, holding in enumerate(P["holdings"][:5]):
        yy = top - 38 - i * 27
        c.setFillColor(BLUE)
        c.roundRect(x3 + 10, yy - 1, 4, 17, 2, fill=1, stroke=0)
        paragraph(c, holding["name"], x3 + 21, yy + 9, col_w - 60, 5.9, 7, max_lines=2)
        set_font(c, 7, True, BLUE)
        c.drawRightString(x3 + col_w - 10, yy + 3, pct(holding["weight"], 1))

    bottom_y = height - 580
    panel(c, 28, bottom_y, 276, 133, "Objective")
    paragraph(c, P["objective"], 40, bottom_y - 34, 252, 7.1, 9.2, max_lines=9)
    panel(c, 316, bottom_y, width - 344, 133, "Key information")
    draw_info_rows(c, 328, bottom_y - 37, width - 368, P["information"][:5], row_h=17, size=6.2)

    set_font(c, 6, True, NAVY)
    c.drawString(28, height - 726, "RISK PROFILE")
    profile_strip(c, 92, height - 725, width - 120)
    disclaimer(c, 28, height - 754, width - 56, size=5.4, lines=4)
    footer(c, width, 1, "Concept 2: One-page dashboard")
    c.save()


def create_editorial(path):
    global PORT_RISK, BENCH_RISK, PORT_DD, BENCH_DD
    PORT_RISK = risk_stats("portfolio")
    BENCH_RISK = risk_stats("benchmark")
    PORT_DD = drawdown_stats("portfolio")
    BENCH_DD = drawdown_stats("benchmark")
    width, height = landscape(A4)
    c = canvas.Canvas(path, pagesize=(width, height))
    c.setTitle(f"TAM MPS Factsheet - {P['name']}")
    c.setAuthor("TAM Asset Management International Ltd")

    # Page 1
    sidebar = 245
    c.setFillColor(DEEP_NAVY)
    c.rect(0, 0, sidebar, height, fill=1, stroke=0)
    brand(c, 28, height - 42)
    set_font(c, 8, True, HexColor("#9FC0D7"))
    c.drawString(28, height - 82, "TAM MANAGED PORTFOLIO SERVICE")
    set_font(c, 25, True, white)
    for i, line in enumerate([P["type"], P["risk"], P["currency"]]):
        c.drawString(28, height - 122 - i * 31, line)
    set_font(c, 7, color=white)
    c.drawString(28, height - 224, f"MONTHLY FACTSHEET | {date_label(DATA['meta']['dataAsOf']).upper()}")
    set_font(c, 8, True, HexColor("#9FC0D7"))
    c.drawString(28, height - 270, "INVESTMENT OBJECTIVE")
    paragraph(c, P["objective"], 28, height - 291, sidebar - 56, 7.7, 11, color=white, max_lines=14)
    set_font(c, 8, True, HexColor("#9FC0D7"))
    c.drawString(28, 170, "STRATEGIC BENCHMARK")
    set_font(c, 11, True, white)
    benchmark_lines = [part.strip() for part in P["benchmarkName"].split(",") if part.strip()]
    for i, line in enumerate(benchmark_lines[:2]):
        c.drawString(28, 149 - i * 17, clean(line))
    equity_weight = max(0, min(100, P.get("targetEquity", 0)))
    bond_weight = 100 - equity_weight
    c.setFillColor(BLUE)
    c.rect(28, 105, 189 * equity_weight / 100, 9, fill=1, stroke=0)
    c.setFillColor(AMBER)
    c.rect(28 + 189 * equity_weight / 100, 105, 189 * bond_weight / 100, 9, fill=1, stroke=0)
    disclaimer(c, 28, 79, sidebar - 56, size=5.2, lines=7, color=HexColor("#91A9B9"))

    content_x = sidebar + 28
    content_w = width - sidebar - 56
    set_font(c, 9, True, MUTED)
    c.drawString(content_x, height - 38, "PERFORMANCE")
    set_font(c, 17, True, NAVY)
    c.drawString(content_x, height - 62, "Growth and consistency across market cycles")
    performance_chart(c, content_x, height - 82, content_w, 238, background=white)

    metrics_y = height - 342
    metric_data = [
        ("1 YEAR", P["performance"]["cumulative"]["portfolio"]["1 Year"], P["performance"]["cumulative"]["benchmark"]["1 Year"]),
        ("3 YEAR ANN.", P["performance"]["annualised"]["portfolio"]["3 Year"], P["performance"]["annualised"]["benchmark"]["3 Year"]),
        ("5 YEAR ANN.", P["performance"]["annualised"]["portfolio"]["5 Year"], P["performance"]["annualised"]["benchmark"]["5 Year"]),
        ("VOLATILITY", PORT_RISK["volatility"], BENCH_RISK["volatility"]),
    ]
    metric_w = (content_w - 24) / 4
    for i, (label, portfolio_value, benchmark_value) in enumerate(metric_data):
        x = content_x + i * (metric_w + 8)
        c.setFillColor(LIGHT)
        c.roundRect(x, metrics_y - 82, metric_w, 82, 6, fill=1, stroke=0)
        set_font(c, 6.5, True, MUTED)
        c.drawString(x + 10, metrics_y - 18, label)
        set_font(c, 17, True, BLUE)
        c.drawString(x + 10, metrics_y - 44, pct(portfolio_value))
        set_font(c, 6.2, True, AMBER)
        c.drawString(x + 10, metrics_y - 61, f"Benchmark {pct(benchmark_value)}")
        if label != "VOLATILITY":
            set_font(c, 5.7, True, MUTED)
            c.drawString(x + 10, metrics_y - 74, f"Difference {pct(portfolio_value - benchmark_value, 2, sign=True)}")

    calendar = P["performance"]["calendar"]
    simple_table(c, content_x, height - 443, content_w, ["Calendar year"] + calendar["columns"], [
        ["Portfolio"] + [pct(calendar["portfolio"][period]) for period in calendar["columns"]],
        ["Benchmark"] + [pct(calendar["benchmark"][period]) for period in calendar["columns"]],
        ["Difference"] + [pct(calendar["portfolio"][period] - calendar["benchmark"][period], 2, sign=True) for period in calendar["columns"]],
    ], row_h=19, header_fill=BLUE, font_size=7, colored_series=False, highlight_last=True, color_series_rows=True)
    production_footer(c, width, 1)
    c.showPage()

    # Page 2
    c.setFillColor(LIGHT)
    c.rect(0, 0, width, height, fill=1, stroke=0)
    c.setFillColor(DEEP_NAVY)
    c.rect(0, height - 65, width, 65, fill=1, stroke=0)
    brand(c, 28, height - 39, compact=True)
    set_font(c, 14, True, white)
    c.drawRightString(width - 28, height - 39, "INSIDE THE PORTFOLIO")

    left = 28
    col = (width - 72) / 3
    top = height - 84
    panel(c, left, top, col, 205, "Asset allocation")
    allocations = P["allocation"]["summary"]
    donut(c, left + 78, top - 105, 57, [a["allocation"] for a in allocations], ASSET_COLORS)
    for i, row in enumerate(allocations):
        yy = top - 57 - i * 30
        c.setFillColor(ASSET_COLORS[i])
        c.circle(left + 153, yy + 2, 3, fill=1, stroke=0)
        set_font(c, 6.6, True, TEXT)
        c.drawString(left + 162, yy, row["name"])
        c.drawRightString(left + col - 12, yy, pct(row["allocation"], 1))

    mid = left + col + 8
    panel(c, mid, top, col, 205, "Regional exposure")
    regions = P["regionalExposure"]
    donut(c, mid + 78, top - 105, 57, [r["allocation"] for r in regions], REGION_COLORS)
    for i, row in enumerate(regions):
        yy = top - 57 - i * 30
        c.setFillColor(REGION_COLORS[i])
        c.circle(mid + 153, yy + 2, 3, fill=1, stroke=0)
        set_font(c, 6.6, True, TEXT)
        c.drawString(mid + 162, yy, clean(row["name"]))
        c.drawRightString(mid + col - 12, yy, pct(row["allocation"], 1))

    right = mid + col + 8
    panel(c, right, top, col, 205, "Portfolio information")
    draw_info_rows(c, right + 12, top - 40, col - 24, P["information"], row_h=26, size=6.5)

    lower = height - 310
    panel(c, left, lower, col * 1.5 + 4, 200, "Top holdings")
    simple_table(c, left + 11, lower - 32, col * 1.5 - 18, ["Holding", "Asset class", "Weight"], [
        [h["name"], h["assetClass"], pct(h["weight"], 1)] for h in P["holdings"][:8]
    ], row_h=18, font_size=6.2, header_fill=BLUE, colored_series=False)

    risk_x = left + col * 1.5 + 12
    risk_w = width - risk_x - 28
    panel(c, risk_x, lower, risk_w, 200, "Risk and drawdown")
    simple_table(c, risk_x + 11, lower - 32, risk_w - 22, ["Measure", "Portfolio", "Benchmark"], [
        ["Annualised volatility", pct(PORT_RISK["volatility"]), pct(BENCH_RISK["volatility"])],
        ["Downside volatility", pct(PORT_RISK["downside"]), pct(BENCH_RISK["downside"])],
        ["Positive months", pct(PORT_RISK["positive"], 1), pct(BENCH_RISK["positive"], 1)],
        ["Maximum drawdown", pct(PORT_DD["maximum"]), pct(BENCH_DD["maximum"])],
        ["Peak to trough", f"{PORT_DD['months_to_trough']} months", f"{BENCH_DD['months_to_trough']} months"],
        ["Recovery", date_label(PORT_DD["recovery"]), date_label(BENCH_DD["recovery"])],
        ["Current drawdown", pct(PORT_DD["current"]), pct(BENCH_DD["current"])],
    ], row_h=20, font_size=6.7, header_fill=AMBER)
    full_disclaimer(c, 28, 66, width - 56)
    production_footer(c, width, 2)
    c.save()


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(SITE_OUTPUT_DIR, exist_ok=True)
    for portfolio in DATA["portfolios"].values():
        global P
        P = portfolio
        filename = portfolio.get("pdfFileName") or f"{portfolio['websiteSlug']}.pdf"
        site_path = os.path.join(SITE_OUTPUT_DIR, filename)
        create_editorial(site_path)
        if portfolio["risk"] == "Balanced 60":
            create_editorial(os.path.join(OUTPUT_DIR, "tam_factsheet_final_design_balanced_60.pdf"))
        print(f"Created {filename}")


if __name__ == "__main__":
    main()
