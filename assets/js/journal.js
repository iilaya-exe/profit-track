/* Transaction Journal Report tab — every column of the source export, with
   search, filters, sorting, paging, running totals and CSV download. */
const JournalView = (() => {
  const { el, amount, number, date, month } = Fmt;

  /** Columns rendered right-aligned as numbers. */
  const NUMERIC = new Set(['seq', 'objectType', 'docEntry', 'docNo', 'qty', 'amount', 'vat', 'amountIncl']);
  /** Columns allowed to wrap onto several lines. */
  const WRAPPING = new Set(['projectName', 'bpName', 'description', 'remarks']);
  /** Project code and name repeat on every row; they live in the page header instead. */
  const HIDDEN = new Set(['projectCode', 'projectName']);

  const DEFAULTS = { q: '', group: '', type: '', status: '', month: '', from: '', to: '',
                     trace: '', traceArg: '',
                     sort: 'seq', dir: 'asc', page: 1, perPage: 50 };

  /**
   * @param {object} initial state from the URL — a drill-down arriving from the
   *   dashboard, or a shared link someone pasted.
   */
  function create(container, projectId, meta, initial = {}) {
    const state = { ...DEFAULTS };
    for (const key of Object.keys(DEFAULTS)) {
      if (initial[key] !== undefined && initial[key] !== '') state[key] = initial[key];
    }
    let columns = {};
    let inFlight = 0;

    const traceBar = el('div');
    const filterBar = el('div', { class: 'toolbar' });
    const chips = el('div', { class: 'chips' });
    const tableHost = el('div', { class: 'journal-table-wrap' });
    const resultBar = el('div', { class: 'result-bar' });

    const panel = el('div', { class: 'db-table-card' }, [traceBar, filterBar, tableHost, resultBar]);
    Fmt.clear(container);
    container.appendChild(panel);

    // Debounced so typing in the search box does not fire a request per keystroke.
    let searchTimer = 0;
    const debouncedLoad = () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.page = 1; load(); }, 220);
    };

    async function load() {
      const token = ++inFlight;
      tableHost.setAttribute('aria-busy', 'true');
      try {
        const data = await Api.getJournal(projectId, state);
        if (token !== inFlight) return; // a newer request already won
        columns = data.columns;
        renderTrace(data);
        renderFilters(data.facets);
        renderTable(data);
        renderResults(data);
      } catch (error) {
        Fmt.clear(tableHost).appendChild(el('div', { class: 'error-banner', text: error.message }));
      } finally {
        tableHost.removeAttribute('aria-busy');
      }
    }

    // --------------------------------------------------------------- trace ---
    /**
     * Closes the loop on a drill-down: restates the figure that was clicked and
     * shows the total of the rows on screen, so the reader can see for
     * themselves that the rows add up to it.
     */
    function renderTrace(data) {
      Fmt.clear(traceBar);
      if (!state.trace) return;

      if (!data.trace) {
        traceBar.appendChild(el('div', { class: 'trace-bar is-unknown' }, [
          el('span', { class: 'trace-body' }, [
            el('b', { text: 'Unknown drill-down' }),
            el('span', { text: `“${state.trace}” is not a known figure, so no filter was applied.` }),
          ]),
          el('button', { class: 'btn btn-sm', type: 'button', text: 'Clear', onClick: clearTrace }),
        ]));
        return;
      }

      // Metrics negates revenue, cash-out and advances so they read positive;
      // sign puts the row total back into the same terms as the dashboard.
      const total = data.trace.sign * data.totals.amount;

      traceBar.appendChild(el('div', { class: 'trace-bar' }, [
        el('span', { class: 'trace-body' }, [
          el('b', { text: data.trace.label }),
          el('span', {}, [
            `${data.count.filtered.toLocaleString()} of ${data.count.total.toLocaleString()} journal lines`,
            state.month ? ` in ${month(state.month)}` : '',
            ' · they total ',
            el('strong', { text: Fmt.peso(total) }),
          ]),
        ]),
        el('div', { class: 'trace-actions' }, [
          el('a', {
            class: 'btn btn-sm', href: `#/p/${encodeURIComponent(projectId)}/dashboard`,
            text: '← Dashboard',
          }),
          el('button', { class: 'btn btn-sm', type: 'button', text: 'Show all rows', onClick: clearTrace }),
        ]),
      ]));
    }

    function clearTrace() {
      state.trace = '';
      state.traceArg = '';
      state.month = '';
      state.page = 1;
      // Drop the query from the URL so a reload does not restore the drill-down.
      history.replaceState(null, '', `#/p/${encodeURIComponent(projectId)}/journal`);
      load();
    }

    // ------------------------------------------------------------- filters ---
    function renderFilters(facets) {
      // Preserve focus and caret across re-renders so typing is never interrupted.
      const active = document.activeElement;
      const activeId = active && filterBar.contains(active) ? active.id : null;
      const caret = activeId && active.setSelectionRange ? active.selectionStart : null;

      Fmt.clear(filterBar);

      const search = el('input', {
        type: 'search', id: 'j-search', placeholder: 'Search description, vendor, document no., remarks…',
        value: state.q, onInput: (e) => { state.q = e.target.value; debouncedLoad(); },
      });

      const select = (id, label, key, options, allLabel, formatter = (v) => v) => {
        const node = el('select', {
          id, onChange: (e) => { state[key] = e.target.value; state.page = 1; load(); },
        }, [
          el('option', { value: '', text: allLabel }),
          ...options.map((o) => el('option', {
            value: o.value, selected: state[key] === o.value,
          }, [`${formatter(o.value)} (${o.count})`])),
        ]);
        return el('div', { class: 'field' }, [el('label', { for: id, text: label }), node]);
      };

      const dateField = (id, label, key) => el('div', { class: 'field' }, [
        el('label', { for: id, text: label }),
        el('input', {
          type: 'date', id, value: state[key],
          onChange: (e) => { state[key] = e.target.value; state.page = 1; load(); },
        }),
      ]);

      Fmt.append(filterBar, [
        el('div', { class: 'field grow' }, [el('label', { for: 'j-search', text: 'Search' }), search]),
        select('j-group', 'Group', 'group', facets.groups, 'All groups'),
        select('j-type', 'Type', 'type', facets.types, 'All types'),
        select('j-status', 'Status', 'status', facets.statuses, 'All statuses'),
        select('j-month', 'Month', 'month', facets.months, 'All months', month),
        dateField('j-from', 'From', 'from'),
        dateField('j-to', 'To', 'to'),
        el('div', { class: 'toolbar-actions' }, [
          el('button', {
            class: 'btn btn-sm', type: 'button', text: 'Reset',
            onClick: () => { Object.assign(state, DEFAULTS); load(); },
          }),
          el('button', {
            class: 'btn btn-sm', type: 'button', text: 'Export CSV', onClick: exportCsv,
          }),
        ]),
      ]);

      if (activeId) {
        const restored = filterBar.querySelector(`#${CSS.escape(activeId)}`);
        if (restored) {
          restored.focus();
          if (caret !== null && restored.setSelectionRange) restored.setSelectionRange(caret, caret);
        }
      }
    }

    // --------------------------------------------------------------- table ---
    function renderTable(data) {
      const keys = Object.keys(columns).filter((k) => !HIDDEN.has(k));

      const header = el('tr', {}, keys.map((key) => {
        const sorted = state.sort === key;
        return el('th', {
          class: `sortable${NUMERIC.has(key) ? ' n' : ''}`,
          scope: 'col', role: 'columnheader', tabindex: '0',
          'aria-sort': sorted ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none',
          title: `Sort by ${columns[key]}`,
          onClick: () => sortBy(key),
          onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sortBy(key); } },
        }, [columns[key]]);
      }));

      const body = data.rows.map((row) => el('tr', {}, keys.map((key) => {
        const raw = row[key];
        let text;
        if (key === 'txDate') text = row.date ? Fmt.dateShort(row.date) : (raw || Fmt.DASH);
        else if (key === 'docDate') text = raw ? Fmt.dateShort(Fmt.isoFromExport(raw)) : Fmt.DASH;
        else if (key === 'qty') text = raw ? number(raw) : Fmt.DASH;
        else if (key === 'amount' || key === 'vat' || key === 'amountIncl') text = amount(raw);
        else text = raw === '' || raw === null || raw === undefined ? Fmt.DASH : String(raw);

        const classes = [
          NUMERIC.has(key) ? 'n' : '',
          WRAPPING.has(key) ? 'wrap' : '',
          text === Fmt.DASH ? 'zero' : '',
        ].filter(Boolean).join(' ');
        return el('td', { class: classes, title: WRAPPING.has(key) && raw ? String(raw) : '' }, [text]);
      })));

      const footer = el('tr', {}, keys.map((key) => {
        if (key === 'seq') return el('td', { text: `${data.count.filtered.toLocaleString()} rows` });
        if (key === 'amount') return el('td', { class: 'n', text: amount(data.totals.amount) });
        if (key === 'vat') return el('td', { class: 'n', text: amount(data.totals.vat) });
        if (key === 'amountIncl') return el('td', { class: 'n', text: amount(data.totals.amountIncl) });
        return el('td', {});
      }));

      Fmt.clear(tableHost).appendChild(el('table', { class: 'data' }, [
        el('caption', { class: 'visually-hidden', text: `${meta.name} transaction journal` }),
        el('thead', {}, [header]),
        el('tbody', {}, body.length ? body : [
          el('tr', {}, [el('td', { colspan: keys.length, class: 'dim', text: 'No rows match these filters.' })]),
        ]),
        el('tfoot', {}, [footer]),
      ]));
    }

    function sortBy(key) {
      if (state.sort === key) state.dir = state.dir === 'asc' ? 'desc' : 'asc';
      else { state.sort = key; state.dir = 'asc'; }
      load();
    }

    // ------------------------------------------------------------- results ---
    function renderResults(data) {
      Fmt.clear(resultBar);
      const { page, pages } = data.page;

      Fmt.clear(chips);
      for (const [key, label] of [['group', 'Group'], ['type', 'Type'], ['status', 'Status'],
                                  ['month', 'Month'], ['from', 'From'], ['to', 'To'], ['q', 'Search']]) {
        if (!state[key]) continue;
        const shown = key === 'month' ? month(state[key]) : key === 'from' || key === 'to' ? date(state[key]) : state[key];
        chips.appendChild(el('span', { class: 'chip' }, [
          `${label}: ${shown}`,
          el('button', {
            type: 'button', 'aria-label': `Remove ${label} filter`, text: '×',
            onClick: () => { state[key] = DEFAULTS[key]; state.page = 1; load(); },
          }),
        ]));
      }

      const pageButton = (text, target, disabled) => el('button', {
        class: 'btn btn-sm', type: 'button', text, disabled,
        onClick: () => { state.page = target; load(); },
      });

      Fmt.append(resultBar, [
        el('span', {}, [
          'Showing ', el('b', { text: data.rows.length.toLocaleString() }), ' of ',
          el('b', { text: data.count.filtered.toLocaleString() }), ' filtered rows (',
          data.count.total.toLocaleString(), ' total)',
        ]),
        el('span', {}, ['Net amount ', el('b', { text: Fmt.peso(data.totals.amount) })]),
        el('span', {}, ['Debits ', el('b', { text: Fmt.peso(data.totals.debit) }),
          ' · Credits ', el('b', { text: Fmt.peso(data.totals.credit) })]),
        chips,
        el('span', { class: 'spacer' }),
        el('div', { class: 'field' }, [
          el('select', {
            'aria-label': 'Rows per page',
            onChange: (e) => { state.perPage = Number(e.target.value); state.page = 1; load(); },
          }, [25, 50, 100, 250, 500].map((n) => el('option', {
            value: n, selected: state.perPage === n,
          }, [`${n} / page`]))),
        ]),
        el('div', { class: 'pager' }, [
          pageButton('‹ Prev', page - 1, page <= 1),
          el('span', { class: 'page-of', text: `Page ${page} of ${pages}` }),
          pageButton('Next ›', page + 1, page >= pages),
        ]),
      ]);
    }

    // ---------------------------------------------------------------- CSV ---
    async function exportCsv() {
      try {
        const data = await Api.getJournal(projectId, { ...state, all: 1 });
        const keys = Object.keys(data.columns);
        const cell = (value) => {
          const text = value === null || value === undefined ? '' : String(value);
          return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        };
        const lines = [keys.map((k) => cell(data.columns[k])).join(',')];
        for (const row of data.rows) lines.push(keys.map((k) => cell(row[k])).join(','));

        // BOM so Excel opens the peso amounts and ñ in vendor names correctly.
        const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = el('a', { href: url, download: `${projectId}-journal.csv` });
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
      } catch (error) {
        resultBar.prepend(el('span', { class: 'v neg', text: error.message }));
      }
    }

    load();
    return { destroy() { clearTimeout(searchTimer); inFlight++; } };
  }

  return { create };
})();
