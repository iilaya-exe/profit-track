/* Local data layer. Was a thin wrapper over the PHP endpoints; now it resolves
   everything in the browser against Store + Metrics, keeping the exact same
   Promise-returning interface so no UI code had to change. Every call resolves to
   the same shape the server sent, or throws an Error carrying a message to show. */
const Api = (() => {
  // A generous cap for an .xlsx export; the parsing and storage happen locally.
  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const LOGO_MAX_BYTES = 512 * 1024;

  /** Run a synchronous resolver as a Promise, so callers can await uniformly. */
  function resolve(fn) {
    return new Promise((res, rej) => {
      try { res(fn()); } catch (e) { rej(e); }
    });
  }

  function requireProject(id) {
    const doc = Store.find(id);
    if (doc === null) throw new HttpError('Project not found: ' + id, 404);
    return doc;
  }

  /**
   * Vet an icon before storing it. The browser re-encodes whatever was picked to
   * a square PNG/WebP/JPEG before this runs, so anything that does not look like
   * one was not produced by this app — the strict pattern keeps an SVG (a script
   * container) or an HTML payload from ever reaching an <img src>.
   */
  function normalizeLogo(raw) {
    const value = String(raw ?? '').trim();
    if (value === '') return null;
    const m = /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (!m) throw new HttpError('That icon is not a PNG, WebP or JPEG image.', 422);
    let bytes;
    try { bytes = atob(m[2]); } catch { bytes = ''; }
    if (bytes === '') throw new HttpError('The icon could not be decoded.', 422);
    if (bytes.length > LOGO_MAX_BYTES) {
      throw new HttpError(`That icon is too large — the limit is ${Math.round(LOGO_MAX_BYTES / 1024)} KB.`, 413);
    }
    return value;
  }

  return {
    listProjects: () => resolve(() => {
      const projects = Store.all().map((doc) => Metrics.summary(doc));
      // Biggest contract first — the overview reads as a portfolio, largest on top.
      projects.sort((a, b) => b.contract.tcv - a.contract.tcv);
      return { projects };
    }),

    getProject: (id) => resolve(() => ({ project: Metrics.compute(requireProject(id)) })),

    getJournal: (id, query) => resolve(() => Store.journal(id, query || {})),

    saveParams: (id, params) => resolve(() => {
      requireProject(id);
      const updated = Store.updateParams(id, {
        projectedMargin: Number(params.projectedMargin ?? 0.20),
        minMargin: Number(params.minMargin ?? 0.20),
        minCashPctOfGP: Number(params.minCashPctOfGP ?? 0.20),
      });
      return { project: Metrics.compute(updated) };
    }),

    /** `logo` is a data URI the browser produced; null clears it. */
    saveLogo: (id, logo) => resolve(() => {
      requireProject(id);
      const updated = Store.setLogo(id, normalizeLogo(logo));
      return { project: Metrics.compute(updated) };
    }),
    clearLogo: (id) => resolve(() => {
      requireProject(id);
      const updated = Store.setLogo(id, null);
      return { project: Metrics.compute(updated) };
    }),

    getLimits: () => resolve(() => ({ maxUploadBytes: MAX_UPLOAD_BYTES })),

    async importFile(file) {
      if (!file) throw new HttpError('No file was uploaded.', 400);
      if (file.size > MAX_UPLOAD_BYTES) {
        throw new HttpError(`File exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB upload limit.`, 413);
      }
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      if (ext !== 'xlsx') throw new HttpError('Only .xlsx workbooks can be imported.', 415);
      const buffer = await file.arrayBuffer();
      return { imported: await Store.importXlsx(buffer, file.name) };
    },
  };
})();
