/* Dashboard: verdict, then the contract allocation rail, then the two lanes
   the verdict rests on — profit (accrual) and cash (liquidity) — then the
   detail behind each. Every figure is the workbook's, unchanged. */
const DashboardView = (() => {
  const { el, peso, pesoM, pct, pctSigned, date, month } = Fmt;

  function render(container, project, { onParamsSaved }) {
    Fmt.clear(container);
    Fmt.append(container, [
      verdict(project),
      allocationCard(project),
      lanes(project),
      el('div', { class: 'row row-2' }, [
        chartCard(project, 'flows'),
        chartCard(project, 'cumulative'),
      ]),
      el('div', { class: 'row row-2a' }, [
        // Thresholds tucks under the cost card, filling the space the taller
        // vendor list leaves beside it.
        el('div', { class: 'col' }, [
          costCompositionCard(project),
          paramsCard(project, onParamsSaved),
        ]),
        vendorCard(project),
      ]),
      monthlyCard(project),
      provenanceCard(project),
    ]);
  }

  // ------------------------------------------------------------- verdict ----
  function verdict(project) {
    const { meta, headline, profit, cashFlow, contract } = project;
    const { line, sub } = Parts.verdictText(project);
    const margin = headline.marginAtCompletion;
    const cash = headline.netCashFlow;

    const chip = (state, label, value, sub) => el('div', { class: `vchip is-${state}` }, [
      el('div', { class: 'vchip-lbl', text: label }),
      el('div', { class: 'vchip-val', text: value }),
      el('div', { class: 'vchip-sub' }, [el('span', { class: 'dot' }), sub]),
    ]);

    return el('section', { class: 'verdict' }, [
      el('div', {}, [
        el('div', { class: 'verdict-eyebrow', text: `Position at ${meta.lastDate ? date(meta.lastDate) : 'latest posting'}` }),
        el('h1', { class: 'verdict-line' }, line),
        el('p', { class: 'verdict-sub', text: sub }),
      ]),
      el('div', { class: 'verdict-chips' }, [
        chip(margin.pass ? 'pass' : 'fail', 'Margin at completion', pct(profit.estMargin),
          `${margin.pass ? 'Above' : 'Below'} ${pct(margin.threshold, 0)} floor`),
        chip(cash.pass ? 'pass' : 'fail', 'Net project cash', pesoM(cashFlow.netCash),
          `${cash.pass ? 'Covers' : 'Short of'} ${pesoM(cash.threshold)}`),
        chip('info', 'Billed of contract', pct(headline.pctBilled.value),
          `${pesoM(profit.revenue)} of ${pesoM(contract.tcv)}`),
      ]),
    ]);
  }

  // ---------------------------------------------------------- allocation ----
  function allocationCard(project) {
    const { meta, contract, profit, headline } = project;
    const committedShare = contract.tcv ? profit.posIssued / contract.tcv : 0;
    const gap = committedShare - headline.pctBilled.value;

    return el('section', { class: 'card' }, [
      cardHead('Where the contract is committed', 'Click any figure for its journal rows'),
      el('div', { class: 'card-bd' }, [
        Parts.allocation(project, { projectId: meta.id }),
        Parts.rails(project, { projectId: meta.id }),
        el('p', { class: 'alloc-note' }, [
          el('b', { text: pct(committedShare) }),
          ' of the contract is already committed to purchase orders, against ',
          el('b', { text: pct(headline.pctBilled.value) }),
          ' billed — a ',
          el('b', { text: pct(gap) }),
          ' gap the project funds itself until progress billings catch up. ',
          profit.posOpen > 0
            ? `${pesoM(profit.posOpen)} of those POs are still open and undelivered.`
            : 'All issued POs have been delivered.',
        ]),
      ]),
    ]);
  }

  // -------------------------------------------------------------- lanes ----
  function lanes(project) {
    const { meta, profit, contract, cashFlow } = project;
    const gauges = Parts.verdictGauges(project);
    const id = meta.id;

    const profitLane = el('section', { class: 'card lane profit' }, [
      el('div', { class: 'lane-hd' }, [
        el('span', { class: 'lane-mark', text: 'P' }),
        el('h2', { class: 'lane-title', text: 'Profitability — accrual view' }),
        el('span', { class: 'lane-sub', text: 'POs + non-PO cost' }),
      ]),
      el('div', { class: 'lane-bd' }, [
        gauges.margin,
        el('div', { class: 'ledger' }, [
          ledgerRow('Contract value (net of DP)', pesoM(contract.tcv), peso(contract.tcv),
            { id, trace: 'contract' }),
          ledgerRow('Committed to purchase orders', pesoM(profit.posIssued), peso(profit.posIssued),
            { swatch: 'var(--c-committed)', id, trace: 'committed' }),
          ledgerRow('of which open / undelivered', pesoM(profit.posOpen), peso(profit.posOpen),
            { sub: true, id, trace: 'committed_open' }),
          ledgerRow('Non-PO cost (payroll & JEs)', pesoM(profit.nonPoCost), peso(profit.nonPoCost),
            { swatch: 'var(--c-nonpo)', id, trace: 'nonpo' }),
          ledgerRow('Est. cost at completion', pesoM(profit.estCostAtCompletion),
            peso(profit.estCostAtCompletion), { total: true, id, trace: 'cost_at_completion' }),
          // Gross profit and margin variance are residuals — no rows to show.
          ledgerRow('Est. gross profit', pesoM(profit.estGrossProfit), peso(profit.estGrossProfit),
            { swatch: 'var(--c-profit)', tone: profit.estGrossProfit < 0 ? 'neg' : 'pos' }),
          ledgerRow('Margin variance vs plan', pctSigned(profit.marginVariance), null,
            { tone: profit.marginVariance < 0 ? 'neg' : 'pos' }),
        ]),
      ]),
    ]);

    const cashLane = el('section', { class: 'card lane cash' }, [
      el('div', { class: 'lane-hd' }, [
        el('span', { class: 'lane-mark', text: 'C' }),
        el('h2', { class: 'lane-title', text: 'Liquidity — cash view' }),
        el('span', { class: 'lane-sub', text: 'Bank movements' }),
      ]),
      el('div', { class: 'lane-bd' }, [
        gauges.cash,
        el('div', { class: 'ledger' }, [
          ledgerRow('Cash collected', pesoM(cashFlow.cashIn), peso(cashFlow.cashIn),
            { swatch: 'var(--c-collected)', id, trace: 'cash_in' }),
          ledgerRow('Cash disbursed', pesoM(cashFlow.cashOut), peso(cashFlow.cashOut),
            { swatch: 'var(--c-disbursed)', id, trace: 'cash_out' }),
          ledgerRow('Net project cash flow', pesoM(cashFlow.netCash), peso(cashFlow.netCash),
            { total: true, tone: cashFlow.netCash < 0 ? 'neg' : 'pos', id, trace: 'cash_net' }),
          // Derived from the saved threshold, not from journal rows.
          ledgerRow('Required (share of projected GP)', pesoM(cashFlow.required), peso(cashFlow.required)),
          ledgerRow('Retention receivable', pesoM(cashFlow.retention), peso(cashFlow.retention),
            { sub: true, id, trace: 'retention' }),
          ledgerRow('Customer advances — unapplied', pesoM(cashFlow.advances), peso(cashFlow.advances),
            { sub: true, id, trace: 'advances' }),
          ledgerRow('Materials delivered, in inventory', pesoM(profit.inventory), peso(profit.inventory),
            { sub: true, id, trace: 'inventory' }),
        ]),
      ]),
    ]);

    return el('div', { class: 'lanes' }, [profitLane, cashLane]);
  }

  function ledgerRow(label, value, title, opts = {}) {
    const body = [
      el('span', { class: `ledger-key${opts.sub ? ' sub' : ''}` }, [
        opts.swatch ? el('span', { class: 'ledger-swatch', style: `background:${opts.swatch}` }) : null,
        label,
      ]),
      el('span', { class: `ledger-val${opts.tone ? ' ' + opts.tone : ''}`, title: title || '', text: value }),
    ];
    const cls = `ledger-row${opts.total ? ' is-total' : ''}`;

    // Figures backed by journal rows become links to those rows; residuals stay
    // inert, so a link always leads somewhere that adds up.
    if (opts.id && opts.trace) {
      return el('a', {
        class: `${cls} is-trace`,
        href: Parts.traceHref(opts.id, opts.trace, { arg: opts.traceArg, month: opts.month }),
        title: 'Show the journal rows behind this figure',
      }, body);
    }
    return el('div', { class: cls }, body);
  }

  // -------------------------------------------------------------- charts ----
  function chartCard(project, kind) {
    const { monthly } = project;
    const labels = monthly.rows.map((r) => r.label);
    const inColor = Charts.cssVar('--c-collected', '#0d9488');
    const outColor = Charts.cssVar('--c-disbursed', '#ea580c');
    const costColor = Charts.cssVar('--c-committed', '#1a3a5c');
    const host = el('div');

    // Rendered after insertion so the tooltip can measure its container.
    queueMicrotask(() => {
      if (kind === 'flows') {
        Charts.columns(host, {
          labels, format: peso, label: 'Monthly cash in and cash out',
          series: [
            { name: 'Collected', color: inColor, values: monthly.rows.map((r) => r.cashIn) },
            { name: 'Disbursed', color: outColor, values: monthly.rows.map((r) => r.cashOut) },
            { name: 'Cost to P&L', color: costColor, values: monthly.rows.map((r) => r.cost) },
          ],
        });
      } else {
        Charts.line(host, {
          labels, values: monthly.rows.map((r) => r.cumulative),
          color: inColor, name: 'Cumulative net cash', format: peso,
          label: 'Cumulative net cash flow by month',
        });
      }
    });

    const spec = kind === 'flows'
      ? { title: 'Monthly rhythm', hint: 'Hover any bar for the exact amount', accent: 'var(--c-collected)',
          note: 'Cash movements are bank postings; cost to P&L is 5-series accounting postings, which is why they do not track each other.' }
      : { title: 'Running cash position', hint: 'Hover the line for any month', accent: 'var(--c-revenue)',
          note: 'Below the zero line the project is funding itself out of working capital.' };

    return el('section', { class: 'card card-chart', style: `--chart-accent:${spec.accent}` }, [
      cardHead(spec.title, spec.hint),
      el('div', { class: 'card-bd tight' }, [host, el('p', { class: 'chart-note', text: spec.note })]),
    ]);
  }

  // ---------------------------------------------------- cost composition ----
  function costCompositionCard({ meta, categories, profit }) {
    const rows = categories.rows.filter((r) => Math.abs(r.value) > 0.005);
    const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
    const COLORS = ['#1a3a5c', '#2563a8', '#0d9488', '#7c3aed', '#0284c7', '#62778f'];

    const compRow = (row, colour) => {
      const body = el('span', { class: 'comp-row-body' }, [
        el('span', { class: 'comp-lbl', title: row.label, text: row.label }),
        el('span', { class: 'comp-track' }, [
          el('span', {
            class: 'comp-fill',
            style: `width:${((Math.abs(row.value) / max) * 100).toFixed(1)}%;background:${colour}`,
          }),
        ]),
        el('span', { class: 'comp-val', title: peso(row.value), text: Fmt.pesoSmart(row.value) }),
      ]);
      // "All Other Costs" is the residual after the named categories, so there
      // is no single predicate that returns exactly those rows.
      if (row.label === 'All Other Costs') {
        return el('div', { class: 'comp-row' }, [body]);
      }
      return el('a', {
        class: 'comp-row is-trace',
        href: Parts.traceHref(meta.id, 'category', { arg: row.label.toUpperCase() }),
        title: `Show the ${row.label} postings`,
      }, [body]);
    };

    return el('section', { class: 'card' }, [
      cardHead('Cost charged to P&L', `${pesoM(profit.costToPL)} incurred to date`),
      el('div', { class: 'card-bd tight' }, [
        el('div', { class: 'comp' }, [
          ...rows.map((row, i) => compRow(row, COLORS[i % COLORS.length])),
          el('a', {
            class: 'comp-row is-total is-trace',
            href: Parts.traceHref(meta.id, 'cost_pl'),
            title: 'Show every 5-series accounting posting',
          }, [
            el('span', { class: 'comp-row-body' }, [
              el('span', { class: 'comp-lbl', text: 'Total charged to P&L' }),
              el('span', {}),
              el('span', { class: 'comp-val', title: peso(categories.total), text: pesoM(categories.total) }),
            ]),
          ]),
        ]),
        el('p', {
          class: 'chart-note',
          text: `Incurred cost only. ${pesoM(profit.inventory)} of delivered materials sits in inventory and is excluded, and ${pesoM(profit.posOpen)} of open POs has not been delivered at all.`,
        }),
      ]),
    ]);
  }

  // ------------------------------------------------------------- vendors ----
  function vendorCard({ meta, vendors, profit }) {
    if (!vendors.length) {
      return el('section', { class: 'card' }, [
        cardHead('Committed by vendor', 'No purchase orders'),
        el('div', { class: 'card-bd tight' }, [el('p', { class: 'chart-note', text: 'No purchase orders on this project.' })]),
      ]);
    }
    const max = Math.max(...vendors.map((v) => v.value));

    return el('section', { class: 'card' }, [
      cardHead('Committed by vendor', `Top ${vendors.length} of ${pesoM(profit.posIssued)}`),
      // `fill` lets the ranked rows take up the height difference against the
      // stacked column beside it, so the two end level.
      el('div', { class: 'card-bd tight fill' }, [
        el('div', { class: 'rank' }, vendors.map((v, i) => {
          const closed = Math.max(0, v.value - v.open);
          return el('a', {
            class: 'rank-row is-trace',
            href: Parts.traceHref(meta.id, 'vendor', { arg: v.label }),
            title: `Show the ${v.lines} purchase-order lines for this vendor`,
          }, [
            el('span', { class: 'rank-no', text: String(i + 1) }),
            el('span', { class: 'rank-main' }, [
              el('span', { class: 'rank-name', title: v.label, text: v.label }),
              el('span', { class: 'rank-bar', title: `${pesoM(v.open)} open of ${pesoM(v.value)}` }, [
                el('span', { class: 'rank-fill', style: `width:${((closed / max) * 100).toFixed(1)}%` }),
                el('span', { class: 'rank-fill open', style: `width:${((v.open / max) * 100).toFixed(1)}%` }),
              ]),
            ]),
            el('span', { class: 'rank-amt' }, [
              el('span', { class: 'a', title: peso(v.value), text: pesoM(v.value) }),
              el('span', { class: 'b', text: `${pesoM(v.open)} open` }),
            ]),
          ]);
        })),
        el('p', { class: 'chart-note', text: 'Darker segment is delivered or closed; lighter is still open.' }),
      ]),
    ]);
  }

  // -------------------------------------------------------- monthly table ----
  function monthlyCard({ meta, monthly }) {
    const head = ['Month', 'Cost to P&L', 'Collected', 'Disbursed', 'Net cash', 'Cumulative'];
    const id = meta.id;

    return el('section', { class: 'card' }, [
      cardHead('Month by month', 'Twelve months from project start · click a figure for its rows'),
      el('div', { class: 'card-bd flush' }, [
        el('div', { class: 'table-wrap' }, [
          el('table', { class: 'data' }, [
            el('thead', {}, [el('tr', {}, head.map((h, i) => el('th', { class: i ? 'n' : '', text: h })))]),
            el('tbody', {}, monthly.rows.map((r) => el('tr', {}, [
              el('td', { text: r.label }),
              money(r.cost, false, { id, trace: 'cost_pl', month: r.month }),
              money(r.cashIn, false, { id, trace: 'cash_in', month: r.month }),
              money(r.cashOut, false, { id, trace: 'cash_out', month: r.month }),
              money(r.net, true, { id, trace: 'cash_net', month: r.month }),
              // Cumulative spans every month up to this one, not a month's rows.
              money(r.cumulative, true),
            ]))),
            el('tfoot', {}, [el('tr', {}, [
              el('td', { text: 'TOTAL' }),
              money(monthly.total.cost, false, { id, trace: 'cost_pl' }),
              money(monthly.total.cashIn, false, { id, trace: 'cash_in' }),
              money(monthly.total.cashOut, false, { id, trace: 'cash_out' }),
              money(monthly.total.net, true, { id, trace: 'cash_net' }),
              money(monthly.total.cumulative, true),
            ])]),
          ]),
        ]),
      ]),
    ]);
  }

  function money(value, signed = false, link = null) {
    const n = Number(value) || 0;
    const cls = ['n', 'amt', n === 0 ? 'zero' : '', signed && n !== 0 ? (n > 0 ? 'pos' : 'neg') : '']
      .filter(Boolean).join(' ');
    const text = n === 0 ? Fmt.DASH : peso(n);
    // A zero cell has no rows behind it, so it stays plain text.
    if (!link || n === 0) {
      return el('td', { class: cls, text });
    }
    return el('td', { class: cls }, [
      el('a', {
        class: 'is-trace',
        href: Parts.traceHref(link.id, link.trace, { month: link.month }),
        title: 'Show the journal rows behind this figure',
        text,
      }),
    ]);
  }

  // ---------------------------------------------------------- provenance ----
  function provenanceCard({ meta, mix }) {
    const define = (term, body) => [el('dt', { text: term }), el('dd', {}, body)];

    return el('section', { class: 'card' }, [
      cardHead('How these figures are derived', `${meta.rowCount.toLocaleString()} journal lines`),
      el('div', { class: 'card-bd tight' }, [
        el('div', { class: 'prov' }, [
          el('dl', {}, [
            ...define('Contract', ['Non-canceled sales-order lines, less any line described as a down payment.']),
            ...define('Committed', ['Purchase orders issued, excluding canceled. Money the project is contractually on the hook for, whether or not it has been delivered or billed.']),
            ...define('Non-PO cost', ['5-series accounts booked through manual journal entries — payroll and similar.']),
            ...define('Cost to P&L', ['Accounting-group postings to accounts beginning with 5. Materials delivered but still in inventory (', el('code', { text: '11040401' }), ') are excluded.']),
            ...define('Revenue', ['Credits to ', el('code', { text: '41010101' }), ' in the Accounting group, shown positive.']),
            ...define('Cash', ['Postings whose account name contains “Cash in bank”. Positive amounts are inflows, negative are outflows.']),
            ...define('Retention', [el('code', { text: '11030300' }), ' receivable and ', el('code', { text: '21090103' }), ' unapplied customer advances.']),
          ]),
          el('p', { class: 'caveat' }, [
            'Estimated cost at completion counts only purchase orders already issued. If further POs are still expected, the realised margin will come in lower than shown.',
          ]),
          el('p', { class: 'source' }, [
            'Source: ', el('b', { text: meta.source || 'unknown' }),
            meta.importedAt ? ` · imported ${date(meta.importedAt.slice(0, 10))}` : '',
            meta.firstDate ? ` · covers ${month(meta.firstDate.slice(0, 7) + '-01')} to ${month(meta.lastDate.slice(0, 7) + '-01')}` : '',
            ` · ${mix.types.length} transaction types, ${mix.statuses.map((s) => `${s.count} ${s.label.toLowerCase()}`).join(', ')}.`,
          ]),
        ]),
      ]),
    ]);
  }

  // ---------------------------------------------------------- parameters ----
  function paramsCard(project, onParamsSaved) {
    const { params, cashFlow, contract } = project;
    const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });

    const field = (id, label, value) => {
      const input = el('input', {
        type: 'number', id, step: '0.5', min: '0', max: '95', value: (value * 100).toFixed(1),
      });
      return {
        input,
        node: el('div', { class: 'param-row' }, [
          el('label', { for: id, text: label }),
          el('div', { class: 'suffix' }, [input]),
        ]),
      };
    };

    const margin = field('p-margin', 'Projected margin', params.projectedMargin);
    const minMargin = field('p-min-margin', 'Minimum margin at completion', params.minMargin);
    const minCash = field('p-min-cash', 'Minimum net cash, as % of projected GP', params.minCashPctOfGP);
    const save = el('button', { class: 'btn btn-sm btn-primary', type: 'submit', text: 'Save floors' });

    const form = el('form', {
      class: 'params',
      onSubmit: async (event) => {
        event.preventDefault();
        save.disabled = true;
        status.className = 'form-status';
        status.textContent = 'Saving…';
        try {
          const body = await Api.saveParams(project.meta.id, {
            projectedMargin: Number(margin.input.value) / 100,
            minMargin: Number(minMargin.input.value) / 100,
            minCashPctOfGP: Number(minCash.input.value) / 100,
          });
          status.className = 'form-status ok';
          status.textContent = 'Saved.';
          onParamsSaved(body.project);
        } catch (error) {
          status.className = 'form-status error';
          status.textContent = error.message;
          save.disabled = false;
        }
      },
    }, [
      margin.node, minMargin.node, minCash.node,
      el('div', { class: 'ledger' }, [
        ledgerRow('Projected gross profit', pesoM(contract.projectedGrossProfit), peso(contract.projectedGrossProfit)),
        ledgerRow('Required net cash flow', pesoM(cashFlow.required), peso(cashFlow.required)),
      ]),
      el('div', { class: 'param-actions' }, [save, status]),
    ]);

    return el('section', { class: 'card' }, [
      cardHead('Thresholds', 'Saved per contract'),
      el('div', { class: 'card-bd tight' }, [
        el('p', { class: 'chart-note', style: 'margin:0 0 .8rem' , text:
          'These are the workbook’s manual inputs. They set the floors the verdict is judged against; they do not change any measured figure.' }),
        form,
      ]),
    ]);
  }

  function cardHead(title, hint) {
    return el('div', { class: 'card-hd' }, [
      el('h2', { text: title }),
      hint ? el('span', { class: 'hint', text: hint }) : null,
    ]);
  }

  return { render };
})();
