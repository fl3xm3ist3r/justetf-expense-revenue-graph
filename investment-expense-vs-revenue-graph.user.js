// ==UserScript==
// @name         JustEtf Investment Expense/Revenue Graph
// @version      1.4
// @description  This script calculates and displays a graph that shows your expenses against your revenue
// @match        https://www.justetf.com/*/dashboard-activity.html?portfolioId=*
// @author       Fl3xm3ist3r
// @namespace    https://github.com/fl3xm3ist3r
// ==/UserScript==

/*---------- SCRIPT INFO ----------*/
// This script generates a dynamic expense vs revenue graph for investment tracking on justETF.
// It is a quick and dirty solution intended for personal use or as a starting point for customization.
// If you encounter issues or have suggestions for improvement, please contribute to the GitHub repository.
// This script is not affiliated with or endorsed by JustETF. It is provided "as is" without any warranty.
// This script is provided for personal use only. It relies on data from JustETF, which remains the property of its respective owners.
// Ensure compliance with JustETF's terms of service when using this script.
//
// Licensed under the MIT License - https://opensource.org/licenses/MIT

/*---------- CONFIGURATION ----------*/
//example: "dd.mm.yyyy" or "dd/mm/yyyy" (null for default)
const defaultStartDate = null;

//example: {date: "dd.mm.yyyy" or "dd/mm/yyyy", adjustment: 1000} ([] for default)
const manualAdjustments = [];

