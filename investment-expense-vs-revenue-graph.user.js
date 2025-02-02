// ==UserScript==
// @name         JustEtf Investment Expense/Revenue Graph
// @version      1.5
// @description  This script calculates and displays a graph that shows your expenses against your revenue
// @match        https://www.justetf.com/*/dashboard-activity.html?portfolioId=*
// @author       fl3xm3ist3r
// @namespace    https://github.com/fl3xm3ist3r
// ==/UserScript==

/*---------- SCRIPT INFO ----------
This script generates a dynamic expense vs revenue graph for investment tracking on justETF.
It is a quick and dirty solution intended for personal use or as a starting point for customization.
Ensure compliance with JustETF's terms of service when using this script.
Licensed under the MIT License - https://opensource.org/licenses/MIT
-----------------------------------*/

/*---------- CONFIGURATION ----------*/
const DEFAULT_START_DATE = null; // example: "dd.mm.yyyy" (null for default)
const MANUAL_ADJUSTMENTS = []; // example: {date: "dd.mm.yyyy", adjustment: 1000} ([] for default)
const DATE_RANGE_UPDATE_INTERVAL = 5000; // in milliseconds
const ADJUSTMENT_DELAY = 500; // delay before reapplying adjustments

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

    /*---------- DATA FETCHING ----------*/
    const portfolioId = new URLSearchParams(window.location.search).get("portfolioId");

    async function fetchTransactionData(id) {
        const response = await fetch(`https://www.justetf.com/de/transactions.html?portfolioId=${id}`);
        const parser = new DOMParser();
        return parser.parseFromString(await response.text(), "text/html");
    }

    /*---------- TRANSACTION DATA PARSING ----------*/
    function parseTransactionRow(row) {
        const type = row.querySelector("td").textContent.trim();
        if (!["Einlieferung", "Auslieferung", "Kauf", "Verkauf"].includes(type)) return;

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

    const expensesByTimestamp = Array.from(tableRows)
        .map(parseTransactionRow)
        .filter(Boolean)
        .reduce((acc, { timestamp, totalExpense }) => {
            acc[timestamp] = (acc[timestamp] || 0) + totalExpense;
            return acc;
        }, {});

    const expenses = Object.entries(expensesByTimestamp).map(([timestamp, totalExpense]) => [
        parseInt(timestamp),
        totalExpense,
    ]);

    const totalExpenses = expenses.reduce((sum, [, expense]) => sum + expense, 0);
    let currentTotalExpenses = totalExpenses;

    const expenseData = expenses.map(([timestamp, expense], i) => {
        if (i !== 0) {
            currentTotalExpenses -= expenses[i - 1][1];
        }
        return { x: timestamp, y: Math.round(currentTotalExpenses) };
    });

    const taxAndFeeByTimestamp = Array.from(tableRows)
        .map(parseTransactionRow)
        .filter(Boolean)
        .reduce((acc, { timestamp, totalExpense, taxAndFee }) => {
            acc[timestamp] = (acc[timestamp] || 0) + taxAndFee;
            return acc;
        }, {});

    const taxAndFees = Object.entries(taxAndFeeByTimestamp).map(([timestamp, taxAndFee]) => [
        parseInt(timestamp),
        taxAndFee,
    ]);

    const totalTaxAndFees = taxAndFees.reduce((sum, [, taxAndFee]) => sum + taxAndFee, 0);
    let currentTotalTaxAndFees = totalTaxAndFees;

    const taxAndFeeData = taxAndFees.map(([timestamp, taxAndFee], i) => {
        if (i !== 0) {
            currentTotalTaxAndFees -= taxAndFees[i - 1][1];
        }
        return { x: timestamp, y: Math.round(currentTotalTaxAndFees) };
    });

    const performanceChart = Highcharts.charts[0];
    const getExpenseAtTime = (timestamp) => expenseData.find(({ x }) => x <= timestamp)?.y || 0;
    const getTaxAndFeeAtTime = (timestamp) => taxAndFeeData.find(({ x }) => x <= timestamp)?.y || 0;

    /*---------- MANUAL ADJUSTMENTS ----------*/
    const totalAdjustment = MANUAL_ADJUSTMENTS.reduce((sum, { adjustment }) => sum + adjustment, 0);

    function applyManualAdjustments(from, to) {
        const adjustments = MANUAL_ADJUSTMENTS.filter(({ date }) => {
            const convertedDate = getTimestampFromDate(date);
            return (from === undefined || from <= convertedDate) && (to === undefined || convertedDate <= to);
        });

        adjustments.forEach(({ date, adjustment }) => {
            const timestamp = getTimestampFromDate(date);
            const futureDataPoints = performanceChart.series[0].data.filter(({ x }) => x >= timestamp);
            futureDataPoints.forEach((data) => {
                const baseExpenseAtTime = getExpenseAtTime(data.x) - totalTaxAndFees;
                const actualValue = (baseExpenseAtTime / 100) * (100 + data.y) + adjustment;
                const percentage = ((actualValue - baseExpenseAtTime) / baseExpenseAtTime) * 100;
                data.update({ y: percentage });
            });

            // Mark manual adjustment data point.
            futureDataPoints[0]?.update({
                marker: { enabled: true, fillColor: "#ff6718", radius: 5 },
            });
        });
    }

    applyManualAdjustments();

    /*---------- UI VALUE UPDATES ----------*/
    function updateUI() {
        const totalValueElement = document.querySelector(".val.v-ellip");
        const totalValueParts = totalValueElement.textContent.split(" ");
        const useComma = totalValueParts[1].charAt(totalValueParts[1].length - 3) === ",";
        let totalValue = parseFloat(
            totalValueParts[1].replace(useComma ? /\./g : /,/g, "").replace(useComma ? /,/g : /\./g, ".")
        );
        totalValue += totalAdjustment;
        totalValueElement.textContent = `${totalValueParts[0]} ${formatNumber(totalValue, useComma)}`;

        const revenueElement = document.querySelector(".val2.green") || document.querySelector(".val2.red");
        let revenueValue = parseFloat(
            revenueElement.textContent
                .replace(/[+\-]/g, "")
                .replace(useComma ? /\./g : /,/g, "")
                .replace(useComma ? /,/g : /\./g, ".")
        );
        revenueValue += totalAdjustment;
        revenueElement.textContent = `${revenueValue > 0 ? "+" : ""}${formatNumber(revenueValue, useComma)}`;
        revenueElement.className = revenueValue > 0 ? "val2 green" : "val2 red";

        const percentageElement = document.querySelector(".val.green") || document.querySelector(".val.red");
        const percentageValue = performanceChart.series[0].data.at(-1).y;
        percentageElement.textContent = `${percentageValue > 0 ? "+" : ""}${formatNumber(percentageValue, useComma)}%`;
        percentageElement.className = percentageValue > 0 ? "val green" : "val red";
    }

    updateUI();

    /*---------- REVENUE DATA CONSTRUCTION ----------*/
    function findAdjustment(x) {
        return MANUAL_ADJUSTMENTS.find((e) => getTimestampFromDate(e.date) === x);
    }

    function createRevenuePoint(x, y, isAdjusted = false) {
        return {
            x,
            y,
            ...(isAdjusted && {
                marker: { enabled: true, fillColor: "#ff6718", radius: 5 },
            }),
        };
    }

    const revenueData = performanceChart.series[0].data.map(({ x, y }) => {
        const baseExpense = getExpenseAtTime(x) - getTaxAndFeeAtTime(x);
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

    function renderChart(from, to, isInitial = false) {
        if (!isInitial) {
            // Delay adjustments to ensure the chart is updated.
            setTimeout(() => applyManualAdjustments(from, to), ADJUSTMENT_DELAY);
        }

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
                        {
                            useGrouping: true,
                            minimumFractionDigits: 0,
                            maximumFractionDigits: 0,
                        }
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

    renderChart(startDateTimestamp, initialMaxDate, true);

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
