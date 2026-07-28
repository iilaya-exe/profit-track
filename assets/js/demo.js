/* Synthetic sample project, so the app can be tried without a real SAP export.

   Every figure here is invented — fictional client, vendors and amounts — but the
   rows are shaped exactly like a Transaction Journal Report, so they exercise the
   full dashboard: contract value, committed vs. open POs, revenue, cost by
   category, cash flow across months, retention, advances and the journal screen.

   Demo.seed() writes it through the same path an import uses; Demo.remove() clears
   it. It is identified by a fixed code so it never collides with a real import. */
const Demo = (() => {
  const CODE = 'DEMO-001';
  const ID = 'demo-001'; // Store.slug(CODE)
  const NAME = 'DEMO — Riverside Terminal Fit-Out (sample data)';
  const CLIENT = 'Metro Harbor Development Corp.';
  const SOURCE = 'Sample_Data.xlsx';

  // Eight consecutive months the activity spreads across (Nov 2025 – Jun 2026).
  const MONTHS = [[2025, 11], [2025, 12], [2026, 1], [2026, 2], [2026, 3], [2026, 4], [2026, 5], [2026, 6]];
  function date(monthIdx, day) {
    const [y, m] = MONTHS[monthIdx];
    const p = (n) => String(n).padStart(2, '0');
    return `${p(m)}.${p(day)}.${String(y).slice(2)}`; // MM.DD.YY, the SAP export format
  }

  function build() {
    const rows = [];
    let seq = 1001;
    let entry = 60001;
    const add = (o) => {
      const amount = o.amount;
      const vat = o.vat ?? 0;
      rows.push({
        seq: seq++,
        projectCode: CODE,
        projectName: NAME,
        txDate: o.date,
        docDate: o.date,
        group: o.group,
        type: o.type,
        objectType: o.objectType ?? '',
        docEntry: String(entry),
        docNo: o.docNo ?? String(3000000 + entry++),
        bpCode: o.bpCode ?? '',
        bpName: o.bpName,
        acctCode: o.acctCode ?? '',
        description: o.description ?? '',
        qty: o.qty ?? 1,
        currency: 'PHP',
        amount,
        vat,
        amountIncl: Math.round((amount + vat) * 100) / 100,
        status: o.status ?? 'Closed',
        reference: o.reference ?? '',
        remarks: o.remarks ?? '',
      });
    };

    // --- Sales Orders — the contract (TCV = these less the down-payment line) ---
    const so = { group: 'Sales', type: 'Sales Order', objectType: '17', bpName: CLIENT, bpCode: 'C-MHDC' };
    add({ ...so, date: date(0, 10), acctCode: 'SO-STR', description: 'Structural steel package — contract scope', amount: 20000000, vat: 2400000, status: 'Closed' });
    add({ ...so, date: date(0, 10), acctCode: 'SO-ELE', description: 'Electrical & auxiliary systems — contract scope', amount: 18000000, vat: 2160000, status: 'Open' });
    add({ ...so, date: date(0, 12), acctCode: 'SO-FIT', description: 'Interior fit-out — contract scope', amount: 14000000, vat: 1680000, status: 'Open' });
    add({ ...so, date: date(1, 5), acctCode: 'SO-DP', description: 'DOWN PAYMENT billing (15% of contract)', amount: 2000000, vat: 240000, status: 'Closed' });

    // --- Purchase Orders — committed cost, some still open, one cancelled ---
    [
      ['Harbor Steel & Supply Inc.', 'HAR_STE', 6200000, 'Closed', 1, 'Reinforcing steel bars'],
      ['Harbor Steel & Supply Inc.', 'HAR_STE', 3100000, 'Open', 3, 'Structural steel sections'],
      ['Delta Electrical Traders', 'DEL_ELE', 4800000, 'Closed', 2, 'Cables and conduits'],
      ['Delta Electrical Traders', 'DEL_ELE', 2200000, 'Open', 4, 'Switchgear and distribution panels'],
      ['Pioneer Concrete Works', 'PIO_CON', 5500000, 'Closed', 1, 'Ready-mix concrete supply'],
      ['Pioneer Concrete Works', 'PIO_CON', 1900000, 'Closed', 2, 'Precast elements'],
      ['Summit MEP Contractors', 'SUM_MEP', 4400000, 'Open', 3, 'HVAC ductwork supply'],
      ['Summit MEP Contractors', 'SUM_MEP', 2600000, 'Closed', 5, 'Plumbing fixtures'],
      ['BrightPath Interiors', 'BRI_INT', 3300000, 'Open', 4, 'Partition and ceiling systems'],
      ['Cityline Hardware', 'CIT_HAR', 900000, 'Closed', 0, 'Fasteners and hand tools'],
      ['Cityline Hardware', 'CIT_HAR', 600000, 'Closed', 5, 'Site consumables'],
      ['Ironwood Fabrication', 'IRO_FAB', 1500000, 'Canceled', 2, 'Custom brackets (cancelled)'],
    ].forEach(([vendor, code, amount, status, mi, description], i) => {
      add({
        group: 'Purchasing', type: 'Purchase Order', objectType: '22',
        bpName: vendor, bpCode: code, acctCode: 'PO-' + String(i + 1).padStart(3, '0'),
        description, amount, vat: Math.round(amount * 0.12 * 100) / 100, status, date: date(mi, 8 + i % 15),
      });
    });

    // --- Payroll — non-PO cost (Manual Journal Entry), also a cost category ---
    for (let mi = 1; mi <= 5; mi++) {
      add({
        group: 'Accounting', type: 'Manual Journal Entry', acctCode: '50201010',
        bpName: 'SALARY & WAGES-ABI', description: 'Project site payroll',
        amount: 500000, status: 'Posted', date: date(mi, 25),
      });
    }

    // --- Cost charged to P&L, by category (5-series accounting postings) ---
    const cost = (acctCode, bpName, amount, mi, description) => add({
      group: 'Accounting', type: 'Journal Entry', acctCode, bpName, amount,
      description, status: 'Posted', date: date(mi, 20),
    });
    cost('50101010', 'CONTRACTED SERVICES', 1200000, 2, 'Contracted services charged to project');
    cost('50101010', 'CONTRACTED SERVICES', 1200000, 4, 'Contracted services charged to project');
    cost('50102010', 'DIRECT MATERIALS', 1200000, 1, 'Direct materials issued to site');
    cost('50102010', 'DIRECT MATERIALS', 1200000, 2, 'Direct materials issued to site');
    cost('50102010', 'DIRECT MATERIALS', 1200000, 3, 'Direct materials issued to site');
    cost('50103010', 'SUBCONTRACTORS', 1400000, 3, 'Subcontractor progress billing');
    cost('50103010', 'SUBCONTRACTORS', 1400000, 4, 'Subcontractor progress billing');
    cost('50103010', 'SUBCONTRACTORS', 1400000, 5, 'Subcontractor progress billing');
    cost('50104010', 'NON CONSUMABLE SUPPLIES', 400000, 2, 'Non-consumable supplies');
    cost('50104010', 'NON CONSUMABLE SUPPLIES', 400000, 4, 'Non-consumable supplies');
    cost('50501010', 'Equipment Rental', 750000, 3, 'Crane and equipment rental');
    cost('50502010', 'Site Overheads', 750000, 5, 'Site office and utilities');

    // --- Revenue recognised (account 41010101, credits stored negative) ---
    [[2, 6000000], [4, 7000000], [5, 5000000], [6, 4000000]].forEach(([mi, amt]) => add({
      group: 'Accounting', type: 'A/R Invoice', objectType: '13', acctCode: '41010101',
      bpName: CLIENT, description: 'Progress billing recognised', amount: -amt, status: 'Closed', date: date(mi, 28),
    }));

    // --- Materials delivered, still in inventory (account 11040401) ---
    [[2, 2000000], [3, 2100000]].forEach(([mi, amt]) => add({
      group: 'Accounting', type: 'Goods Receipt PO', acctCode: '11040401',
      bpName: 'Materials in stock', description: 'Delivered materials, not yet issued', amount: amt, status: 'Closed', date: date(mi, 15),
    }));

    // --- Retention receivable (account 11030300) ---
    [[4, 550000], [6, 600000]].forEach(([mi, amt]) => add({
      group: 'Accounting', type: 'A/R Invoice', acctCode: '11030300',
      bpName: CLIENT, description: 'Retention withheld by client', amount: amt, status: 'Open', date: date(mi, 28),
    }));

    // --- Customer advances, unapplied (account 21090103, credit negative) ---
    [[1, 1500000], [2, 1000000]].forEach(([mi, amt]) => add({
      group: 'Accounting', type: 'Journal Entry', acctCode: '21090103',
      bpName: CLIENT, description: 'Customer advance received (unapplied)', amount: -amt, status: 'Posted', date: date(mi, 6),
    }));

    // --- Cash movements (bank rows are recognised by "CASH IN BANK" in the name) ---
    [[2, 4500000], [3, 3000000], [4, 5000000], [5, 4000000], [6, 3500000]].forEach(([mi, amt]) => add({
      group: 'Banking', type: 'Incoming Payment', acctCode: '10102010',
      bpName: 'CASH IN BANK - BDO', description: 'Collection from client', amount: amt, status: 'Closed', date: date(mi, 18),
    }));
    [[1, 1500000], [2, 2500000], [3, 3000000], [4, 3500000], [5, 3000000], [6, 3500000]].forEach(([mi, amt]) => add({
      group: 'Banking', type: 'Outgoing Payment', acctCode: '10102010',
      bpName: 'CASH IN BANK - BDO', description: 'Payment to vendors and payroll', amount: -amt, status: 'Closed', date: date(mi, 27),
    }));

    return rows;
  }

  return {
    ID,
    exists: () => Store.find(ID) !== null,
    seed: () => Store.replaceProject(CODE, NAME, SOURCE, build()),
    remove: () => Store.remove(ID),
  };
})();