(async function () {
    ("use strict");

    /*---------- UTILITIES ----------*/
    const performanceChart = Highcharts.charts[0];

    const dateToTimestamp = (dateString) => {
        const [day, month, year] = dateString.split(".").map(Number);
        return Date.UTC(2000 + year, month - 1, day);
    };

    const convertDateFormat = (date) => {
        const [day, month, year] = date.split(/[./]/);
        return `${day}.${month}.${year.slice(-2)}`;
    };

    const getExpenseAtTime = (timestamp) => expenseData.find(({ x }) => x <= timestamp)?.y || 0;

    /*---------- DATA FETCHING ----------*/
    const portfolioId = new URLSearchParams(window.location.search).get("portfolioId");

    const fetchTransactionData = async (id) => {
        const response = await fetch(`https://www.justetf.com/de/transactions.html?portfolioId=${id}`);
        const parser = new DOMParser();
        return parser.parseFromString(await response.text(), "text/html");
    };

    /*---------- EXPENSE DATA ----------*/
    const parseRowData = (row) => {
        const timestamp = dateToTimestamp(row.querySelector("td.tal-center").textContent.trim());
        const parseCurrency = (selector, index, isExpense = false) => {
            const value = row.querySelectorAll(selector)[index].textContent.trim();
            return parseFloat(
                `${isExpense && !value.includes("-") ? "-" : ""}` +
                    value.replace(".", "").replace(",", ".").replace("-", "")
            );
        };

        const type = row.querySelector("td").textContent.trim();
        if (!["Einlieferung", "Auslieferung", "Kauf", "Verkauf"].includes(type)) return;

        const expense = parseCurrency("td.tal-right.column-priority-3.ws", 1, true);
        const fees = parseCurrency("td.tal-right.visible-lg", 0);
        const tax = parseCurrency("td.tal-right.visible-lg", 1);

        return { timestamp, totalExpense: expense + fees + tax };
    };

    const documentData = await fetchTransactionData(portfolioId);
    const tableRows = documentData.querySelectorAll("table.table-hover tbody tr");

    const expensesByTimestamp = Array.from(tableRows)
        .map(parseRowData)
        .filter(Boolean)
        .reduce((acc, { timestamp, totalExpense }) => {
            acc[timestamp] = (acc[timestamp] || 0) + totalExpense;
            return acc;
        }, {});

    const sortedExpenses = Object.entries(expensesByTimestamp)
        .map(([timestamp, totalExpense]) => [parseInt(timestamp), totalExpense])
        .sort((a, b) => a.x - b.x);

    const totalExpenses = sortedExpenses.reduce((sum, [, expense]) => sum + expense, 0);
    let currentTotalExpenses = totalExpenses;

    const expenseData = sortedExpenses.map(([timestamp, expense], i) => {
        if (i !== 0) currentTotalExpenses -= sortedExpenses[i - 1][1];
        return { x: timestamp, y: Math.round(currentTotalExpenses) };
    });

    /*---------- ADJUSTMENTS ----------*/
    const formatNumber = (number, useComma) => {
        const locale = useComma ? "de-DE" : "en-US";
        return number.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    };

    const makeManualAdjustments = (from, to) => {
        let totalAdjustment = 0;

        var filtered = manualAdjustments.filter(({ date }) => {
            const convertedDate = dateToTimestamp(convertDateFormat(date));
            return (from === undefined || from <= convertedDate) && (to === undefined || convertedDate <= to);
        });

        filtered.forEach(({ date, adjustment }) => {
            totalAdjustment += adjustment;

            /* PERFORMANCE CHART ADJUSTMENTS */
            const timestamp = dateToTimestamp(convertDateFormat(date));
            const futureDataPoints = performanceChart.series[0].data.filter(({ x }) => x >= timestamp);
            futureDataPoints.forEach((data) => {
                const expenseAtTime = getExpenseAtTime(data.x);
                const actualValue = (expenseAtTime / 100) * (100 + data.y) + adjustment;
                const percentage = ((actualValue - expenseAtTime) / expenseAtTime) * 100;
                data.update({ y: percentage });
            });

            /* MARKER ON ADJUSTMENTS */
            futureDataPoints[0]?.update({
                marker: { enabled: true, fillColor: "#ff6718", radius: 5 },
            });
        });

        return totalAdjustment;
    };

    const totalAdjustment = makeManualAdjustments();

    /* TOTAL VALUE ADJUSTMENT */
    const totalValueElement = document.querySelector(".val.v-ellip");
    const totalValueContent = totalValueElement.textContent.split(" ");

    const useComma = totalValueContent[1].charAt(totalValueContent[1].length - 3) === ",";

    let totalValue = parseFloat(
        totalValueContent[1].replace(useComma ? /\./g : /,/g, "").replace(useComma ? /,/g : /\./g, ".")
    );
    totalValue += totalAdjustment;
    totalValueElement.textContent = `${totalValueContent[0]} ${formatNumber(totalValue, useComma)}`;

    /* REVENUE VALUE ADJUSTMENT */
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

    /* PERCENTAGE ADJUSTMENT */
    const percentageElement = document.querySelector(".val.green") || document.querySelector(".val.red");
    const percentageValue = performanceChart.series[0].data.at(-1).y;
    percentageElement.textContent = `${percentageValue > 0 ? "+" : ""}${formatNumber(percentageValue, useComma)}%`;
    percentageElement.className = percentageValue > 0 ? "val green" : "val red";

    /*---------- REVENUE DATA ----------*/
    const findAdjustment = (x) => manualAdjustments.find((e) => dateToTimestamp(convertDateFormat(e.date)) === x);

    const createRevenuePoint = (x, y, isAdjusted = false) => ({
        x,
        y,
        ...(isAdjusted && {
            marker: {
                enabled: true,
                fillColor: "#ff6718",
                radius: 5,
            },
        }),
    });

    const revenueData = performanceChart.series[0].data.map(({ x, y }) => {
        const baseExpense = getExpenseAtTime(x);
        const adjustment = findAdjustment(x);
        const isAdjusted = adjustment && !expenseData.some((data) => data.x === x);

        return createRevenuePoint(x, (baseExpense / 100) * (100 + y), isAdjusted);
    });

    /* ADD EXPENSE POINTS FOR NATURAL REVENUE GRAPH */
    expenseData.slice(0, -1).forEach(({ x, y }, i) => {
        const nextExpense = expenseData[i + 1].y;

        const index = revenueData.findIndex((data) => data.x === x);
        if (index !== -1) {
            const updatedRevenue = revenueData[index].y - (y - nextExpense);
            const adjustment = findAdjustment(x);

            revenueData.splice(index, 0, createRevenuePoint(x, updatedRevenue, !!adjustment));
        }
    });

    /*---------- GRAPH RENDERING ----------*/
    const chartContainer = document.createElement("div");
    chartContainer.id = "expense-revenue-chart";
    chartContainer.style.width = "100%";
    document.querySelector(".chartarea").appendChild(chartContainer);

    const renderChart = (from, to, isInitial = false) => {
        if (!isInitial) {
            setTimeout(makeManualAdjustments(from, to), 500);
        }

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
                    return `${Highcharts.dateFormat("%d.%m.%Y", this.x)}<br><span style="color: ${
                        this.color
                    }">●</span> ${this.series.name}: <b>${new Intl.NumberFormat("en-US", {
                        useGrouping: true,
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                    })
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
    };

    /*---------- DATE RANGE HANDLING ----------*/
    const getDateRange = () => {
        const [fromDate, toDate] = document
            .getElementById("daterangepicker")
            .querySelector("span")
            .textContent.trim()
            .split(" - ");
        return [dateToTimestamp(convertDateFormat(fromDate)), dateToTimestamp(convertDateFormat(toDate))];
    };

    /*---------- INITIALIZATION ----------*/
    let [initialMinDate, initialMaxDate] = getDateRange();
    if (defaultStartDate) {
        renderChart(dateToTimestamp(convertDateFormat(defaultStartDate)), initialMaxDate, true);
    } else {
        renderChart(initialMinDate, initialMaxDate, true);
    }

    /* DATE RANGE UPDATE CHECK */
    const dateRangeUpdateCheck = () => {
        const [minDate, maxDate] = getDateRange();
        if (minDate !== initialMinDate || maxDate !== initialMaxDate) {
            initialMinDate = minDate;
            initialMaxDate = maxDate;
            renderChart(minDate, maxDate);
        }
        setTimeout(dateRangeUpdateCheck, 5000);
    };

    dateRangeUpdateCheck();
})();
