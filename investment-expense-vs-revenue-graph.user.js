// ==UserScript==
// @name         JustEtf Investment Expense/Revenue Graph
// @version      1.5
// @description  Displays an investment expense vs. revenue graph on justETF
// @match        https://www.justetf.com/*/dashboard-activity.html?portfolioId=*
// @author       fl3xm3ist3r
// @namespace    https://github.com/fl3xm3ist3r
// @grant        GM.xmlHttpRequest
// @connect      query1.finance.yahoo.com
// ==/UserScript==

/*---------- SCRIPT INFO ----------
This script generates a dynamic expense vs revenue graph for investment tracking on justETF.
It is a quick and dirty solution intended for personal use or as a starting point for customization.
Ensure compliance with JustETF's terms of service when using this script.
Licensed under the MIT License - https://opensource.org/licenses/MIT
-----------------------------------*/

/*---------- CONFIGURATION ----------*/
const TRADING_TYPES = {
    DEPOSIT: "Einlieferung",
    WITHDRAWAL: "Auslieferung",
    BUY: "Kauf",
    SELL: "Verkauf",
};

const DATE_RANGE_UPDATE_INTERVAL = 5000; // in milliseconds
const ADJUSTMENT_DELAY = 500; // delay before reapplying adjustments

const DEFAULT_START_DATE = null; // example: "dd.mm.yyyy" (null for default)

const MANUAL_ADJUSTMENTS = []; // example: {date: "dd.mm.yyyy", adjustment: 1000} ([] for default)

// Yahoo Finance (seecret) API based
const STOCKS_TRADING_HISTORY = []; // example: { type: TRADING_TYPE.BUY, symbol: "", date: "dd.mm.yyyy", amount: 1, price: 100.5, fee: 2, tax: 0.5 } ([] for default)

const EXCHANGE_RATES = []; // example: { name: "CHF", rate: 1, reverse: 1 }, { name: "USD", rate: 0.91, reverse: 1.1 } ([] for default)

