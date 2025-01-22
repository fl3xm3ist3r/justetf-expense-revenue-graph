// ==UserScript==
// @name         JustEtf Investment Expense/Revenue Graph
// @version      1.3.1
// @description  This script calculates and displays a graph that shows your expenses against your revenue
// @match        https://www.justetf.com/*/dashboard-activity.html?portfolioId=*
// ==/UserScript==

/*---------- DISCMAILER ----------*/
// This script generates a dynamic expense vs revenue graph for investment tracking on justETF.
// It is a quick and dirty solution intended for personal use or as a starting point for customization.
// If you encounter issues or have suggestions for improvement, please contribute to the GitHub repository.
// This script is not affiliated with or endorsed by JustETF. It is provided "as is" without any warranty.
// This script is provided for personal use only. It relies on data from JustETF, which remains the property of its respective owners.
// Ensure compliance with JustETF's terms of service when using this script.
// License: MIT

/*---------- Settings ----------*/
const defaultStartDate = null; //ex: "10.10.2024" or "10/10/2024" (Format: "dd.mm.yyyy" or "dd/mm/yyyy")

(async function () {
    ("use strict");

    /*---------- General ----------*/
    const performanceChart = Highcharts.charts[0];

    function dateToTimestamp(dateString) {
        const [day, month, year] = dateString.split(".").map(Number);

        return Date.UTC(2000 + year, month - 1, day);
    }

    /*---------- Expense Data ----------*/
    const portfolioId = new URLSearchParams(window.location.search).get("portfolioId");

    const fetchTransactionData = async (portfolioId) => {
        const response = await fetch(`https://www.justetf.com/de/transactions.html?portfolioId=${portfolioId}`);
        const parser = new DOMParser();

        return parser.parseFromString(await response.text(), "text/html");
    };

    const parseRowData = (row) => {
        const timestamp = dateToTimestamp(row.querySelector("td.tal-center")?.textContent.trim());

        const parseCurrency = (selector, index, isExpense = false) => {
            var selectedValue = row.querySelectorAll(selector)[index]?.textContent.trim();

            return parseFloat(
                `${isExpense && !selectedValue.includes("-") ? "-" : ""}` +
                    selectedValue.replace(".", "").replace(",", ".").replace("-", "") || 0
            );
        };

        const type = row.querySelector("td")?.textContent.trim();

        if (type !== "Einlieferung" && type !== "Auslieferung" && type !== "Kauf" && type !== "Verkauf") {
            return;
        }

        const expense = parseCurrency("td.tal-right.column-priority-3.ws", 1, true);
        const fees = parseCurrency("td.tal-right.visible-lg", 0);
        const tax = parseCurrency("td.tal-right.visible-lg", 1);

        return { timestamp, totalExpense: expense + fees + tax };
    };

    const documentData = await fetchTransactionData(portfolioId);
    const tableRows = documentData.querySelectorAll("table.table-hover tbody tr");

    var expensesByTimestamp = Array.from(tableRows)
        .map(parseRowData)
        .filter(Boolean)
        .reduce((acc, { timestamp, totalExpense }) => {
            acc[timestamp] = (acc[timestamp] || 0) + totalExpense;
            return acc;
        }, {});

    var sortedExpenses = Object.entries(expensesByTimestamp)
        .map(([timestamp, totalExpense]) => [parseInt(timestamp), totalExpense])
        .sort((a, b) => a.x - b.x);

    const totalExpenses = sortedExpenses.reduce((sum, [, expense]) => sum + expense, 0);
    let currentTotalExpenses = totalExpenses;

    var expenseData = [];
    for (let i = 0; i < sortedExpenses.length; i++) {
        if (i !== 0) {
            currentTotalExpenses -= sortedExpenses[i - 1][1];
        }
        expenseData.push({
            x: sortedExpenses[i][0],
            y: Math.round(currentTotalExpenses),
        });
    }

    /*---------- Revenue Data ----------*/
    const getExpenseAtTime = (timestamp) => {
        return expenseData.find(({ x }) => x <= timestamp)?.y || 0;
    };

    const revenueData = performanceChart.series[0].data.map(({ x, y }) => {
        const baseExpense = getExpenseAtTime(x);

        return { x, y: (baseExpense / 100) * (100 + y) };
    });

    // add new point to revenue graph when money was invested so graph is more "natural"
    expenseData.slice(0, -1).forEach(({ x, y }, i) => {
        const nextExpense = expenseData[i + 1].y;
        const index = revenueData.findIndex((data) => data.x === x);
        if (index !== -1) {
            const updatedRevenue = revenueData[index].y - (y - nextExpense);
            revenueData.splice(index, 0, { x, y: updatedRevenue });
        }
    });

    /*---------- Display Graph ----------*/
    const chartContainer = document.createElement("div");
    chartContainer.id = "expense-revenue-chart";
    chartContainer.style.width = "100%";
    document.querySelector(".chartarea").appendChild(chartContainer);

    const renderChart = (from, to) => {
        var filteredExpenseData = expenseData.filter(({ x }) => x >= from && x <= to);
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

    /*---------- Date Range ----------*/
    function convertDateFormat(date) {
        const parts = date.split(/[./]/);
        return `${parts[0]}.${parts[1]}.${parts[2].slice(-2)}`;
    }

    function getDateRange() {
        dateRangePicker = document.getElementById("daterangepicker");
        const span = dateRangePicker.querySelector("span");
        const [fromDate, toDate] = span.textContent.trim().split(" - ");
        const minDate = dateToTimestamp(convertDateFormat(fromDate));
        const maxDate = dateToTimestamp(convertDateFormat(toDate));

        return [minDate, maxDate];
    }

    // Initial render
    var [initialMinDate, initialMaxDate] = getDateRange();
    if (defaultStartDate != null) {
        renderChart(dateToTimestamp(convertDateFormat(defaultStartDate)), initialMaxDate);
    } else {
        renderChart(initialMinDate, initialMaxDate);
    }

    // Check Range Update Loop
    function dateRangeUpdateCheck() {
        const [minDate, maxDate] = getDateRange();
        if (minDate != initialMinDate || maxDate != initialMaxDate) {
            initialMinDate = minDate;
            initialMaxDate = maxDate;
            renderChart(minDate, maxDate);
        }

        setTimeout(dateRangeUpdateCheck, 5000);
    }

    dateRangeUpdateCheck();
})();
