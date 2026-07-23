/* Shell: hash routing, the two project tabs, theme toggle and the import flow.
 *
 *   #/                      portfolio overview
 *   #/p/<id>/dashboard      project dashboard
 *   #/p/<id>/journal        transaction journal report
 *
 * The header mirrors ABITrack's: the title/subtitle slot shows the current
 * project, the badge shows the current view, and the sub-bar carries the crumb.
 */
(() => {
  const { el } = Fmt;
  const view = document.getElementById('view');
  const crumbs = document.getElementById('crumbs');
  const headerTitle = document.getElementById('header-title');
  const headerSubtitle = document.getElementById('header-subtitle');
  const headerBadge = document.getElementById('header-badge');

  const DEFAULT_TITLE = 'Profitability & Cash Flow';
  const DEFAULT_SUBTITLE = 'SAP Transaction Journal analytics';

  const cache = { projects: null, byId: new Map() };
  let currentJournal = null;

  document.getElementById('current-date').textContent = new Date().toLocaleDateString('en-PH', {
    day: 'numeric', month: 'short', year: 'numeric',
  });

  // ------------------------------------------------------------------ theme ---
  const themeToggle = document.getElementById('theme-toggle');
  const storedTheme = localStorage.getItem('pcf-theme');
  if (storedTheme === 'light' || storedTheme === 'dark') {
    document.documentElement.dataset.theme = storedTheme;
  } else {
    delete document.documentElement.dataset.theme; // follow the OS
  }
  syncThemeLabel();

  themeToggle.addEventListener('click', () => {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const current = document.documentElement.dataset.theme || (dark ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('pcf-theme', next);
    syncThemeLabel();
    rerenderForTheme();
  });

  function syncThemeLabel() {
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const isDark = (document.documentElement.dataset.theme || (dark ? 'dark' : 'light')) === 'dark';
    themeToggle.setAttribute('aria-label', `Switch to ${isDark ? 'light' : 'dark'} theme`);
  }

  /** Charts read their colours from CSS variables at build time, so redraw on toggle. */
  function rerenderForTheme() {
    if (location.hash.includes('/dashboard') || location.hash === '#/' || location.hash === '') route();
  }

  // ----------------------------------------------------------------- routing ---
  /** `#/p/<id>/journal?trace=committed&month=2026-04-01` — the query carries a
      drill-down from the dashboard, so the link is shareable and survives a
      reload. */
  function parseHash() {
    const raw = location.hash.replace(/^#\/?/, '');
    const [path, query = ''] = raw.split('?');
    const parts = path.split('/').filter(Boolean);
    const params = Object.fromEntries(new URLSearchParams(query));
    if (parts[0] === 'p' && parts[1]) {
      return {
        name: 'project',
        id: decodeURIComponent(parts[1]),
        tab: parts[2] === 'journal' ? 'journal' : 'dashboard',
        params,
      };
    }
    return { name: 'overview', params };
  }

  async function route() {
    const target = parseHash();
    currentJournal?.destroy();
    currentJournal = null;
    try {
      if (target.name === 'project') await showProject(target.id, target.tab, target.params);
      else await showOverview();
    } catch (error) {
      showError(error);
    }
    view.focus({ preventScroll: true });
  }

  function showError(error) {
    Fmt.clear(view).appendChild(el('div', { class: 'error-banner' }, [
      el('strong', { text: 'Something went wrong. ' }), error.message,
    ]));
    Fmt.clear(crumbs);
  }

  function loading(message) {
    Fmt.clear(view).appendChild(el('div', { class: 'proj-loading', role: 'status' }, [
      el('span', { class: 'proj-spinner' }), message,
    ]));
  }

  function setHeader(title, subtitle, badge) {
    headerTitle.textContent = title;
    headerSubtitle.textContent = subtitle;
    headerBadge.textContent = badge;
  }

  // ---------------------------------------------------------------- overview ---
  async function showOverview() {
    document.title = 'ABI Profitability & Cash Flow';
    setHeader(DEFAULT_TITLE, DEFAULT_SUBTITLE, 'Portfolio');
    Fmt.clear(crumbs).appendChild(el('span', { class: 'crumb-link', text: 'All Projects' }));

    if (!cache.projects) loading('Loading projects…');
    const data = await Api.listProjects();
    cache.projects = data.projects;
    OverviewView.render(view, data.projects, {
      onOpen: (id, tab = 'dashboard') => { location.hash = `#/p/${encodeURIComponent(id)}/${tab}`; },
      // The card redraws its own icon; these caches would otherwise hand back
      // the pre-change project on the next visit.
      onIconChanged: (id, project) => {
        cache.byId.set(id, project);
        const summary = cache.projects?.find((p) => p.meta.id === id);
        if (summary) summary.meta.logo = project.meta.logo;
      },
    });
  }

  // ----------------------------------------------------------------- project ---
  async function showProject(id, tab, params = {}) {
    let project = cache.byId.get(id);
    if (!project) {
      loading('Loading project…');
      project = (await Api.getProject(id)).project;
      cache.byId.set(id, project);
    }
    const { meta } = project;
    document.title = `${meta.name} — ${tab === 'journal' ? 'Journal' : 'Dashboard'}`;
    setHeader(meta.name, `${meta.code} · ${meta.client || '—'}`, tab === 'journal' ? 'Journal' : 'Dashboard');

    Fmt.clear(crumbs);
    Fmt.append(crumbs, [
      el('a', { class: 'crumb-link', href: '#/', text: 'All Projects' }),
      el('span', { class: 'team-divider' }),
      el('span', {
        class: 'crumb-current',
        text: meta.firstDate
          ? `SAP journal ${Fmt.month(meta.firstDate.slice(0, 7) + '-01')} – ${Fmt.month(meta.lastDate.slice(0, 7) + '-01')} · data as of ${Fmt.date(meta.lastDate)}`
          : meta.code,
      }),
    ]);

    const panel = el('div', {
      id: `panel-${tab}`, role: 'tabpanel', 'aria-labelledby': `tab-${tab}`, tabindex: '0',
      style: 'display:flex;flex-direction:column;gap:.75rem;min-width:0',
    });

    Fmt.clear(view);
    Fmt.append(view, [tabStrip(id, tab, project), panel]);

    if (tab === 'journal') {
      currentJournal = JournalView.create(panel, id, meta, params);
    } else {
      DashboardView.render(panel, project, {
        onParamsSaved: (updated) => {
          cache.byId.set(id, updated);
          cache.projects = null; // the overview cards show the same figures
          showProject(id, 'dashboard');
        },
      });
    }
  }

  function tabStrip(id, active, project) {
    const tab = (key, label, count) => el('button', {
      class: 'tab', id: `tab-${key}`, type: 'button', role: 'tab',
      'aria-selected': String(key === active), 'aria-controls': `panel-${key}`,
      tabindex: key === active ? '0' : '-1',
      onClick: () => { location.hash = `#/p/${encodeURIComponent(id)}/${key}`; },
      onKeydown: (event) => {
        const order = ['dashboard', 'journal'];
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const next = order[(order.indexOf(key) + step + order.length) % order.length];
        location.hash = `#/p/${encodeURIComponent(id)}/${next}`;
      },
    }, [label, count ? el('span', { class: 'count', text: count }) : null]);

    return el('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Project views' }, [
      tab('dashboard', 'Dashboard'),
      tab('journal', 'Transaction Journal Report', project.meta.rowCount.toLocaleString()),
    ]);
  }

  // ------------------------------------------------------------------ import ---
  const modal = document.getElementById('import-modal');
  const fileInput = document.getElementById('import-file');
  const dropzone = document.getElementById('dropzone');
  const importStatus = document.getElementById('import-status');
  const dropzoneNote = document.getElementById('dropzone-note');
  let maxUploadBytes = null;

  document.getElementById('import-open').addEventListener('click', () => {
    importStatus.textContent = '';
    importStatus.className = 'form-status';
    modal.showModal();
    // Show the server's real ceiling rather than a number PHP may not honour.
    if (maxUploadBytes === null) {
      Api.getLimits()
        .then(({ maxUploadBytes: max }) => {
          maxUploadBytes = max;
          dropzoneNote.textContent = `Maximum ${formatBytes(max)} (server limit)`;
        })
        .catch(() => { dropzoneNote.textContent = ''; });
    }
  });

  function formatBytes(bytes) {
    if (bytes >= 1024 ** 2) {
      const mb = bytes / 1024 ** 2;
      return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
    }
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) upload(fileInput.files[0]);
  });

  for (const type of ['dragenter', 'dragover']) {
    dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.add('is-over'); });
  }
  for (const type of ['dragleave', 'drop']) {
    dropzone.addEventListener(type, (event) => { event.preventDefault(); dropzone.classList.remove('is-over'); });
  }
  dropzone.addEventListener('drop', (event) => {
    const file = event.dataTransfer?.files?.[0];
    if (file) upload(file);
  });

  async function upload(file) {
    importStatus.className = 'form-status';
    // Fail fast client-side; a file past post_max_size never reaches our handler.
    if (maxUploadBytes !== null && file.size > maxUploadBytes) {
      importStatus.className = 'form-status error';
      importStatus.textContent =
        `${file.name} is ${formatBytes(file.size)} — over the ${formatBytes(maxUploadBytes)} server upload limit.`;
      fileInput.value = '';
      return;
    }
    importStatus.textContent = `Reading ${file.name}…`;
    try {
      const result = await Api.importFile(file);
      const names = result.imported.map((p) => `${p.name} (${p.rows.toLocaleString()} rows${p.replaced ? ', replaced' : ''})`);
      importStatus.className = 'form-status ok';
      importStatus.textContent = `Imported ${names.length} project${names.length === 1 ? '' : 's'}: ${names.join('; ')}`;
      cache.projects = null;
      cache.byId.clear();
      setTimeout(() => {
        modal.close();
        if (location.hash === '#/' || location.hash === '') route();
        else location.hash = '#/';
      }, 900);
    } catch (error) {
      importStatus.className = 'form-status error';
      importStatus.textContent = error.message;
    } finally {
      fileInput.value = '';
    }
  }

  // ------------------------------------------------------------------- boot ---
  window.addEventListener('hashchange', route);
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    syncThemeLabel();
    if (!document.documentElement.dataset.theme) rerenderForTheme();
  });
  route();
})();
