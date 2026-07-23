/* Port of Store.php — project persistence, now on localStorage instead of MySQL.

   One key per project (`pcf:project:<id>`) holds the whole document: metadata,
   tuned parameters and every journal row exactly as imported. Every figure the
   app shows is derived from those rows at read time, so nothing can drift out of
   step with the source. The journal screen filters, sorts and pages in memory. */
const Store = (() => {
  const PREFIX = 'pcf:project:';

  // Journal columns, in export order. Keys are what the rest of the app uses.
  const COLUMNS = {
    seq: '#',
    projectCode: 'Project Code',
    projectName: 'Project Name',
    txDate: 'Transaction Date',
    docDate: 'Document Date',
    group: 'Transaction Group',
    type: 'Transaction Type',
    objectType: 'Object Type',
    docEntry: 'DocEntry',
    docNo: 'Document No.',
    bpCode: 'BP / Account Code',
    bpName: 'Customer / Vendor / Account Name',
    acctCode: 'Item / Account Code',
    description: 'Description',
    qty: 'Quantity',
    currency: 'Currency',
    amount: 'Amount Excl. VAT - LC',
    vat: 'VAT Amount - LC',
    amountIncl: 'Amount Incl. VAT - LC',
    status: 'Document Status',
    reference: 'Reference',
    remarks: 'Remarks',
  };

  // Columns the free-text search scans (app keys of Store.php's SEARCHABLE).
  const SEARCHABLE = ['docNo', 'bpCode', 'bpName', 'acctCode',
                      'description', 'reference', 'remarks', 'type', 'status'];

  const NUMERIC = ['qty', 'amount', 'vat', 'amountIncl'];

  // ------------------------------------------------------------ persistence ---

  function key(id) { return PREFIX + id; }

  function ids() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out.sort();
  }

  function find(id) {
    const raw = localStorage.getItem(key(id));
    if (raw === null) return null;
    try {
      const doc = JSON.parse(raw);
      doc.rows = Array.isArray(doc.rows) ? doc.rows : [];
      return doc;
    } catch { return null; }
  }

  function all() {
    return ids().map(find).filter(Boolean);
  }

  function persist(doc) {
    try {
      localStorage.setItem(key(doc.id), JSON.stringify(doc));
    } catch (e) {
      throw new Error('Could not save — the browser\'s local storage is full. '
        + 'Delete a project to free space, then try again.');
    }
  }

  const clamp = (v) => Math.max(0, Math.min(0.95, Math.round(v * 1e6) / 1e6));

  function updateParams(id, params) {
    const doc = find(id);
    if (doc === null) return null;
    doc.params = {
      projectedMargin: clamp(Number(params.projectedMargin ?? 0.20)),
      minMargin: clamp(Number(params.minMargin ?? 0.20)),
      minCashPctOfGP: clamp(Number(params.minCashPctOfGP ?? 0.20)),
    };
    persist(doc);
    return doc;
  }

  function setLogo(id, logo) {
    const doc = find(id);
    if (doc === null) return null;
    doc.logo = logo || '';
    persist(doc);
    return doc;
  }

  function remove(id) {
    const existed = localStorage.getItem(key(id)) !== null;
    localStorage.removeItem(key(id));
    return existed;
  }

  // ------------------------------------------------------------------ import ---

  function slug(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function normalizeLabel(label) {
    return String(label).toLowerCase().replace(/[^a-z0-9]+/gi, '');
  }

  function mapHeaders(header) {
    const seen = {};
    header.forEach((label, i) => { seen[normalizeLabel(label ?? '')] = i; });
    const map = {};
    for (const [k, label] of Object.entries(COLUMNS)) {
      const norm = normalizeLabel(label);
      if (norm in seen) map[k] = seen[norm];
    }
    for (const required of ['projectCode', 'txDate', 'type', 'amount']) {
      if (!(required in map)) {
        throw new Error('Export is missing the "' + COLUMNS[required] + '" column.');
      }
    }
    return map;
  }

  function normalizeRow(line, map) {
    const code = String(line[map.projectCode] ?? '').trim();
    if (code === '') return null;
    const row = {};
    for (const k of Object.keys(COLUMNS)) {
      const value = k in map ? (line[map[k]] ?? null) : null;
      if (NUMERIC.includes(k)) {
        row[k] = typeof value === 'number' && Number.isFinite(value) ? value
          : (value !== null && value !== '' && !isNaN(Number(value)) ? Number(value) : 0);
      } else if (k === 'seq') {
        row[k] = typeof value === 'number' ? Math.trunc(value)
          : (value !== null && !isNaN(Number(value)) ? Math.trunc(Number(value)) : 0);
      } else {
        // A whole-number cell (e.g. a DocEntry) arrives as a float — show it as an int.
        row[k] = typeof value === 'number' && Number.isFinite(value) && Math.floor(value) === value
          ? String(Math.trunc(value))
          : String(value ?? '').trim();
      }
    }
    row.projectCode = code;
    return row;
  }

  /**
   * Import a Transaction Journal Report export. Rows are split by project code,
   * so a multi-project export creates or replaces several projects at once.
   * Re-importing keeps whatever margin/thresholds the user had already tuned.
   */
  async function importXlsx(arrayBuffer, displayName) {
    const book = await Xlsx.open(arrayBuffer);
    const names = book.sheetNames();
    let target = names.find((n) => n.trim().toLowerCase() === 'transaction journal report');
    target ??= names[0];
    if (!target) throw new Error('Workbook has no sheets.');

    const grid = await book.sheet(target);
    if (grid.length < 2) throw new Error(`Sheet "${target}" has no data rows.`);

    const map = mapHeaders(grid.shift());
    const byProject = {};
    for (const line of grid) {
      const row = normalizeRow(line, map);
      if (row === null) continue;
      (byProject[row.projectCode] ??= []).push(row);
    }
    if (Object.keys(byProject).length === 0) {
      throw new Error('No journal rows found — is this a Transaction Journal Report export?');
    }

    const source = String(displayName || '').replace(/^.*[\\/]/, '');
    const result = [];
    for (const [code, rows] of Object.entries(byProject)) {
      result.push(replaceProject(code, String(rows[0].projectName || code), source, rows));
    }
    return result;
  }

  function replaceProject(code, name, source, rows) {
    const id = slug(code);
    if (id === '') throw new Error('Project code produces an empty id: ' + code);

    const existing = find(id);
    const replaced = existing !== null;
    const doc = {
      id,
      code,
      name,
      source,
      importedAt: new Date().toISOString(),
      // Keep tuned parameters on replace; default 20% on a fresh import.
      params: replaced ? existing.params : { projectedMargin: 0.20, minMargin: 0.20, minCashPctOfGP: 0.20 },
      logo: replaced ? (existing.logo || '') : '',
      rows,
    };
    persist(doc);
    return { id, code, name, rows: rows.length, replaced };
  }

  // ----------------------------------------------------------------- journal ---

  function rowCount(id) {
    const doc = find(id);
    return doc ? doc.rows.length : 0;
  }

  function facets(rows) {
    const build = (field, isDate) => {
      const counts = new Map();
      for (const r of rows) {
        const value = r[field];
        if (value === null || value === undefined) continue;
        if (!isDate && value === '') continue;
        counts.set(value, (counts.get(value) || 0) + 1);
      }
      return [...counts.entries()]
        .map(([value, count]) => ({ value: String(value), count }))
        .sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
    };
    return {
      groups: build('group', false),
      types: build('type', false),
      statuses: build('status', false),
      months: build('monthStart', true),
    };
  }

  /**
   * Filter, sort and page the journal in memory. Mirrors Store::journal + the
   * `journal()` handler that shaped index.php's response.
   */
  function journal(id, query) {
    const doc = find(id);
    if (doc === null) throw new HttpError('Project not found: ' + id, 404);

    const all = Metrics.decorate(doc.rows);

    const needle = String(query.q ?? '').trim().toLowerCase();
    const trace = Traces.resolve(String(query.trace ?? ''), String(query.traceArg ?? ''));
    const eq = {
      group: String(query.group ?? '').trim(),
      type: String(query.type ?? '').trim(),
      status: String(query.status ?? '').trim(),
      monthStart: String(query.month ?? '').trim(),
    };
    const from = String(query.from ?? '').trim();
    const to = String(query.to ?? '').trim();

    const filtered = all.filter((r) => {
      for (const [field, want] of Object.entries(eq)) {
        if (want !== '' && String(r[field] ?? '') !== want) return false;
      }
      if (from !== '' && (r.date === null || r.date < from)) return false;
      if (to !== '' && (r.date === null || r.date > to)) return false;
      if (needle !== '') {
        const hit = SEARCHABLE.some((f) => String(r[f] ?? '').toLowerCase().includes(needle));
        if (!hit) return false;
      }
      if (trace !== null && !trace.test(r)) return false;
      return true;
    });

    // Totals over the whole filtered set.
    const totals = { amount: 0, vat: 0, amountIncl: 0, debit: 0, credit: 0 };
    for (const r of filtered) {
      totals.amount += r.amount;
      totals.vat += Number(r.vat) || 0;
      totals.amountIncl += Number(r.amountIncl) || 0;
      if (r.amount >= 0) totals.debit += r.amount; else totals.credit += r.amount;
    }

    // Sort — column from a whitelist, never from user input.
    let sortKey = String(query.sort ?? 'seq');
    if (!(sortKey in COLUMNS) && sortKey !== 'date') sortKey = 'seq';
    const field = sortKey === 'date' ? 'date' : sortKey;
    const numericSort = NUMERIC.includes(field) || field === 'seq';
    const dir = query.dir === 'desc' ? -1 : 1;
    filtered.sort((a, b) => {
      let cmp;
      if (numericSort) {
        cmp = (Number(a[field]) || 0) - (Number(b[field]) || 0);
      } else {
        const av = String(a[field] ?? ''), bv = String(b[field] ?? '');
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      if (cmp !== 0) return cmp * dir;
      return a.seq - b.seq; // stable tie-break, always ascending
    });

    const total = filtered.length;
    let paging, pageRows;
    if (query.all === 1 || query.all === '1' || query.all === true) {
      pageRows = filtered;
      paging = { page: 1, perPage: total, pages: 1 };
    } else {
      const perPage = Math.max(10, Math.min(500, Number(query.perPage) || 50));
      const pages = Math.max(1, Math.ceil(total / perPage));
      const page = Math.max(1, Math.min(pages, Number(query.page) || 1));
      pageRows = filtered.slice((page - 1) * perPage, page * perPage);
      paging = { page, perPage, pages };
    }

    return {
      columns: COLUMNS,
      facets: facets(all),
      totals,
      page: paging,
      count: { filtered: total, total: all.length },
      trace: trace === null ? null : {
        key: String(query.trace ?? ''),
        arg: String(query.traceArg ?? ''),
        label: trace.label,
        sign: trace.sign,
      },
      rows: pageRows,
    };
  }

  return {
    COLUMNS, ids, find, all, updateParams, setLogo, remove,
    importXlsx, journal, rowCount,
  };
})();

/** Carries an HTTP-ish status so Api can surface the same messages the PHP did. */
class HttpError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
