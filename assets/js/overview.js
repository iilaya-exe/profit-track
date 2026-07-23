/* Portfolio: the portfolio's own position first, then a calm index of the
   contracts inside it.

   The band at the top is the dashboard's allocation graphic applied to every
   contract at once — the same bar, the same colours, the same meaning. Each
   figure it sums is additive across projects (contract value, committed cost,
   non-PO cost, gross profit, cash in and out), so the portfolio reads exactly
   like one large project and nothing has to be re-explained.

   Cards below identify a contract and nothing more. The analysis is one click
   away on its dashboard; the portfolio's job is to let you find it. */
const OverviewView = (() => {
  const { el, pesoM, pct, month, number } = Fmt;

  /** Grid state lives here so typing in the search box re-renders only the
      grid, not the portfolio band above it. */
  let filter = '';
  let sort = 'name';
  /** Told when a project's icon changes, so the shell can refresh its caches. */
  let iconSaved = () => {};

  function render(container, projects, { onOpen, onIconChanged = () => {} }) {
    Fmt.clear(container);
    filter = '';
    sort = 'name';
    iconSaved = onIconChanged;

    const atRisk = projects.filter((p) => !p.headline.marginAtCompletion.pass || !p.headline.netCashFlow.pass);

    container.appendChild(hero(projects, atRisk));

    if (!projects.length) {
      container.appendChild(el('div', { class: 'empty-state' }, [
        el('h2', { text: 'No contracts loaded' }),
        el('p', { text: 'Import a Transaction Journal Report (.xlsx) to get started.' }),
      ]));
      return;
    }

    container.appendChild(positionCard(projects));

    const grid = el('div', { class: 'project-grid' });
    const draw = () => {
      Fmt.clear(grid);
      const shown = arrange(projects);
      if (!shown.length) {
        grid.appendChild(el('p', { class: 'grid-empty', text: `No contract matches “${filter}”.` }));
        return;
      }
      shown.forEach((project) => grid.appendChild(card(project, onOpen)));
    };

    container.appendChild(gridToolbar(projects, draw));
    container.appendChild(grid);
    draw();
  }

  // ------------------------------------------------------------------ hero ---
  function hero(projects, atRisk) {
    const lines = projects.reduce((total, p) => total + p.meta.rowCount, 0);

    return el('div', { class: 'page-hero' }, [
      el('div', {}, [
        el('h1', { class: 'page-title', text: 'Contract Portfolio' }),
        el('div', {
          class: 'page-sub',
          text: projects.length
            ? `${projects.length} contract${projects.length === 1 ? '' : 's'} under management. ` +
              (atRisk.length
                ? `${atRisk.length} below a profitability or liquidity floor.`
                : 'All within their margin and cash floors.')
            : 'No contracts loaded.',
        }),
      ]),
      projects.length ? el('div', { class: 'hero-meta' }, [
        el('span', { class: `badge ${atRisk.length ? 'warn' : 'ok'}` }, [
          el('span', { class: 'dot' }),
          atRisk.length ? `${atRisk.length} need${atRisk.length === 1 ? 's' : ''} attention` : 'All on track',
        ]),
        el('span', { class: 'hero-meta-sep' }),
        el('span', { class: 'hero-meta-txt', text: coverage(projects) }),
        el('span', { class: 'hero-meta-sep' }),
        el('span', { class: 'hero-meta-txt', text: `${number(lines)} journal lines` }),
      ]) : null,
    ]);
  }

  /** The months the portfolio's journals span end to end. */
  function coverage(projects) {
    const first = projects.map((p) => p.meta.firstDate).filter(Boolean).sort()[0];
    const last = projects.map((p) => p.meta.lastDate).filter(Boolean).sort().pop();
    if (!first) return 'No journal dates';
    return monthRange(first, last);
  }

  // -------------------------------------------------------- portfolio band ---
  /**
   * Every contract as one. The totals strip is colour-keyed to the allocation
   * bar under it, so a reader can move between the number and the shape it
   * makes without a legend lookup.
   */
  function positionCard(projects) {
    const total = aggregate(projects);
    const { contract, profit, cashFlow } = total;
    const tcv = contract.tcv || 1;
    const committedShare = profit.posIssued / tcv;
    const billedShare = profit.revenue / tcv;

    const cell = (label, value, sub, key, tone) => el('div', { class: 'stat-cell', style: `--k:${key}` }, [
      el('div', { class: 'stat-lbl', text: label }),
      el('div', { class: `stat-val${tone ? ' ' + tone : ''}`, text: value }),
      el('div', { class: 'stat-sub', text: sub }),
    ]);

    return el('section', { class: 'card port-card' }, [
      el('div', { class: 'card-hd' }, [
        el('h2', { text: 'Portfolio position' }),
        el('span', { class: 'hint', text: 'Every contract combined' }),
      ]),
      el('div', { class: 'stat-strip' }, [
        cell('Contract value', pesoM(contract.tcv),
          `${projects.length} contract${projects.length === 1 ? '' : 's'} under management`,
          'var(--text)'),
        cell('Committed to POs', pesoM(profit.posIssued),
          `${pct(committedShare)} of contract value`, 'var(--c-committed)'),
        cell('Revenue billed', pesoM(profit.revenue),
          `${pct(billedShare)} of contract value`, 'var(--c-revenue)'),
        cell('Est. gross profit', pesoM(profit.estGrossProfit),
          `${pct(profit.estGrossProfit / tcv)} blended margin`, 'var(--c-profit)',
          profit.estGrossProfit < 0 ? 'neg' : null),
        cell('Net cash position', pesoM(cashFlow.netCash), 'Collections less disbursements',
          cashFlow.netCash < 0 ? 'var(--c-disbursed)' : 'var(--c-collected)',
          cashFlow.netCash < 0 ? 'neg' : 'pos'),
      ]),
      el('div', { class: 'card-bd' }, [
        // No projectId: a portfolio figure has no single journal to drill into.
        Parts.allocation(total),
        Parts.rails(total),
        el('p', { class: 'alloc-note' }, [
          el('b', { text: pct(committedShare) }),
          ' of the portfolio is committed to purchase orders against ',
          el('b', { text: pct(billedShare) }),
          ' billed — a ',
          el('b', { text: pct(committedShare - billedShare) }),
          ' funding gap carried across every contract. ',
          profit.posOpen > 0
            ? `${pesoM(profit.posOpen)} of those purchase orders are still open and undelivered.`
            : 'All issued purchase orders have been delivered.',
        ]),
      ]),
    ]);
  }

  /**
   * Sum the portfolio into the shape one project has, so the shared allocation
   * components render it unchanged. Every field here is additive; nothing is
   * averaged. Blended margin is derived from the two sums, not from a mean of
   * the projects' margins, which would weight a small contract like a large one.
   */
  function aggregate(projects) {
    const sum = (pick) => projects.reduce((total, p) => total + pick(p), 0);
    return {
      contract: { tcv: sum((p) => p.contract.tcv) },
      profit: {
        revenue: sum((p) => p.profit.revenue),
        posIssued: sum((p) => p.profit.posIssued),
        posOpen: sum((p) => p.profit.posOpen),
        nonPoCost: sum((p) => p.profit.nonPoCost),
        estCostAtCompletion: sum((p) => p.profit.estCostAtCompletion),
        estGrossProfit: sum((p) => p.profit.estGrossProfit),
      },
      cashFlow: {
        cashIn: sum((p) => p.cashFlow.cashIn),
        cashOut: sum((p) => p.cashFlow.cashOut),
        netCash: sum((p) => p.cashFlow.netCash),
      },
    };
  }

  // ------------------------------------------------------------- the index ---
  function gridToolbar(projects, draw) {
    const count = el('span', { class: 'count-pill', text: String(projects.length) });

    const search = el('input', {
      type: 'search', placeholder: 'Search name, client or code…',
      'aria-label': 'Search contracts',
      onInput: (event) => {
        filter = event.target.value.trim();
        count.textContent = String(arrange(projects).length);
        draw();
      },
    });

    const select = el('select', {
      'aria-label': 'Sort contracts',
      onChange: (event) => { sort = event.target.value; draw(); },
    }, [
      el('option', { value: 'name', text: 'Name (A–Z)' }),
      el('option', { value: 'value', text: 'Contract value' }),
      el('option', { value: 'recent', text: 'Recent activity' }),
    ]);

    return el('div', { class: 'grid-toolbar' }, [
      el('div', { class: 'grid-toolbar-hd' }, [
        el('h2', { class: 'section-title', text: 'Contracts' }),
        count,
      ]),
      el('div', { class: 'grid-toolbar-controls' }, [
        el('div', { class: 'search-field' }, [
          el('span', { class: 'search-icon', 'aria-hidden': 'true',
            html: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>' }),
          search,
        ]),
        select,
      ]),
    ]);
  }

  /** Filter then order. Search covers the three fields the cards actually show. */
  function arrange(projects) {
    const needle = filter.toLowerCase();
    const shown = needle
      ? projects.filter(({ meta }) => [meta.name, meta.client, meta.code]
          .some((field) => String(field || '').toLowerCase().includes(needle)))
      : projects.slice();

    if (sort === 'value') shown.sort((a, b) => b.contract.tcv - a.contract.tcv);
    else if (sort === 'recent') shown.sort((a, b) => String(b.meta.lastDate).localeCompare(String(a.meta.lastDate)));
    else shown.sort((a, b) => a.meta.name.localeCompare(b.meta.name));
    return shown;
  }

  /**
   * An index card: what the contract is called, who it is for, its code and the
   * journal period it covers. Nothing to interpret — the analysis is one click
   * away on the dashboard.
   */
  function card(project, onOpen) {
    const { meta } = project;
    const open = () => onOpen(meta.id, 'dashboard');
    const colour = identityColour(meta.code);

    const field = (label, value) => el('div', { class: 'pcard-field' }, [
      el('dt', { text: label }),
      el('dd', { text: value }),
    ]);

    const mark = el('span', { class: 'pcard-mark', 'aria-hidden': 'true' });
    const drawMark = () => {
      Fmt.clear(mark);
      mark.classList.toggle('has-logo', Boolean(meta.logo));
      mark.appendChild(meta.logo
        ? el('img', { src: meta.logo, alt: '' })
        : el('span', { class: 'pcard-monogram', text: initials(meta.name) }));
    };
    drawMark();

    return el('div', {
      class: 'pcard',
      style: `--id:${colour}`,
      role: 'button', tabindex: '0', 'aria-label': `Open ${meta.name}`,
      onClick: open,
      onKeydown: (event) => {
        // Only when the card itself has focus — the icon button inside it is a
        // control of its own and its Enter/Space must not also open the project.
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); }
      },
    }, [
      el('div', { class: 'pcard-brand' }, [
        el('span', { class: 'pcard-identity' }, [
          mark,
          el('button', {
            class: 'pcard-mark-edit', type: 'button',
            title: 'Change this project’s icon',
            'aria-label': `Change the icon for ${meta.name}`,
            onClick: (event) => {
              event.stopPropagation();   // the card underneath opens the project
              openIconEditor(meta, drawMark);
            },
          }, [el('span', { 'aria-hidden': 'true', html: PENCIL_SVG })]),
        ]),
      ]),
      el('div', { class: 'pcard-body' }, [
        // Titled as well as written: the card clamps a very long name to three
        // lines, and the tooltip is where the rest of it stays reachable.
        el('h2', { class: 'pcard-name', title: meta.name, text: meta.name }),
        el('dl', { class: 'pcard-fields' }, [
          field('Client', meta.client || '—'),
          field('Project code', meta.code),
          field('SAP journal', journalRange(meta)),
        ]),
        // The card is a button; this says so, since nothing else on it does.
        el('div', { class: 'pcard-foot' }, [
          el('span', { text: 'Open dashboard' }),
          el('span', { class: 'pcard-go', 'aria-hidden': 'true',
            html: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h13"/><path d="M12 5l7 7-7 7"/></svg>' }),
        ]),
      ]),
    ]);
  }

  /* ---- the icon editor ---------------------------------------------------
     One dialog, built once and reused by every card. The picked image is
     squared and downsized to 256px in the browser before it is sent, so what
     reaches the server is always a small raster of a known type — the upload
     never carries the original file, its size, or its format.
     ------------------------------------------------------------------- */

  const PENCIL_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';

  const ICON_PX = 256;
  const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif';

  let editor = null;

  function openIconEditor(meta, redraw) {
    editor ??= buildIconEditor();
    editor.open(meta, redraw);
  }

  function buildIconEditor() {
    let target = null;        // the meta being edited
    let redraw = () => {};

    const preview = el('span', { class: 'icon-preview' });
    const subject = el('div', { class: 'icon-subject' });
    const status = el('p', { class: 'form-status', role: 'status', 'aria-live': 'polite' });
    const file = el('input', { type: 'file', accept: ACCEPT, hidden: true });

    const zone = el('label', { class: 'dropzone' }, [
      file,
      el('span', { class: 'dropzone-title', text: 'Choose an image or drop it here' }),
      el('span', { class: 'dropzone-note',
        text: `PNG, JPEG or WebP — squared and resized to ${ICON_PX}px before it is saved` }),
    ]);

    const reset = el('button', {
      class: 'btn', type: 'button', text: 'Use default monogram',
      onClick: () => save(() => Api.clearLogo(target.id), 'Icon reset to the monogram.'),
    });

    const dialog = el('dialog', { class: 'modal icon-modal', 'aria-labelledby': 'icon-title' }, [
      el('form', { method: 'dialog', class: 'modal-head' }, [
        el('h2', { id: 'icon-title', text: 'Project icon' }),
        el('button', { class: 'btn', value: 'close', 'aria-label': 'Close', html: '&times;' }),
      ]),
      el('div', { class: 'modal-body' }, [
        el('div', { class: 'icon-current' }, [preview, subject]),
        zone,
        el('div', { class: 'icon-actions' }, [
          reset,
          el('form', { method: 'dialog' }, [el('button', { class: 'btn btn-primary', value: 'done', text: 'Done' })]),
        ]),
        status,
      ]),
    ]);
    document.body.appendChild(dialog);

    file.addEventListener('change', () => {
      if (file.files[0]) accept(file.files[0]);
    });
    for (const type of ['dragenter', 'dragover']) {
      zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.add('is-over'); });
    }
    for (const type of ['dragleave', 'drop']) {
      zone.addEventListener(type, (event) => { event.preventDefault(); zone.classList.remove('is-over'); });
    }
    zone.addEventListener('drop', (event) => {
      const dropped = event.dataTransfer?.files?.[0];
      if (dropped) accept(dropped);
    });

    function drawPreview() {
      Fmt.clear(preview);
      preview.classList.toggle('has-logo', Boolean(target.logo));
      preview.style.setProperty('--id', identityColour(target.code));
      preview.appendChild(target.logo
        ? el('img', { src: target.logo, alt: '' })
        : el('span', { class: 'pcard-monogram', text: initials(target.name) }));
      reset.disabled = !target.logo;
    }

    async function accept(picked) {
      if (!picked.type.startsWith('image/')) {
        return fail(new Error(`${picked.name} is not an image.`));
      }
      status.className = 'form-status';
      status.textContent = `Preparing ${picked.name}…`;
      let dataUrl;
      try {
        dataUrl = await squareDataUrl(picked);
      } catch {
        return fail(new Error(`${picked.name} could not be read as an image.`));
      } finally {
        file.value = '';   // so picking the same file twice still fires change
      }
      save(() => Api.saveLogo(target.id, dataUrl), 'Icon updated.');
    }

    async function save(call, done) {
      status.className = 'form-status';
      status.textContent = 'Saving…';
      try {
        const { project } = await call();
        target.logo = project.meta.logo;
        drawPreview();
        redraw();
        iconSaved(target.id, project);
        status.className = 'form-status ok';
        status.textContent = done;
      } catch (error) {
        fail(error);
      }
    }

    function fail(error) {
      status.className = 'form-status error';
      status.textContent = error.message;
    }

    return {
      open(meta, onRedraw) {
        target = meta;
        redraw = onRedraw;
        status.className = 'form-status';
        status.textContent = '';
        Fmt.clear(subject);
        Fmt.append(subject, [
          el('b', { text: meta.name }),
          el('span', { text: meta.code }),
        ]);
        drawPreview();
        dialog.showModal();
      },
    };
  }

  /**
   * Centre-fit the image on a transparent square. Fitting rather than cropping:
   * a logo says what it says only when all of it is there, and a wordmark that
   * has had its ends cut off identifies nothing.
   */
  async function squareDataUrl(picked) {
    const bitmap = await createImageBitmap(picked);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = ICON_PX;
    const ctx = canvas.getContext('2d');
    const scale = Math.min(ICON_PX / bitmap.width, ICON_PX / bitmap.height);
    const w = bitmap.width * scale;
    const h = bitmap.height * scale;
    ctx.drawImage(bitmap, (ICON_PX - w) / 2, (ICON_PX - h) / 2, w, h);
    bitmap.close?.();

    // WebP keeps the transparency a logo usually depends on and is far smaller
    // than PNG; toDataURL falls back to PNG on its own where it is unsupported.
    const webp = canvas.toDataURL('image/webp', 0.92);
    return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/png');
  }

  /* ---- project identity -------------------------------------------------
     Each contract gets a stable colour and monogram so the eye can tell cards
     apart before reading a word of them. Both derive from the project code,
     which never changes, so a project keeps the same face across sessions,
     machines and re-imports.
     ------------------------------------------------------------------- */

  /** Deep enough for white monogram text at 4.5:1 or better. */
  const IDENTITY_COLOURS = [
    '#1a3a5c', '#0f766e', '#7c3aed', '#b45309',
    '#0369a1', '#be123c', '#166534', '#4338ca',
  ];

  function identityColour(code) {
    let hash = 0;
    for (let i = 0; i < code.length; i++) {
      hash = (Math.imul(hash, 31) + code.charCodeAt(i)) >>> 0;
    }
    return IDENTITY_COLOURS[hash % IDENTITY_COLOURS.length];
  }

  /** Words that identify no project, so they never reach the monogram. */
  const NOISE = new Set(['THE', 'AND', 'OF', 'FOR', 'INC', 'CORP', 'CORPORATION',
                         'LTD', 'CO', 'COMPANY', 'PROJECT', 'PROJECTS']);

  function initials(name) {
    const words = String(name)
      .replace(/\(.*?\)/g, ' ')        // parenthetical scope describes work, not identity
      .split(/[^A-Za-z0-9]+/)
      .filter((w) => w.length > 1 && !NOISE.has(w.toUpperCase()));
    if (!words.length) return '#';
    return words.slice(0, 2).map((w) => w[0].toUpperCase()).join('');
  }

  /** "Feb 2026 – Jul 2026", the same phrasing the workbook's title band used. */
  function journalRange(meta) {
    if (!meta.firstDate) return '—';
    return monthRange(meta.firstDate, meta.lastDate);
  }

  function monthRange(firstIso, lastIso) {
    const from = month(`${String(firstIso).slice(0, 7)}-01`);
    const to = month(`${String(lastIso).slice(0, 7)}-01`);
    return from === to ? from : `${from} – ${to}`;
  }

  return { render };
})();
