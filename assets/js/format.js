/* Number, date and DOM helpers. The currency formats mirror the workbook's
   custom number formats so the app reads the same as the spreadsheet. */
const Fmt = (() => {
  const PESO = '₱';
  const DASH = '–';

  const grouped = new Intl.NumberFormat('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const plain   = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 3 });

  /** Workbook format ₱#,##0.0,,"M" — millions, one decimal, en-dash for zero. */
  function pesoM(value, { dashZero = true } = {}) {
    const n = Number(value) || 0;
    if (dashZero && Math.abs(n) < 0.5) return DASH;
    const m = n / 1e6;
    const sign = m < 0 ? '-' : '';
    return `${sign}${PESO}${Math.abs(m).toFixed(1)}M`;
  }

  /** Full peso amount with 2 decimals, e.g. ₱213,275,243.72. */
  function peso(value) {
    const n = Number(value) || 0;
    return (n < 0 ? '-' : '') + PESO + grouped.format(Math.abs(n));
  }

  /** Compact axis/tick label: ₱24M, ₱1.5M, ₱450K, 0. */
  function pesoAxis(value) {
    const n = Number(value) || 0;
    if (n === 0) return '0';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '';
    if (abs >= 1e6) {
      const m = abs / 1e6;
      return `${sign}${PESO}${m >= 10 ? Math.round(m) : m.toFixed(1)}M`;
    }
    if (abs >= 1e3) return `${sign}${PESO}${Math.round(abs / 1e3)}K`;
    return `${sign}${PESO}${Math.round(abs)}`;
  }

  /**
   * Millions once the figure warrants it, otherwise the exact amount. A small
   * cost category rendered as ₱0.0M looks like nothing at all; ₱156.25 reads.
   */
  function pesoSmart(value) {
    const n = Number(value) || 0;
    if (n === 0) return DASH;
    return Math.abs(n) >= 1e6 ? pesoM(n) : peso(n);
  }

  function pct(value, digits = 1) {
    return `${((Number(value) || 0) * 100).toFixed(digits)}%`;
  }

  function pctSigned(value, digits = 1) {
    const n = (Number(value) || 0) * 100;
    return `${n > 0 ? '+' : ''}${n.toFixed(digits)}%`;
  }

  function number(value) {
    return plain.format(Number(value) || 0);
  }

  /** Journal amounts: blank cells stay visually quiet rather than printing 0.00. */
  function amount(value) {
    const n = Number(value) || 0;
    if (n === 0) return DASH;
    return grouped.format(n);
  }

  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  /** '2026-02-11' -> '11 Feb 2026'. Parsed by parts so no timezone shifts the day. */
  function date(iso) {
    if (!iso) return DASH;
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y || !m || !d) return String(iso);
    return `${d} ${MONTHS[m - 1]} ${y}`;
  }

  /** '2026-02-01' -> 'Feb 2026'. */
  function month(iso) {
    if (!iso) return DASH;
    const [y, m] = String(iso).split('-').map(Number);
    return m ? `${MONTHS[m - 1]} ${y}` : String(iso);
  }

  /** SAP writes journal dates as MM.DD.YY; mirror the backend's parse. */
  function isoFromExport(value) {
    const m = /^(\d{2})\.(\d{2})\.(\d{2})$/.exec(String(value).trim());
    return m ? `20${m[3]}-${m[1]}-${m[2]}` : String(value);
  }

  function dateShort(iso) {
    if (!iso) return DASH;
    const [y, m, d] = String(iso).split('-').map(Number);
    if (!y) return String(iso);
    return `${String(m).padStart(2, '0')}/${String(d).padStart(2, '0')}/${String(y).slice(2)}`;
  }

  // ---------------------------------------------------------------- DOM ----
  /** Tiny hyperscript. Children may be nodes, strings, or nested arrays. */
  function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value);
      } else node.setAttribute(key, value === true ? '' : String(value));
    }
    append(node, children);
    return node;
  }

  function append(parent, children) {
    for (const child of [].concat(children)) {
      if (child === null || child === undefined || child === false) continue;
      parent.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return parent;
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';
  function svg(tag, props = {}, children = []) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value === null || value === undefined || value === false) continue;
      node.setAttribute(key, String(value));
    }
    for (const child of [].concat(children)) {
      if (child) node.appendChild(child);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  /** Sign class for a value where "up is good". */
  function signClass(value) {
    const n = Number(value) || 0;
    return n > 0 ? 'pos' : n < 0 ? 'neg' : '';
  }

  return {
    PESO, DASH,
    peso, pesoM, pesoSmart, pesoAxis, pct, pctSigned, number, amount,
    date, dateShort, month, isoFromExport,
    el, svg, append, clear, signClass,
  };
})();
