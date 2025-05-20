// ==UserScript==
// @name         JustEtf Investment Expense/Revenue Graph
// @version      1.10
// @description  Displays an investment expense vs revenue graph on justETF
// @match        https://www.justetf.com/*/dashboard-activity.html?portfolioId=*
// @author       fl3xm3ist3r
// @namespace    https://github.com/fl3xm3ist3r
// @grant        none
// ==/UserScript==

(async function() {
    'use strict';

    /* CONFIG */
    const TRADING_TYPES = {
        DEPOSIT: "Einlieferung",
        WITHDRAWAL: "Auslieferung",
        BUY: "Kauf",
        SELL: "Verkauf"
    };
    const DATE_RANGE_UPDATE_INTERVAL = 5000;
    const DEFAULT_START_DATE = null;

    /* UTILITIES */
    function dateToTimestamp(dateString) {
        const [d, m, y] = dateString.split(/[\.\/]/).map(Number);
        const year = y < 100 ? 2000 + y : y;
        return Date.UTC(year, m - 1, d);
    }

    async function fetchPage(url) {
        const res = await fetch(url);
        const html = await res.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    function parseTransactionRow(row) {
        const type = row.querySelector('td')?.textContent.trim();
        if (!Object.values(TRADING_TYPES).includes(type)) return null;

        const dateText = row.querySelector('td.tal-center')?.textContent.trim();
        const timestamp = dateToTimestamp(dateText);

        const cols = Array.from(
            row.querySelectorAll('td.tal-right.column-priority-3.ws, td.tal-right.visible-lg')
        ).map(cell => parseFloat(cell.textContent.replace(/\./g,'').replace(',', '.')));
        const [count, expense, fee, tax] = cols;

        return { timestamp, totalExpense: (expense * -1) + fee + tax, expenseWithoutTaxAndFee: (expense * -1) };
    }

    async function getAllTransactions(portfolioId) {
        const baseUrl = `https://www.justetf.com/de/transactions.html?portfolioId=${portfolioId}`;
        const doc = await fetchPage(baseUrl);
        const rows = Array.from(doc.querySelectorAll('table.table-hover tbody tr'));

        const links = Array.from(doc.querySelectorAll('.pagination li a')).slice(3, -2).map(a => a.href);
        for (const url of links) {
            const page = await fetchPage(url);
            rows.push(...page.querySelectorAll('table.table-hover tbody tr'));
        }

        return rows.map(parseTransactionRow).filter(Boolean);
    }

    function aggregateByTimestamp(items, key) {
        return items.reduce((map, item) => {
            map.set(item.timestamp, (map.get(item.timestamp) || 0) + item[key]);
            return map;
        }, new Map());
    }

    function buildCumulativeSeries(map) {
        const entries = Array.from(map.entries()).sort((a, b) => b[0] - a[0]);
        let running = entries.reduce((sum, [, v]) => sum + v, 0);
        return entries.map(([x, v]) => {
            const y = Math.round(running);
            running -= v;
            return { x, y: Math.abs(y) };
        });
    }

    /* LOAD MAIN DATA */
    const portfolioId = new URLSearchParams(window.location.search).get('portfolioId');
    const tx = await getAllTransactions(portfolioId);

    const expMap = aggregateByTimestamp(tx, 'totalExpense');
    const expWithoutFeeMap = aggregateByTimestamp(tx, 'expenseWithoutTaxAndFee');

    const expenseData = buildCumulativeSeries(expMap);
    const expenseWithoutTaxData = buildCumulativeSeries(expWithoutFeeMap);

    function getExpenseAtTime(ts) {
        const p = expenseData.find(pt => pt.x <= ts);
        return p ? p.y : 0;
    }
    function getExpenseWithoutFeeAtTime(ts) {
        const p = expenseWithoutTaxData.find(pt => pt.x <= ts);
        return p ? p.y : 0;
    }

    /* CAPTURE ORIGINAL PERFORMANCE CHART DATA */
    const perfChart = Highcharts.charts[0];
    const highchartData = perfChart.series[0].data.map(({ x, y, marker }) => ({ x, y, marker }));

    /* CALCULATE REVENUE DATA */
    let revenueData = perfChart.series[0].data.map(({ x, y: pct }) => {
        const base = getExpenseWithoutFeeAtTime(x);
        return { x, y: Math.round(base + (base * pct / 100)) };
    });

    /* INSERT EXPENSE POINTS TO CREATE NATURAL REVENUE GRAPH */
    expenseData.slice(0, -1).forEach(({ x, y }, i) => {
        const nextExpense = expenseData[i + 1].y;
        const idx = revenueData.findIndex(d => d.x === x);
        if (idx !== -1) {
            const adjustedRevenue = revenueData[idx].y - (y - nextExpense);
            revenueData.splice(idx, 0, { x, y: adjustedRevenue });
        }
    });

    /* SETUP CONTAINER */
    const container = document.createElement('div');
    container.id = 'expense-revenue-chart';
    container.style.width = '100%';
    document.querySelector('.chartarea').appendChild(container);

    /* RENDER CHART WITH MEMOIZATION & BOUNDARIES */
    function renderChart(from, to) {
        // update original performance chart
        const tmpHighChart = Highcharts.charts[0];
        const filteredHighchartData = highchartData.filter(({ x }) => x >= from && x <= to);
        tmpHighChart.series[0].setData(filteredHighchartData, true);

        // expense data with start/end points
        const baseExpense = expenseData.filter(p => p.x >= from && p.x <= to);
        const filteredExpense = [...baseExpense];
        filteredExpense.unshift({ x: to, y: getExpenseAtTime(to) });
        filteredExpense.push({ x: from, y: getExpenseAtTime(from) });

        // revenue series with inserted expense points
        const filteredRevenue = revenueData.filter(p => p.x >= from && p.x <= to);

        Highcharts.chart('expense-revenue-chart', {
            chart: { type: 'scatter' },
            title: { text: 'Expense vs Revenue' },
            xAxis: { type: 'datetime', gridLineWidth: 1 },
            yAxis: { gridLineWidth: 1 },
            tooltip: {
                formatter() {
                    return `${Highcharts.dateFormat('%d.%m.%Y', this.x)}<br>` +
                        `<span style="color:${this.color}">●</span> ${this.series.name}: <b>${new Intl.NumberFormat('en-US',{useGrouping:true,minimumFractionDigits:0,maximumFractionDigits:0}).format(this.y).replace(/,/g, "'")}</b>`;
                }, shared:false,useHTML:true
            },
            series: [
                { name:'Expense', data:filteredExpense, lineWidth:2, color:'#D32F2F', marker:{enabled:true,radius:2,fillColor:'#6e0000'}, step:'right' },
                { name:'Revenue', data:filteredRevenue, lineWidth:2, color:'#008080', marker:{enabled:false} }
            ]
        });
    }

    /* DATE RANGE HANDLING */
    function getDateRange() {
        const [f, t] = document.getElementById('daterangepicker').querySelector('span').textContent.split(' - ');
        return [dateToTimestamp(f), dateToTimestamp(t)];
    }

    let [minD, maxD] = getDateRange();
    const startD = DEFAULT_START_DATE ? dateToTimestamp(DEFAULT_START_DATE) : minD;
    renderChart(startD, maxD);

    setInterval(() => {
        const [newMin, newMax] = getDateRange();
        if (newMin !== minD || newMax !== maxD) {
            minD = newMin; 
            maxD = newMax;
            renderChart(minD, maxD);
        }
    }, DATE_RANGE_UPDATE_INTERVAL);
})();
