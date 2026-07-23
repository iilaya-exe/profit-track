/* Port of Traces.php — drill-down definitions. For each figure on the dashboard,
   the exact journal rows it was computed from. Each predicate below is the twin of
   a SUMIFS in Metrics, so a drill-down cannot drift from the number that launched
   it — there is one definition, not two. `sign` records how the rows relate to the
   displayed figure: Metrics negates revenue, cash-out and advances so they read
   positive, and the underlying rows are credits. */
const Traces = (() => {
  // key => [label, test(row, arg), sign, needsArg]
  const DEFS = {
    contract: [
      'Contract value — sales orders, excluding down-payment lines',
      (r) => r.type === 'Sales Order' && r.status !== 'Canceled'
        && !String(r.description).toUpperCase().includes('DOWN PAYMENT'),
      1, false,
    ],
    committed: [
      'Committed to purchase orders',
      (r) => r.type === 'Purchase Order' && r.status !== 'Canceled',
      1, false,
    ],
    committed_open: [
      'Open / undelivered purchase orders',
      (r) => r.type === 'Purchase Order' && r.status === 'Open',
      1, false,
    ],
    nonpo: [
      'Non-PO cost — payroll and manual journal entries',
      (r) => r.acctFirst === '5' && r.type === 'Manual Journal Entry',
      1, false,
    ],
    cost_at_completion: [
      'Estimated cost at completion — POs plus non-PO cost',
      (r) => (r.type === 'Purchase Order' && r.status !== 'Canceled')
        || (r.acctFirst === '5' && r.type === 'Manual Journal Entry'),
      1, false,
    ],
    cost_pl: [
      'Cost charged to P&L — 5-series accounting postings',
      (r) => r.acctFirst === '5' && r.group === 'Accounting',
      1, false,
    ],
    revenue: [
      'Revenue recognised — account 41010101',
      (r) => r.acctCode === '41010101' && r.group === 'Accounting',
      -1, false,
    ],
    inventory: [
      'Materials delivered, still in inventory — account 11040401',
      (r) => r.acctCode === '11040401' && r.group === 'Accounting',
      1, false,
    ],
    retention: [
      'Retention receivable — account 11030300',
      (r) => r.acctCode === '11030300' && r.group === 'Accounting',
      1, false,
    ],
    advances: [
      'Customer advances, unapplied — account 21090103',
      (r) => r.acctCode === '21090103' && r.group === 'Accounting',
      -1, false,
    ],
    cash_in: [
      'Cash collected — inflows to bank accounts',
      (r) => r.isCashBank && r.amount > 0,
      1, false,
    ],
    cash_out: [
      'Cash disbursed — outflows from bank accounts',
      (r) => r.isCashBank && r.amount < 0,
      -1, false,
    ],
    cash_net: [
      'Net project cash flow — all bank movements',
      (r) => r.isCashBank,
      1, false,
    ],
    category: [
      'Cost charged to P&L',
      (r, arg) => r.bpName === arg && r.acctFirst === '5' && r.group === 'Accounting',
      1, true,
    ],
    vendor: [
      'Purchase orders issued',
      (r, arg) => r.bpName === arg && r.type === 'Purchase Order' && r.status !== 'Canceled',
      1, true,
    ],
  };

  /** Resolve a trace to a JS predicate, or null for an unknown/argument-less trace. */
  function resolve(key, arg = '') {
    const def = DEFS[key];
    if (!def) return null;
    let [label, test, sign, needsArg] = def;
    if (needsArg) {
      if (arg === '') return null; // a parameterised trace without its argument is meaningless
      label = arg + ' — ' + label;
    }
    return { label, sign, test: (row) => test(row, arg) };
  }

  return { resolve };
})();
