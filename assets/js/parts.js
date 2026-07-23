/* The three components that carry this system's domain. Shared, so a project
   card and its dashboard render the identical graphic at different sizes. */
const Parts = (() => {
  const { el, peso, pesoM, pct } = Fmt;

  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

  /**
   * Link to the journal rows a figure was computed from. The key names a
   * predicate defined server-side in Traces.php, next to the metric it
   * explains, so the rows shown always add up to the figure clicked.
   */
  function traceHref(projectId, trace, { arg = '', month = '' } = {}) {
    const query = new URLSearchParams({ trace });
    if (arg) query.set('traceArg', arg);
    if (month) query.set('month', month);
    return `#/p/${encodeURIComponent(projectId)}/journal?${query}`;
  }

  /** Wraps content in a drill-down link, or returns it untouched with no id. */
  function trace(projectId, key, content, { arg = '', month = '', title = '' } = {}) {
    if (!projectId || !key) return content;
    return el('a', {
      class: 'is-trace', href: traceHref(projectId, key, { arg, month }),
      title: title || 'Show the journal rows behind this figure',
    }, [content]);
  }

  // ------------------------------------------------------------ allocation ---
  /**
   * How the contract's money is spoken for.
   *
   * The bar is scaled to whichever is larger, the contract or the estimated
   * cost — so when cost overruns the contract the ceiling marker falls *inside*
   * the bar and the excess shows as a hatched tail. Scaling to the contract
   * alone would silently clip the overrun, which is the one case that matters
   * most.
   *
   * @param {object} project computed project payload
   * @param {{compact?: boolean}} [options]
   */
  function allocation(project, { compact = false, projectId = '' } = {}) {
    const { contract, profit } = project;
    const tcv = contract.tcv;
    const committed = Math.max(0, profit.posIssued);
    const nonPo = Math.max(0, profit.nonPoCost);
    const cost = profit.estCostAtCompletion;
    const gp = profit.estGrossProfit;
    const scale = Math.max(tcv, cost) || 1;
    const w = (v) => `${(clamp01(v / scale) * 100).toFixed(2)}%`;

    const segments = [
      { cls: 'seg-committed', value: committed, label: 'Committed to POs', key: 'committed',
        color: 'var(--c-committed)', note: 'Purchase orders issued, excluding canceled' },
      { cls: 'seg-nonpo', value: nonPo, label: 'Non-PO cost', key: 'nonpo',
        color: 'var(--c-nonpo)', note: 'Payroll and manual journal entries' },
    ];
    if (gp >= 0) {
      // No trace: gross profit is a residual, not a set of rows.
      segments.push({ cls: 'seg-profit', value: gp, label: 'Est. gross profit',
        color: 'var(--c-profit)', note: 'Contract value less estimated cost' });
    } else {
      segments.push({ cls: 'seg-overrun', value: -gp, label: 'Forecast overrun',
        color: 'var(--c-overrun)', note: 'Estimated cost above the contract value' });
    }

    const bar = el('div', { class: 'alloc-bar', role: 'img',
      'aria-label': `Contract ${peso(tcv)} allocated as ` +
        segments.map((s) => `${s.label} ${peso(s.value)}`).join(', ') },
      segments.map((s) => {
        const share = s.value / scale;
        return el('div', {
          class: `alloc-seg ${s.cls}`, style: `width:${w(s.value)}`,
          title: `${s.label}: ${peso(s.value)} (${pct(s.value / (tcv || 1))} of contract)`,
        // A label only goes inside a segment wide enough to hold it.
        }, [share > (compact ? 0.16 : 0.11) ? el('span', { text: pct(s.value / (tcv || 1), 0) }) : null]);
      }));

    // The ceiling marker only earns its place when cost has passed the contract.
    // Otherwise it lands exactly on the bar's right edge, where it says nothing
    // the scale line above has not already said — and its label collides with it.
    if (cost > tcv) {
      bar.appendChild(el('div', {
        class: 'alloc-ceiling',
        style: `left:${(clamp01(tcv / scale) * 100).toFixed(2)}%`,
        'data-label': compact ? '' : `Contract ${pesoM(tcv)}`,
      }));
    }

    const parts = [
      compact ? null : el('div', { class: 'alloc-scale' }, [
        el('span', {}, ['Contract value ', el('b', { text: pesoM(tcv) })]),
        el('span', {}, [`Est. cost at completion ${pesoM(cost)} · ${pct(cost / (tcv || 1))} of contract`]),
      ]),
      bar,
      el('ul', { class: 'alloc-legend' }, segments.map((s) => {
        const body = [
          el('span', { class: 'key', style: `background:${s.color}` }),
          el('b', { text: s.label }),
          el('span', { class: 'v', text: pesoM(s.value) }),
          el('span', { class: 'p', text: pct(s.value / (tcv || 1)) }),
        ];
        const content = projectId && s.key
          ? el('a', {
              class: 'legend-item is-trace',
              href: traceHref(projectId, s.key),
              title: 'Show the journal rows behind this figure',
            }, body)
          : el('span', { class: 'legend-item' }, body);
        return el('li', { title: s.note }, [content]);
      })),
    ];
    return el('div', { class: 'alloc' }, parts);
  }

  /** Billing and cash, plotted on the allocation bar's own axis. */
  function rails(project, { projectId = '' } = {}) {
    const { contract, profit, cashFlow } = project;
    const tcv = contract.tcv || 1;
    const scale = Math.max(contract.tcv, profit.estCostAtCompletion) || 1;

    const rail = (label, value, color, key, note) => {
      const body = [
        el('span', { class: 'rail-label', text: label }),
        el('span', { class: 'rail-track' }, [
          el('span', { class: 'rail-fill', style: `width:${(clamp01(value / scale) * 100).toFixed(2)}%;background:${color}` }),
        ]),
        el('span', { class: 'rail-val' }, [
          pesoM(value), el('span', { class: 'rail-pct', text: pct(value / tcv) }),
        ]),
      ];
      // The link *is* the rail row, so it inherits the grid rather than nesting
      // a second layout box inside it.
      return projectId
        ? el('a', {
            class: 'alloc-rail is-trace', title: note,
            href: traceHref(projectId, key),
          }, body)
        : el('div', { class: 'alloc-rail', title: note }, body);
    };

    return el('div', { class: 'alloc-rails' }, [
      rail('Revenue billed', profit.revenue, 'var(--c-revenue)', 'revenue',
        'Revenue recognised against account 41010101'),
      rail('Cash collected', cashFlow.cashIn, 'var(--c-collected)', 'cash_in',
        'Inflows to cash-in-bank accounts'),
      rail('Cash disbursed', cashFlow.cashOut, 'var(--c-disbursed)', 'cash_out',
        'Outflows from cash-in-bank accounts'),
    ]);
  }

  // ----------------------------------------------------------------- gauge ---
  /**
   * A value against a threshold, on a scale that always shows both plus zero
   * when the value is negative. Returns the element; the caller supplies the
   * formatter so the same component serves percentages and pesos.
   *
   * @param {{label:string, value:number, target:number, pass:boolean,
   *          format:(n:number)=>string, delta:string, note?:string}} spec
   */
  function gauge(spec) {
    const { label, value, target, pass, format, delta, note } = spec;

    // Domain covers zero, the value and the target, with headroom so the target
    // tick never sits flush against an edge.
    const lo = Math.min(0, value, target) * 1.08;
    const hi = Math.max(0, value, target) * 1.08 || 1;
    const span = hi - lo || 1;
    const at = (v) => ((v - lo) / span) * 100;

    const zero = at(0);
    const valuePos = at(value);
    const targetPos = at(target);
    const left = Math.min(zero, valuePos);
    const width = Math.abs(valuePos - zero);

    const targetClass = targetPos > 92 ? ' at-end' : targetPos < 8 ? ' at-start' : '';

    return el('div', { class: 'gauge', title: note || '' }, [
      el('div', { class: 'gauge-hd' }, [
        el('span', { class: 'gauge-label', text: label }),
        el('span', { class: `gauge-delta ${pass ? 'is-pass' : 'is-fail'}`, text: delta }),
      ]),
      el('div', { class: `gauge-value ${pass ? 'is-pass' : 'is-fail'}`, text: format(value) }),
      el('div', { class: 'gauge-track' }, [
        lo < 0 ? el('div', { class: 'gauge-zero', style: `left:${zero.toFixed(2)}%` }) : null,
        el('div', {
          class: `gauge-fill ${pass ? 'is-pass' : 'is-fail'}`,
          style: `left:${left.toFixed(2)}%;width:${width.toFixed(2)}%`,
        }),
        el('div', {
          class: `gauge-target${targetClass}`,
          style: `left:${targetPos.toFixed(2)}%`,
          'data-label': `Floor ${format(target)}`,
        }),
      ]),
      el('div', { class: 'gauge-foot' }, [
        el('span', { text: format(lo) }),
        el('span', { text: format(hi) }),
      ]),
    ]);
  }

  /** The two gauges every view leads with, built from one project payload. */
  function verdictGauges(project) {
    const { headline, profit, cashFlow } = project;
    const margin = headline.marginAtCompletion;
    const cash = headline.netCashFlow;
    const points = (profit.estMargin - margin.threshold) * 100;
    const short = cashFlow.netCash - cash.threshold;

    return {
      margin: gauge({
        label: 'Margin at completion',
        value: profit.estMargin, target: margin.threshold, pass: margin.pass,
        format: (v) => pct(v),
        delta: `${points >= 0 ? '+' : ''}${points.toFixed(1)} pts`,
        note: 'Estimated gross profit divided by contract value, against the minimum margin',
      }),
      cash: gauge({
        label: 'Net cash vs required',
        value: cashFlow.netCash, target: cash.threshold, pass: cash.pass,
        // dashZero off: an axis bound of zero must read as an amount, not "–".
        format: (v) => pesoM(v, { dashZero: false }),
        delta: `${short >= 0 ? '+' : ''}${pesoM(short)}`,
        note: 'Collections less disbursements, against the required share of projected gross profit',
      }),
    };
  }

  // --------------------------------------------------------------- verdict ---
  /**
   * Plain-language reading of the two tests. Profit and cash can disagree, and
   * naming which one fails is the whole point of the banner.
   */
  function verdictText(project) {
    const { headline, profit, contract, cashFlow } = project;
    const marginPass = headline.marginAtCompletion.pass;
    const cashPass = headline.netCashFlow.pass;
    const committedShare = contract.tcv ? profit.posIssued / contract.tcv : 0;
    const billedShare = headline.pctBilled.value;

    let line;
    if (marginPass && cashPass) {
      line = ['Profitable and funded.'];
    } else if (marginPass && !cashPass) {
      line = ['Profitable on paper, ', el('em', { text: 'short on cash' }), '.'];
    } else if (!marginPass && cashPass) {
      line = ['Cash is holding, but the ', el('em', { text: 'margin is below target' }), '.'];
    } else {
      line = ['Below target on ', el('em', { text: 'both margin and cash' }), '.'];
    }

    const gap = committedShare - billedShare;
    const sub = marginPass && cashPass
      ? `Margin is ${pct(profit.estMargin)} against a ${pct(headline.marginAtCompletion.threshold, 0)} floor, and net cash covers the ${pesoM(cashFlow.required)} requirement.`
      : !cashPass && marginPass
        ? `Margin holds at ${pct(profit.estMargin)}, but only ${pesoM(cashFlow.netCash)} of the ${pesoM(cashFlow.required)} cash requirement is in hand. ${pct(committedShare)} of the contract is committed to purchase orders while just ${pct(billedShare)} has been billed — a ${pct(gap)} funding gap the project is carrying itself.`
        : `Estimated cost at completion is ${pesoM(profit.estCostAtCompletion)} against a ${pesoM(contract.tcv)} contract. ${pct(committedShare)} is already committed to purchase orders and ${pct(billedShare)} has been billed.`;

    return { line, sub };
  }

  return { allocation, rails, gauge, verdictGauges, verdictText, clamp01, trace, traceHref };
})();
