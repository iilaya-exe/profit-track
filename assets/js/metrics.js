/* Port of Metrics.php — the workbook's Dashboard + Support sheets.

   The Support sheet derived four helper columns per journal row; decorate() does
   the same, and every figure below is the same SUMIFS the Dashboard used, so the
   numbers reconcile cell-for-cell with the spreadsheet. */
const Metrics = (() => {
  // Account codes the Dashboard singles out.
  const ACCT_REVENUE = '41010101';   // Dashboard I9
  const ACCT_INVENTORY = '11040401'; // Dashboard I11
  const ACCT_RETENTION = '11030300'; // Dashboard F12
  const ACCT_ADVANCES = '21090103';  // Dashboard F13

  // Cost categories broken out on the Dashboard (B37:B41); the rest fall into "All Other Costs".
  const CATEGORIES = [
    ['CONTRACTED SERVICES', 'Contracted Services'],
    ['DIRECT MATERIALS', 'Direct Materials'],
    ['SUBCONTRACTORS', 'Subcontractors'],
    ['NON CONSUMABLE SUPPLIES', 'Non Consumable Supplies'],
    ['SALARY & WAGES-ABI', 'Salary & Wages-Abi'],
  ];

  const MONTHS = 12; // Dashboard rows 22:33
  const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

  /** @param {Array} rows @param {(r)=>boolean} where */
  function sum(rows, where) {
    let total = 0;
    for (const row of rows) if (where(row)) total += row.amount;
    return total;
  }

  /** SAP exports the journal date as MM.DD.YY; Support!A2 rebuilt it the same way. */
  function parseDate(value) {
    value = String(value ?? '').trim();
    let m;
    if ((m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(value))) {
      return `20${m[3]}-${m[1]}-${m[2]}`;
    }
    if ((m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value))) {
      return `${m[1]}-${m[2]}-${m[3]}`;
    }
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value))) {
      const pad = (n) => String(n).padStart(2, '0');
      return `${m[3]}-${pad(m[1])}-${pad(m[2])}`;
    }
    return null;
  }

  /** Add the four Support-sheet helper columns to every row. */
  function decorate(rows) {
    return (rows || []).map((src) => {
      const row = { ...src };
      const acct = String(row.acctCode ?? '');
      const date = parseDate(String(row.txDate ?? ''));
      row.amount = num(row.amount);
      row.acctCode = acct;
      row.acctFirst = acct === '' ? '' : acct.slice(0, 1);              // Support!A helper
      row.date = date;                                                  // Support!A
      row.monthStart = date === null ? null : date.slice(0, 7) + '-01'; // Support!B
      row.isCashBank = String(row.bpName ?? '').toUpperCase().includes('CASH IN BANK'); // Support!D
      return row;
    });
  }

  function params(project) {
    const p = (project && typeof project.params === 'object' && project.params) || {};
    const margin = p.projectedMargin !== undefined ? num(p.projectedMargin) : 0.20;
    return {
      projectedMargin: margin,
      minMargin: p.minMargin !== undefined ? num(p.minMargin) : margin,
      minCashPctOfGP: p.minCashPctOfGP !== undefined ? num(p.minCashPctOfGP) : margin,
    };
  }

  // Month arithmetic over 'YYYY-MM-01' strings, matching PHP's DateTimeImmutable.
  function addMonths(monthStart, n) {
    const [y, m] = monthStart.split('-').map(Number);
    const total = (y * 12 + (m - 1)) + n;
    const year = Math.floor(total / 12);
    const month = (total % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}-01`;
  }
  function monthLabel(monthStart) {
    const [y, m] = monthStart.split('-').map(Number);
    return `${SHORT_MONTHS[m - 1]} ${y}`;
  }

  /** Dashboard rows 22:34 — twelve months from the first journal month. */
  function monthly(rows) {
    let first = null;
    for (const r of rows) {
      if (r.monthStart !== null && (first === null || r.monthStart < first)) first = r.monthStart;
    }
    if (first === null) {
      return { rows: [], total: { cost: 0, cashIn: 0, cashOut: 0, net: 0, cumulative: 0 } };
    }

    const months = [];
    for (let i = 0; i < MONTHS; i++) months.push(addMonths(first, i));

    const out = [];
    let cumulative = 0;
    const total = { cost: 0, cashIn: 0, cashOut: 0, net: 0 };
    for (const month of months) {
      const inMonth = (r) => r.monthStart === month;
      const cost = sum(rows, (r) => inMonth(r) && r.acctFirst === '5' && r.group === 'Accounting');
      const cashIn = sum(rows, (r) => inMonth(r) && r.isCashBank && r.amount > 0);
      const cashOut = -sum(rows, (r) => inMonth(r) && r.isCashBank && r.amount < 0);
      const net = cashIn - cashOut;
      cumulative += net;
      total.cost += cost;
      total.cashIn += cashIn;
      total.cashOut += cashOut;
      total.net += net;
      out.push({ month, label: monthLabel(month), cost, cashIn, cashOut, net, cumulative });
    }
    total.cumulative = cumulative;
    return { rows: out, total };
  }

  /** Dashboard rows 37:43 — cost charged to P&L, by category. */
  function categories(rows, costToPL) {
    const out = [];
    let named = 0;
    for (const [account, label] of CATEGORIES) {
      const value = sum(rows, (r) => String(r.bpName).toUpperCase() === account
        && r.acctFirst === '5' && r.group === 'Accounting');
      named += value;
      out.push({ label, value });
    }
    // Dashboard C42: the residual, so the parts always add back to total P&L cost.
    out.push({ label: 'All Other Costs', value: costToPL - named });
    return { rows: out, total: costToPL };
  }

  /** Purchase-order value by vendor — what drives Est. Cost at Completion. */
  function vendors(rows) {
    const byVendor = {};
    for (const r of rows) {
      if (r.type !== 'Purchase Order' || r.status === 'Canceled') continue;
      const name = String(r.bpName);
      const v = byVendor[name] ??= { label: name, value: 0, open: 0, lines: 0 };
      v.value += r.amount;
      v.lines++;
      if (r.status === 'Open') v.open += r.amount;
    }
    return Object.values(byVendor).sort((a, b) => b.value - a.value).slice(0, 8);
  }

  /** Journal composition — row counts by transaction type and document status. */
  function mix(rows) {
    const types = {};
    const statuses = {};
    for (const r of rows) {
      const type = String(r.type);
      const t = types[type] ??= { label: type, count: 0, amount: 0 };
      t.count++;
      t.amount += r.amount;
      const status = String(r.status);
      const s = statuses[status] ??= { label: status, count: 0 };
      s.count++;
    }
    return {
      types: Object.values(types).sort((a, b) => b.count - a.count),
      statuses: Object.values(statuses).sort((a, b) => b.count - a.count),
    };
  }

  /** Dashboard B1:B2 — the title band. */
  function meta(project, rows) {
    let client = '';
    for (const r of rows) {
      if (r.type === 'Sales Order') { client = String(r.bpName); break; }
    }
    if (client === '' && rows.length) client = String(rows[0].bpName);

    const dates = rows.map((r) => r.date).filter(Boolean).sort();

    return {
      id: String(project.id ?? ''),
      code: String(project.code ?? ''),
      name: String(project.name ?? ''),
      client,
      source: String(project.source ?? ''),
      importedAt: String(project.importedAt ?? ''),
      logo: String(project.logo ?? ''), // empty means "no icon set" — card draws its monogram
      rowCount: rows.length,
      firstDate: dates[0] ?? null,
      lastDate: dates.length ? dates[dates.length - 1] : null,
    };
  }

  function compute(project) {
    const rows = decorate(project.rows || []);
    const p = params(project);
    const m = p.projectedMargin;

    // --- Contract & target (Dashboard C9:C12) ---
    const tcv = sum(rows, (r) => r.type === 'Sales Order' && r.status !== 'Canceled')
      - sum(rows, (r) => r.type === 'Sales Order' && r.status !== 'Canceled'
          && String(r.description).toUpperCase().includes('DOWN PAYMENT'));
    const projectedCostBudget = tcv * (1 - m);
    const projectedGrossProfit = tcv * m;

    // --- Cash flow to date (Dashboard F9:F13) ---
    const cashIn = sum(rows, (r) => r.isCashBank && r.amount > 0);
    const cashOut = -sum(rows, (r) => r.isCashBank && r.amount < 0);
    const netCash = cashIn - cashOut;
    const retention = sum(rows, (r) => r.acctCode === ACCT_RETENTION && r.group === 'Accounting');
    const advances = -sum(rows, (r) => r.acctCode === ACCT_ADVANCES && r.group === 'Accounting');

    // --- Profitability, true-cost view (Dashboard I9:I18) ---
    const revenue = -sum(rows, (r) => r.acctCode === ACCT_REVENUE && r.group === 'Accounting');
    const costToPL = sum(rows, (r) => r.acctFirst === '5' && r.group === 'Accounting');
    const inventory = sum(rows, (r) => r.acctCode === ACCT_INVENTORY && r.group === 'Accounting');
    const posIssued = sum(rows, (r) => r.type === 'Purchase Order' && r.status !== 'Canceled');
    const posOpen = sum(rows, (r) => r.type === 'Purchase Order' && r.status === 'Open');
    const nonPoCost = sum(rows, (r) => r.acctFirst === '5' && r.type === 'Manual Journal Entry');

    const estCostAtCompletion = posIssued + nonPoCost;
    const estGrossProfit = tcv - estCostAtCompletion;
    const estMargin = tcv !== 0 ? estGrossProfit / tcv : 0;
    const pctBilled = tcv !== 0 ? revenue / tcv : 0;
    const requiredNetCash = p.minCashPctOfGP * projectedGrossProfit;

    return {
      meta: meta(project, rows),
      params: p,
      headline: {
        marginAtCompletion: {
          value: estMargin,
          threshold: p.minMargin,
          pass: estMargin >= p.minMargin,
        },
        netCashFlow: {
          value: netCash,
          threshold: requiredNetCash,
          pass: netCash >= requiredNetCash,
          pctOfGP: p.minCashPctOfGP,
        },
        pctBilled: { value: pctBilled, revenue, tcv },
      },
      contract: {
        tcv,
        projectedMargin: m,
        projectedCostBudget,
        projectedGrossProfit,
      },
      cashFlow: {
        cashIn, cashOut, netCash, retention, advances, required: requiredNetCash,
      },
      profit: {
        revenue, costToPL, inventory, posIssued, posOpen, nonPoCost,
        estCostAtCompletion, estGrossProfit, estMargin,
        marginVariance: estMargin - m,
      },
      monthly: monthly(rows),
      categories: categories(rows, costToPL),
      vendors: vendors(rows),
      mix: mix(rows),
    };
  }

  /** Headline-only view for the overview grid — same numbers, less payload. */
  function summary(project) {
    const full = compute(project);
    return {
      meta: full.meta,
      headline: full.headline,
      contract: full.contract,
      cashFlow: full.cashFlow,
      profit: {
        revenue: full.profit.revenue,
        costToPL: full.profit.costToPL,
        inventory: full.profit.inventory,
        posIssued: full.profit.posIssued,
        posOpen: full.profit.posOpen,
        nonPoCost: full.profit.nonPoCost,
        estCostAtCompletion: full.profit.estCostAtCompletion,
        estGrossProfit: full.profit.estGrossProfit,
        estMargin: full.profit.estMargin,
        marginVariance: full.profit.marginVariance,
      },
      spark: full.monthly.rows.map((mo) => mo.cumulative),
    };
  }

  return { compute, summary, decorate, parseDate };
})();