(async function () {
    ("use strict");

    /*---------- UTILITY FUNCTIONS ----------*/
    const dateToTimestamp = (dateString) => {
        const [day, month, year] = dateString.split(".").map(Number);
        return Date.UTC(2000 + year, month - 1, day);
    };

    const getTimestampFromDate = (date) => dateToTimestamp(convertDateFormat(date));

    const convertDateFormat = (date) => {
        const [day, month, year] = date.split(/[./]/);
        return `${day}.${month}.${year.slice(-2)}`;
    };

    const formatNumber = (number, useComma) => {
        const locale = useComma ? "de-DE" : "en-US";
        return number.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const getExpenseWithoutFeeAndTaxAtTime = (timestamp) => getExpenseAtTime(timestamp) - getTaxAndFeeAtTime(timestamp);

    /*---------- TRANSACTION DATA PARSING ----------*/
    const portfolioId = new URLSearchParams(window.location.search).get("portfolioId");

    async function fetchTransactionData(id) {
        const response = await fetch(`https://www.justetf.com/de/transactions.html?portfolioId=${id}`);
        const parser = new DOMParser();
        return parser.parseFromString(await response.text(), "text/html");
    }

    function parseTransactionRow(row) {
        const type = row.querySelector("td").textContent.trim();
        if (!Object.values(TRADING_TYPES).includes(type)) return;

        const timestamp = dateToTimestamp(row.querySelector("td.tal-center").textContent.trim());
        const parseCurrency = (selector, index, isExpense = false) => {
            const value = row.querySelectorAll(selector)[index].textContent.trim();
            const negativePrefix = isExpense && !value.includes("-") ? "-" : "";
            return parseFloat(negativePrefix + value.replace(".", "").replace(",", ".").replace("-", ""));
        };

        const expense = parseCurrency("td.tal-right.column-priority-3.ws", 1, true);
        const fees = parseCurrency("td.tal-right.visible-lg", 0);
        const tax = parseCurrency("td.tal-right.visible-lg", 1);

        return { timestamp, totalExpense: expense + fees + tax, taxAndFee: fees + tax };
    }

    const transactionDoc = await fetchTransactionData(portfolioId);
    const tableRows = transactionDoc.querySelectorAll("table.table-hover tbody tr");

    const parsedRows = Array.from(tableRows).map(parseTransactionRow).filter(Boolean);

    const expensesByTimestamp = parsedRows.reduce((acc, { timestamp, totalExpense }) => {
        acc.set(timestamp, (acc.get(timestamp) || 0) + totalExpense);
        return acc;
    }, new Map());

    STOCKS_TRADING_HISTORY.forEach(({ type, date, amount, price, fee, tax }) => {
        const timestamp = getTimestampFromDate(date);
        const total = type === TRADING_TYPES.BUY || type === TRADING_TYPES.DEPOSIT ? amount * price : -amount * price;
        expensesByTimestamp.set(timestamp, (expensesByTimestamp.get(timestamp) || 0) + total + fee + tax);
    });

    const expenses = Array.from(expensesByTimestamp, ([timestamp, totalExpense]) => [Number(timestamp), totalExpense]);
    expenses.sort((a, b) => b[0] - a[0]);

    const totalExpenses = expenses.reduce((sum, [, expense]) => sum + expense, 0);
    let currentTotalExpenses = totalExpenses;

    const expenseData = expenses.map(([timestamp], i) => {
        if (i !== 0) {
            currentTotalExpenses -= expenses[i - 1][1];
        }
        return { x: timestamp, y: Math.round(currentTotalExpenses) };
    });

    const taxAndFeeByTimestamp = parsedRows.reduce((acc, { timestamp, taxAndFee }) => {
        acc.set(timestamp, (acc.get(timestamp) || 0) + taxAndFee);
        return acc;
    }, new Map());

    STOCKS_TRADING_HISTORY.forEach(({ date, fee, tax }) => {
        const timestamp = getTimestampFromDate(date);
        taxAndFeeByTimestamp.set(timestamp, (taxAndFeeByTimestamp.get(timestamp) || 0) + fee + tax);
    });

    const taxAndFees = Array.from(taxAndFeeByTimestamp, ([timestamp, taxAndFee]) => [Number(timestamp), taxAndFee]);
    taxAndFees.sort((a, b) => b[0] - a[0]);

    const totalTaxAndFees = taxAndFees.reduce((sum, [, taxAndFee]) => sum + taxAndFee, 0);
    let currentTotalTaxAndFees = totalTaxAndFees;

    const taxAndFeeData = taxAndFees.map(([timestamp], i) => {
        if (i !== 0) {
            currentTotalTaxAndFees -= taxAndFees[i - 1][1];
        }
        return { x: timestamp, y: Math.round(currentTotalTaxAndFees) };
    });

    const performanceChart = Highcharts.charts[0];
    const getExpenseAtTime = (timestamp) => expenseData.find(({ x }) => x <= timestamp)?.y || 0;
    const getTaxAndFeeAtTime = (timestamp) => taxAndFeeData.find(({ x }) => x <= timestamp)?.y || 0;

    /*---------- STOCK TRADES ----------*/
    let stockRevenue = 0;
    let stockExpense = 0;

    function reduceStockResponse(data) {
        const result = data.chart.result[0];
        const closes = result.indicators.quote[0].close;
        const timestamps = result.timestamp;

        const filteredTimestamps = [];
        const filteredCloses = [];

        for (let i = 0; i < closes.length; i++) {
            if (closes[i] !== null && closes[i] !== undefined && timestamps[i] != null && timestamps[i] != undefined) {
                filteredTimestamps.push(timestamps[i]);
                filteredCloses.push(closes[i]);
            }
        }

        return {
            currency: result.meta.currency,
            timestamp: filteredTimestamps,
            close: filteredCloses,
            marketPrice: result.meta.regularMarketPrice,
        };
    }

    function fetchStockHistory(symbol, from) {
        const to = Math.floor(Date.now() / 1000);
        from = Math.floor(from / 1000);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&period1=${from}&period2=${to}`;

        return new Promise((resolve, reject) => {
            GM.xmlHttpRequest({
                method: "GET",
                url: url,
                headers: {
                    "User-Agent": "Mozilla/5.0",
                    Accept: "application/json",
                },
                onload: function (response) {
                    try {
                        const data = JSON.parse(response.responseText);
                        resolve(reduceStockResponse(data));
                    } catch (error) {
                        reject("Error parsing JSON: " + error);
                    }
                },
                onerror: function (error) {
                    reject("Error fetching data: " + error);
                },
            });
        });
    }

    const stockChanges = new Map();

    function applyStockAdjustment(timestamp, dayAdjustment, isBuy) {
        stockRevenue += dayAdjustment;
        const percentualToTotal = (100 / getExpenseWithoutFeeAndTaxAtTime(timestamp)) * dayAdjustment;
        const adjustment = isBuy ? percentualToTotal : -percentualToTotal;
        stockChanges.set(timestamp, (stockChanges.get(timestamp) || 0) + adjustment);
    }

    for (const { type, date, symbol, amount, price } of STOCKS_TRADING_HISTORY) {
        const result = await fetchStockHistory(symbol, getTimestampFromDate(date));
        const exchange = EXCHANGE_RATES.find(({ name }) => name === result.currency);

        const isBuy = type === TRADING_TYPES.BUY || type === TRADING_TYPES.DEPOSIT;

        stockExpense += price * amount * exchange.rate;

        const firstDayTimestamp = getTimestampFromDate(date);

        const hasCloseData = Array.isArray(result.close) && result.close.length > 0;
        const priceDifference = hasCloseData
            ? result.close[0] - price * exchange.reverse
            : result.marketPrice - price * exchange.reverse;

        const firstDayAdjustment = priceDifference * amount * exchange.rate;
        applyStockAdjustment(firstDayTimestamp, firstDayAdjustment, isBuy);

        if (hasCloseData) {
            for (let i = 1; i < result.timestamp.length; i++) {
                let currentTimestamp = result.timestamp[i] * 1000;

                if (i === result.timestamp.length - 1) {
                    currentTimestamp = performanceChart.series[0].data.at(-1).x;
                }

                const dayAdjustment = (result.close[i] - result.close[i - 1]) * amount * exchange.rate;
                applyStockAdjustment(currentTimestamp, dayAdjustment, isBuy);
            }
        }
    }

    stockChanges.forEach((adjustment, timestamp) => {
        const dataPointIndex = [...performanceChart.series[0].data].reverse().findIndex(({ x }) => x <= timestamp);
        const adjustedIndex = dataPointIndex !== -1 ? performanceChart.series[0].data.length - 1 - dataPointIndex : -1;
        const dataPoint = adjustedIndex !== -1 ? performanceChart.series[0].data[adjustedIndex] : null;
        if (dataPoint) {
            dataPoint.update({ y: dataPoint.y + adjustment });

            // Update weekends with the change of Friday
            const date = new Date(dataPoint.x);
            if (date.getDay() === 5) {
                [1, 2].forEach((offset) => {
                    const point = performanceChart.series[0].data[adjustedIndex + offset];

                    if (point) {
                        point.update({ y: point.y + adjustment });
                    }
                });
            }
        } else {
            console.log("Datapoint wasn't found for timestamp: " + timestamp + ". STOCKS_TRADING_HISTORY!");
        }
    });

    /*---------- MANUAL ADJUSTMENTS ----------*/
    const manualAdjustmentsTotal = MANUAL_ADJUSTMENTS.reduce((sum, { adjustment }) => sum + adjustment, 0);

    MANUAL_ADJUSTMENTS.forEach(({ date, adjustment }) => {
        const timestamp = getTimestampFromDate(date);
        const futureDataPoints = performanceChart.series[0].data.filter(({ x }) => x >= timestamp);
        futureDataPoints.forEach((data) => {
            const baseExpenseAtTime = getExpenseWithoutFeeAndTaxAtTime(data.x);
            const actualValue = (baseExpenseAtTime / 100) * (100 + data.y) + adjustment;
            const percentage = ((actualValue - baseExpenseAtTime) / baseExpenseAtTime) * 100;
            data.update({ y: percentage });
        });

        // Mark manual adjustment data point.
        futureDataPoints[0]?.update({ marker: { enabled: true, fillColor: "#ff6718", radius: 5 } });
    });

    /*---------- UI VALUE UPDATES ----------*/
    const totalValueElement = document.querySelector(".val.v-ellip");
    const totalValueParts = totalValueElement.textContent.split(" ");
    const useComma = totalValueParts[1].charAt(totalValueParts[1].length - 3) === ",";
    let totalValue = parseFloat(
        totalValueParts[1].replace(useComma ? /\./g : /,/g, "").replace(useComma ? /,/g : /\./g, ".")
    );
    totalValue += manualAdjustmentsTotal + stockExpense + stockRevenue;
    totalValueElement.textContent = `${totalValueParts[0]} ${formatNumber(totalValue, useComma)}`;

    const revenueElement = document.querySelector(".val2.green") || document.querySelector(".val2.red");
    let revenueValue = parseFloat(
        revenueElement.textContent
            .replace(/[+\-]/g, "")
            .replace(useComma ? /\./g : /,/g, "")
            .replace(useComma ? /,/g : /\./g, ".")
    );
    revenueValue += manualAdjustmentsTotal + stockRevenue;
    revenueElement.textContent = `${revenueValue > 0 ? "+" : ""}${formatNumber(revenueValue, useComma)}`;
    revenueElement.className = revenueValue > 0 ? "val2 green" : "val2 red";

    const percentageElement = document.querySelector(".val.green") || document.querySelector(".val.red");
    const percentageValue = performanceChart.series[0].data.at(-1).y;
    percentageElement.textContent = `${percentageValue > 0 ? "+" : ""}${formatNumber(percentageValue, useComma)}%`;
    percentageElement.className = percentageValue > 0 ? "val green" : "val red";

    /*---------- REVENUE DATA CONSTRUCTION ----------*/
    function findAdjustment(x) {
        return MANUAL_ADJUSTMENTS.find((e) => getTimestampFromDate(e.date) === x);
    }

    function createRevenuePoint(x, y, isAdjusted = false) {
        return {
            x,
            y,
            ...(isAdjusted && { marker: { enabled: true, fillColor: "#ff6718", radius: 5 } }),
        };
    }

    const revenueData = performanceChart.series[0].data.map(({ x, y }) => {
        const baseExpense = getExpenseWithoutFeeAndTaxAtTime(x);
        const adjustment = findAdjustment(x);
        const isAdjusted = adjustment && !expenseData.some((data) => data.x === x);

        return createRevenuePoint(x, (baseExpense / 100) * (100 + y), isAdjusted);
    });

    // Insert expense points to create a natural revenue graph.
    expenseData.slice(0, -1).forEach(({ x, y }, i) => {
        const nextExpense = expenseData[i + 1].y;

        const index = revenueData.findIndex((data) => data.x === x);
        if (index !== -1) {
            const updatedRevenue = revenueData[index].y - (y - nextExpense);
            const adjustment = findAdjustment(x);

            revenueData.splice(index, 0, createRevenuePoint(x, updatedRevenue, !!adjustment));
        }
    });

    /*---------- CHART RENDERING ----------*/
    const chartContainer = document.createElement("div");
    chartContainer.id = "expense-revenue-chart";
    chartContainer.style.width = "100%";
    document.querySelector(".chartarea").appendChild(chartContainer);

    const highchartData = performanceChart.series[0].data.map(({ x, y, marker }) => ({ x, y, marker }));

    function renderChart(from, to) {
        const tmpHighChart = Highcharts.charts[0];
        const filteredHighchartData = highchartData.filter(({ x }) => x >= from && x <= to);
        tmpHighChart.series[0].setData(filteredHighchartData, true);

        // Filter expense data and include boundary points.
        const filteredExpenseData = expenseData.filter(({ x }) => x >= from && x <= to);
        filteredExpenseData.unshift({ x: to, y: getExpenseAtTime(to) });
        filteredExpenseData.push({ x: from, y: getExpenseAtTime(from) });

        const filteredRevenueData = revenueData.filter(({ x }) => x >= from && x <= to);

        Highcharts.chart("expense-revenue-chart", {
            chart: { type: "scatter" },
            title: { text: "Expense vs Revenue" },
            xAxis: { gridLineWidth: 1, type: "datetime" },
            yAxis: { gridLineWidth: 1 },
            tooltip: {
                formatter: function () {
                    return `${Highcharts.dateFormat("%d.%m.%Y", this.x)}<br>
                            <span style="color: ${this.color}">●</span> ${this.series.name}: <b>${new Intl.NumberFormat(
                        "en-US",
                        { useGrouping: true, minimumFractionDigits: 0, maximumFractionDigits: 0 }
                    )
                        .format(this.y)
                        .replace(/,/g, "'")}</b>`;
                },
                shared: false,
                useHTML: true,
            },
            series: [
                {
                    lineWidth: 2,
                    name: "Expense",
                    data: filteredExpenseData,
                    color: "#D32F2F",
                    marker: { enabled: true, radius: 2, fillColor: "#6e0000" },
                    step: "right",
                },
                {
                    lineWidth: 2,
                    name: "Revenue",
                    data: filteredRevenueData,
                    color: "#008080",
                    marker: { enabled: false },
                },
            ],
        });
    }

    /*---------- DATE RANGE HANDLING ----------*/
    function getDateRange() {
        const rangeText = document.getElementById("daterangepicker").querySelector("span").textContent.trim();
        const [fromDate, toDate] = rangeText.split(" - ");

        return [dateToTimestamp(convertDateFormat(fromDate)), dateToTimestamp(convertDateFormat(toDate))];
    }

    /*---------- INITIALIZATION ----------*/
    let [initialMinDate, initialMaxDate] = getDateRange();
    const startDateTimestamp = DEFAULT_START_DATE
        ? dateToTimestamp(convertDateFormat(DEFAULT_START_DATE))
        : initialMinDate;

    renderChart(startDateTimestamp, initialMaxDate);

    // Check for date range changes periodically and re-render the chart.
    function dateRangeUpdateCheck() {
        const [minDate, maxDate] = getDateRange();
        if (minDate !== initialMinDate || maxDate !== initialMaxDate) {
            initialMinDate = minDate;
            initialMaxDate = maxDate;
            renderChart(minDate, maxDate);
        }
        setTimeout(dateRangeUpdateCheck, DATE_RANGE_UPDATE_INTERVAL);
    }

    dateRangeUpdateCheck();
})();
