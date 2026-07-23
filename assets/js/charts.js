/* Inline-SVG charts. No libraries, no external requests.
 *
 * Mark specs follow the data-viz reference: bars capped at 24px with a 4px
 * rounded data-end squared at the baseline, 2px lines, >=8px markers carrying a
 * 2px surface ring, a 2px surface gap between adjacent bars, hairline gridlines,
 * and selective direct labels. Series colours are the reference palette's
 * slots 1-2, read from CSS custom properties so both themes track the toggle.
 */
const Charts = (() => {
  const { svg, el, clear } = Fmt;

  const BAR_MAX = 24;   // cap bar thickness; the band's leftover is air
  const BAR_GAP = 2;    // surface gap between adjacent bars
  const RADIUS  = 4;    // rounded data-end
  const RING    = 2;    // surface ring on dots

  // ------------------------------------------------------------- scaling ---
  /** A tick step that lands on 1/2/2.5/5 x 10^n so labels read as round numbers. */
  function niceStep(rough) {
    const power = Math.pow(10, Math.floor(Math.log10(rough)));
    const scaled = rough / power;
    const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 2.5 ? 2.5 : scaled <= 5 ? 5 : 10;
    return step * power;
  }

  /** Domain + ticks that always include zero, so bar lengths stay honest. */
  function scale(values, targetTicks = 5) {
    const finite = values.filter((v) => Number.isFinite(v));
    let min = Math.min(0, ...finite);
    let max = Math.max(0, ...finite);
    if (min === max) max = min + 1;
    const step = niceStep((max - min) / targetTicks);
    min = Math.floor(min / step) * step;
    max = Math.ceil(max / step) * step;
    const ticks = [];
    // Accumulate with a rounded guard so float drift never emits 1.9999999.
    for (let t = min; t <= max + step / 2; t += step) ticks.push(Math.round(t / step) * step);
    return { min, max, ticks };
  }

  /** Rounded data-end on the growing side; square where the mark meets the baseline. */
  function barPath(x, y, w, h, roundTop) {
    const r = Math.min(RADIUS, w / 2, h);
    if (h <= 0.01) return `M${x},${y}h${w}`;
    return roundTop
      ? `M${x},${y + h}V${y + r}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}V${y + h}Z`
      : `M${x},${y}V${y + h - r}a${r},${r} 0 0 0 ${r},${r}h${w - 2 * r}a${r},${r} 0 0 0 ${r},${-r}V${y}Z`;
  }

  function cssVar(name, fallback) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return value || fallback;
  }

  // ------------------------------------------------------------ tooltips ---
  function tooltip(container) {
    const node = el('div', { class: 'chart-tip', role: 'status' });
    container.appendChild(node);
    let raf = 0;

    return {
      show(html, clientX, clientY) {
        node.innerHTML = html;
        node.classList.add('is-visible');
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          const box = container.getBoundingClientRect();
          const tip = node.getBoundingClientRect();
          // Keep the tip inside the chart box; flip above the cursor near the bottom.
          let x = clientX - box.left + 14;
          let y = clientY - box.top + 14;
          if (x + tip.width > box.width) x = Math.max(0, clientX - box.left - tip.width - 14);
          if (y + tip.height > box.height) y = Math.max(0, clientY - box.top - tip.height - 14);
          node.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        });
      },
      hide() { node.classList.remove('is-visible'); },
    };
  }

  function tipMarkup(title, rows) {
    const body = rows.map(({ label, value, color }) => `
      <dt><span class="swatch" style="background:${color || 'transparent'}"></span><span>${escape(label)}</span></dt>
      <dd class="val">${escape(value)}</dd>`).join('');
    return `<h4>${escape(title)}</h4><dl>${body}</dl>`;
  }

  function escape(value) {
    return String(value).replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  function legend(series) {
    // A single series needs no legend box: the panel title already names it.
    if (series.length < 2) return null;
    return el('ul', { class: 'chart-legend' }, series.map((s) => el('li', {}, [
      el('span', { class: `legend-key${s.kind === 'line' ? ' line' : ''}`, style: `background:${s.color}` }),
      s.name,
    ])));
  }

  // ------------------------------------------------- grouped column chart ---
  /**
   * @param {{labels:string[], series:{name:string,color:string,values:number[]}[],
   *          format:(n:number)=>string, axisFormat?:(n:number)=>string, label?:string}} spec
   */
  function columns(container, spec) {
    clear(container);
    container.classList.add('chart');
    const { labels, series, format, axisFormat = Fmt.pesoAxis } = spec;

    const W = 760, H = 330;
    const M = { top: 16, right: 12, bottom: 34, left: 66 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;

    const all = series.flatMap((s) => s.values);
    const { min, max, ticks } = scale(all);
    const y = (v) => M.top + plotH - ((v - min) / (max - min)) * plotH;
    const zeroY = y(0);

    const band = plotW / labels.length;
    const barW = Math.max(3, Math.min(BAR_MAX, (band * 0.66 - BAR_GAP * (series.length - 1)) / series.length));
    const groupW = barW * series.length + BAR_GAP * (series.length - 1);

    const gridLayer = [];
    for (const t of ticks) {
      gridLayer.push(svg('line', { class: 'gridline', x1: M.left, x2: W - M.right, y1: y(t), y2: y(t) }));
      gridLayer.push(svg('text', {
        class: 'tick-label', x: M.left - 8, y: y(t) + 3.5, 'text-anchor': 'end',
      }, [document.createTextNode(axisFormat(t))]));
    }

    const bands = [];
    const marks = [];
    labels.forEach((label, i) => {
      const groupX = M.left + band * i + (band - groupW) / 2;
      series.forEach((s, si) => {
        const value = s.values[i] || 0;
        const x = groupX + si * (barW + BAR_GAP);
        const top = value >= 0 ? y(value) : zeroY;
        const height = Math.abs(y(value) - zeroY);
        marks.push(svg('path', {
          d: barPath(x, top, barW, height, value >= 0),
          fill: s.color,
        }));
      });
      bands.push(svg('rect', {
        class: 'hover-band', x: M.left + band * i, y: M.top, width: band, height: plotH,
        'data-index': i,
      }));
    });

    // Axis labels thin out on narrow charts rather than overlapping.
    const stride = labels.length > 8 ? Math.ceil(labels.length / 8) : 1;
    const axisText = labels.map((label, i) => (
      i % stride === 0
        ? svg('text', {
            class: 'tick-label', x: M.left + band * i + band / 2, y: H - M.bottom + 16, 'text-anchor': 'middle',
          }, [document.createTextNode(label)])
        : null
    ));

    const node = svg('svg', {
      viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': spec.label || `${series.map((s) => s.name).join(' and ')} by month`,
    }, [
      svg('g', {}, gridLayer),
      svg('line', { class: 'axis-line', x1: M.left, x2: W - M.right, y1: zeroY, y2: zeroY }),
      svg('g', {}, marks),
      svg('g', {}, axisText),
      svg('g', {}, bands),
    ]);

    const lg = legend(series);
    if (lg) container.appendChild(lg);
    container.appendChild(node);

    const tip = tooltip(container);
    node.addEventListener('mousemove', (event) => {
      const target = event.target.closest('.hover-band');
      if (!target) return tip.hide();
      const i = Number(target.dataset.index);
      tip.show(tipMarkup(labels[i], series.map((s) => ({
        label: s.name, value: format(s.values[i] || 0), color: s.color,
      }))), event.clientX, event.clientY);
    });
    node.addEventListener('mouseleave', tip.hide);
    return node;
  }

  // ------------------------------------------------------------ line chart ---
  /**
   * @param {{labels:string[], values:number[], color:string, name:string,
   *          format:(n:number)=>string, axisFormat?:(n:number)=>string}} spec
   */
  function line(container, spec) {
    clear(container);
    container.classList.add('chart');
    // The end-of-line label sits in the right margin, so it takes the compact
    // format; the tooltip is where full precision belongs.
    const { labels, values, color, format, axisFormat = Fmt.pesoAxis, labelFormat = format } = spec;

    const W = 760, H = 330;
    const M = { top: 20, right: 66, bottom: 34, left: 66 };
    const plotW = W - M.left - M.right;
    const plotH = H - M.top - M.bottom;
    const surface = cssVar('--surface-1', '#fcfcfb');

    const { min, max, ticks } = scale(values);
    const y = (v) => M.top + plotH - ((v - min) / (max - min)) * plotH;
    const x = (i) => M.left + (values.length === 1 ? plotW / 2 : (plotW / (values.length - 1)) * i);
    const zeroY = y(0);

    const grid = [];
    for (const t of ticks) {
      grid.push(svg('line', { class: 'gridline', x1: M.left, x2: W - M.right, y1: y(t), y2: y(t) }));
      grid.push(svg('text', {
        class: 'tick-label', x: M.left - 8, y: y(t) + 3.5, 'text-anchor': 'end',
      }, [document.createTextNode(axisFormat(t))]));
    }

    const path = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
    const areaPath = `${path}L${x(values.length - 1)},${zeroY}L${x(0)},${zeroY}Z`;

    const lastIndex = values.length - 1;
    const stride = labels.length > 8 ? Math.ceil(labels.length / 8) : 1;

    const node = svg('svg', {
      viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': spec.label || `${spec.name} over ${labels.length} months`,
    }, [
      svg('g', {}, grid),
      svg('line', { class: 'axis-line', x1: M.left, x2: W - M.right, y1: zeroY, y2: zeroY }),
      svg('path', { d: areaPath, fill: color, 'fill-opacity': 0.1 }),
      svg('path', { d: path, fill: 'none', stroke: color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      // End marker: >=8px across, with a surface ring so it stays legible on the line.
      svg('circle', { cx: x(lastIndex), cy: y(values[lastIndex]), r: 4.5, fill: color, stroke: surface, 'stroke-width': RING }),
      svg('text', {
        class: 'mark-label', x: x(lastIndex) + 9, y: y(values[lastIndex]) + 3.5, 'text-anchor': 'start',
      }, [document.createTextNode(labelFormat(values[lastIndex]))]),
      svg('g', {}, labels.map((label, i) => (
        i % stride === 0
          ? svg('text', { class: 'tick-label', x: x(i), y: H - M.bottom + 16, 'text-anchor': 'middle' },
              [document.createTextNode(label)])
          : null
      ))),
      svg('line', { class: 'crosshair', x1: 0, x2: 0, y1: M.top, y2: M.top + plotH, opacity: 0 }),
      svg('circle', { class: 'crosshair-dot', r: 4.5, fill: color, stroke: surface, 'stroke-width': RING, opacity: 0 }),
      svg('rect', { class: 'hover-band', x: M.left - 6, y: M.top, width: plotW + 12, height: plotH }),
    ]);

    container.appendChild(node);
    const tip = tooltip(container);
    const crosshair = node.querySelector('.crosshair');
    const dot = node.querySelector('.crosshair-dot');

    node.addEventListener('mousemove', (event) => {
      const box = node.getBoundingClientRect();
      const svgX = ((event.clientX - box.left) / box.width) * W;
      if (svgX < M.left - 8 || svgX > W - M.right + 8) return;
      const step = values.length === 1 ? plotW : plotW / (values.length - 1);
      const i = Math.max(0, Math.min(lastIndex, Math.round((svgX - M.left) / step)));
      crosshair.setAttribute('x1', x(i)); crosshair.setAttribute('x2', x(i));
      crosshair.setAttribute('opacity', 1);
      dot.setAttribute('cx', x(i)); dot.setAttribute('cy', y(values[i]));
      dot.setAttribute('opacity', 1);
      tip.show(tipMarkup(labels[i], [{ label: spec.name, value: format(values[i]), color }]),
        event.clientX, event.clientY);
    });
    node.addEventListener('mouseleave', () => {
      tip.hide();
      crosshair.setAttribute('opacity', 0);
      dot.setAttribute('opacity', 0);
    });
    return node;
  }

  // ------------------------------------------------------ horizontal bars ---
  /** @param {{items:{label:string,value:number}[], color:string, format:(n:number)=>string}} spec */
  function bars(container, spec) {
    clear(container);
    container.classList.add('chart');
    const { items, color, format } = spec;
    if (!items.length) {
      container.appendChild(el('p', { class: 'chart-note', text: 'No data.' }));
      return null;
    }

    const rowH = 30;
    const W = 760;
    const M = { top: 6, right: 92, bottom: 6, left: 176 };
    const H = M.top + M.bottom + rowH * items.length;
    const plotW = W - M.left - M.right;

    const max = Math.max(1, ...items.map((d) => Math.abs(d.value)));
    const barH = Math.min(BAR_MAX, rowH - 10);

    const marks = items.map((item, i) => {
      const y = M.top + i * rowH + (rowH - barH) / 2;
      const width = (Math.abs(item.value) / max) * plotW;
      return svg('g', { class: 'bar-row', 'data-index': i }, [
        svg('text', {
          class: 'tick-label', x: M.left - 10, y: y + barH / 2 + 3.5, 'text-anchor': 'end',
        }, [document.createTextNode(truncate(item.label, 26))]),
        // Horizontal bar: rounded at the value end, square at the baseline.
        svg('path', {
          d: `M${M.left},${y}h${Math.max(0, width - RADIUS)}a${RADIUS},${RADIUS} 0 0 1 ${RADIUS},${RADIUS}v${barH - 2 * RADIUS}a${RADIUS},${RADIUS} 0 0 1 ${-RADIUS},${RADIUS}H${M.left}Z`,
          fill: width > RADIUS ? color : 'none',
        }),
        width <= RADIUS ? svg('rect', { x: M.left, y, width: Math.max(width, 1), height: barH, fill: color }) : null,
        // Value at the tip, outside the bar, so it never collides with the fill.
        svg('text', {
          class: 'mark-label', x: M.left + width + 8, y: y + barH / 2 + 3.5, 'text-anchor': 'start',
        }, [document.createTextNode(format(item.value))]),
        svg('rect', { class: 'hover-band', x: 0, y: M.top + i * rowH, width: W, height: rowH }),
      ]);
    });

    const node = svg('svg', {
      viewBox: `0 0 ${W} ${H}`, role: 'img',
      'aria-label': spec.label || 'Values by category',
    }, [
      svg('line', { class: 'axis-line', x1: M.left, x2: M.left, y1: M.top, y2: H - M.bottom }),
      svg('g', {}, marks),
    ]);
    container.appendChild(node);

    const tip = tooltip(container);
    node.addEventListener('mousemove', (event) => {
      const row = event.target.closest('.bar-row');
      if (!row) return tip.hide();
      const item = items[Number(row.dataset.index)];
      tip.show(tipMarkup(item.label, [{ label: spec.measure || 'Value', value: format(item.value), color }]),
        event.clientX, event.clientY);
    });
    node.addEventListener('mouseleave', tip.hide);
    return node;
  }

  // ----------------------------------------------------------- sparkline ---
  /** 12-point trend for the project cards. Decorative support for the KPI beside it. */
  function sparkline(values, { width = 108, height = 30, color } = {}) {
    const finite = values.filter((v) => Number.isFinite(v));
    if (finite.length < 2) return el('span');
    const min = Math.min(0, ...finite);
    const max = Math.max(0, ...finite);
    const span = max - min || 1;
    const x = (i) => (width / (finite.length - 1)) * i;
    const y = (v) => height - ((v - min) / span) * (height - 4) - 2;
    const path = finite.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
    const stroke = color || cssVar('--series-1', '#2a78d6');

    return svg('svg', {
      class: 'card-sparkline', width, height, viewBox: `0 0 ${width} ${height}`,
      role: 'img', 'aria-label': 'Cumulative net cash trend',
    }, [
      svg('line', { class: 'gridline', x1: 0, x2: width, y1: y(0), y2: y(0) }),
      svg('path', { d: path, fill: 'none', stroke, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }),
      svg('circle', { cx: x(finite.length - 1), cy: y(finite[finite.length - 1]), r: 2.5, fill: stroke }),
    ]);
  }

  function truncate(text, max) {
    const value = String(text);
    return value.length > max ? `${value.slice(0, max - 1)}…` : value;
  }

  return { columns, line, bars, sparkline, cssVar };
})();
