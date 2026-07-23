/* Read-only XLSX reader that runs entirely in the browser — the port of the old
   Xlsx.php (ZipArchive + SimpleXML). A .xlsx is a ZIP of XML parts; we read the
   ZIP central directory ourselves, inflate the parts we need with the native
   DecompressionStream('deflate-raw'), and parse them with DOMParser. No libraries.

   Only what this app needs: named sheets read as a rectangular array of scalar
   cell values. Formulas are ignored — the cached <v> value is used, which is what
   Excel/SAP exports always carry. Usage:

     const book = await Xlsx.open(arrayBuffer);
     book.sheetNames();        // ["Transaction Journal Report", ...]
     await book.sheet(name);   // [[cell, cell, …], …] padded to a rectangle
*/
const Xlsx = (() => {
  const u16 = (view, off) => view.getUint16(off, true);
  const u32 = (view, off) => view.getUint32(off, true);
  const decoder = new TextDecoder();

  async function inflateRaw(bytes) {
    if (bytes.length === 0) return new Uint8Array(0);
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /**
   * Parse the ZIP central directory into name => {method, offset, compSize}.
   * Reading the directory (not scanning local headers) gives reliable entry
   * names, compression methods and offsets.
   */
  function readDirectory(buffer) {
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    // Locate the End Of Central Directory record (signature PK\05\06),
    // scanning back from the end past any trailing comment.
    let eocd = -1;
    for (let i = bytes.length - 22; i >= 0; i--) {
      if (u32(view, i) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd === -1) throw new Error('Not a valid .xlsx file.');

    const count = u16(view, eocd + 10);
    let ptr = u32(view, eocd + 16); // central directory offset
    const entries = {};
    for (let i = 0; i < count; i++) {
      if (u32(view, ptr) !== 0x02014b50) break; // central file header signature
      const method = u16(view, ptr + 10);
      const compSize = u32(view, ptr + 20);
      const nameLen = u16(view, ptr + 28);
      const extraLen = u16(view, ptr + 30);
      const commentLen = u16(view, ptr + 32);
      const localOffset = u32(view, ptr + 42);
      const name = decoder.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
      entries[name] = { method, compSize, localOffset };
      ptr += 46 + nameLen + extraLen + commentLen;
    }
    return { view, bytes, entries };
  }

  /** Raw bytes of one entry, inflated if it was deflate-compressed. */
  async function extract(dir, name) {
    const entry = dir.entries[name];
    if (!entry) return null;
    // The local header repeats the name/extra lengths; the data starts after them.
    const base = entry.localOffset;
    const nameLen = u16(dir.view, base + 26);
    const extraLen = u16(dir.view, base + 28);
    const start = base + 30 + nameLen + extraLen;
    const slice = dir.bytes.subarray(start, start + entry.compSize);
    if (entry.method === 0) return slice.slice();          // stored
    if (entry.method === 8) return await inflateRaw(slice); // deflate
    throw new Error('Unsupported compression in workbook.');
  }

  async function text(dir, name) {
    const bytes = await extract(dir, name);
    return bytes === null ? null : decoder.decode(bytes);
  }

  const parser = new DOMParser();
  function parseXml(xml) {
    const doc = parser.parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Malformed workbook XML.');
    return doc;
  }

  /** "AB12" -> 27 (0-indexed column). */
  function columnIndex(ref) {
    let n = 0;
    for (let i = 0; i < ref.length; i++) {
      const ch = ref.charCodeAt(i);
      if (ch < 65 || ch > 90) break; // A–Z
      n = n * 26 + (ch - 64);
    }
    return Math.max(0, n - 1);
  }

  /** Excel serial date (1900 system, incl. its leap-year quirk) -> "MM.DD.YY". */
  function serialToDate(serial) {
    let days = Math.floor(serial);
    if (days > 59) days--; // Excel thinks 1900-02-29 existed
    const ts = (days - 25568) * 86400 * 1000;
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}.${pad(d.getUTCFullYear() % 100)}`;
  }

  class Workbook {
    constructor(sharedStrings, cellFormats, sheets, dir) {
      this._shared = sharedStrings;
      this._formats = cellFormats;
      this._sheets = sheets; // name => entry path
      this._dir = dir;
    }

    sheetNames() { return Object.keys(this._sheets); }

    async sheet(name) {
      const path = this._sheets[name];
      if (!path) throw new Error('Sheet not found: ' + name);
      const doc = parseXml(await text(this._dir, path));

      const parsed = [];
      let width = 0;
      for (const row of doc.getElementsByTagName('row')) {
        const cells = {};
        for (const c of row.getElementsByTagName('c')) {
          const col = columnIndex(c.getAttribute('r') || '');
          cells[col] = this._cellValue(c);
          width = Math.max(width, col + 1);
        }
        parsed.push(cells);
      }

      return parsed.map((cells) => {
        const line = new Array(width).fill(null);
        for (const [i, v] of Object.entries(cells)) line[i] = v;
        return line;
      });
    }

    _cellValue(c) {
      const type = c.getAttribute('t') || 'n';
      if (type === 'inlineStr') {
        const is = c.getElementsByTagName('is')[0];
        const t = is ? is.textContent : '';
        return t === '' ? null : t;
      }
      const v = c.getElementsByTagName('v')[0];
      if (!v) return null;
      const raw = v.textContent;

      switch (type) {
        case 's': return this._shared[Number(raw)] ?? null;
        case 'b': return raw === '1' ? 'TRUE' : 'FALSE';
        case 'e': return raw;   // error literal, e.g. #N/A
        case 'str': return raw; // cached formula string result
        default: return this._numericValue(c, raw);
      }
    }

    _numericValue(c, raw) {
      if (raw === '') return null;
      const styleIdx = c.hasAttribute('s') ? Number(c.getAttribute('s')) : 0;
      const fmtId = this._formats[styleIdx] ?? 0;
      // Built-in date/time number formats — render as the MM.DD.YY the journal uses.
      const isDate = (fmtId >= 14 && fmtId <= 22) || (fmtId >= 45 && fmtId <= 47) || fmtId === 164;
      const num = Number(raw);
      if (isDate && Number.isFinite(num) && num > 1) return serialToDate(num);
      return num;
    }
  }

  async function open(arrayBuffer) {
    const dir = readDirectory(arrayBuffer);

    // Shared strings: each <si> is a single <t> or a run of <r><t>…</t></r>.
    const sharedStrings = [];
    const sharedXml = await text(dir, 'xl/sharedStrings.xml');
    if (sharedXml) {
      for (const si of parseXml(sharedXml).getElementsByTagName('si')) {
        sharedStrings.push(si.textContent);
      }
    }

    // Styles: styleIndex => numFmtId, for the date-format detection above.
    const cellFormats = [];
    const stylesXml = await text(dir, 'xl/styles.xml');
    if (stylesXml) {
      const cellXfs = parseXml(stylesXml).getElementsByTagName('cellXfs')[0];
      if (cellXfs) {
        for (const xf of cellXfs.getElementsByTagName('xf')) {
          cellFormats.push(Number(xf.getAttribute('numFmtId') || 0));
        }
      }
    }

    // Workbook: sheet name => worksheet part path (resolved through the rels file).
    const rels = {};
    const relXml = await text(dir, 'xl/_rels/workbook.xml.rels');
    if (relXml) {
      for (const rel of parseXml(relXml).getElementsByTagName('Relationship')) {
        const target = rel.getAttribute('Target') || '';
        rels[rel.getAttribute('Id')] = target.startsWith('/')
          ? target.replace(/^\/+/, '')
          : 'xl/' + target.replace(/^\.?\/+/, '');
      }
    }
    const RELS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const sheets = {};
    const workbookDoc = parseXml(await text(dir, 'xl/workbook.xml'));
    let i = 0;
    for (const sheet of workbookDoc.getElementsByTagName('sheet')) {
      i++;
      const rid = sheet.getAttributeNS(RELS_NS, 'id') || sheet.getAttribute('r:id') || '';
      sheets[sheet.getAttribute('name')] = rels[rid] || ('xl/worksheets/sheet' + i + '.xml');
    }

    return new Workbook(sharedStrings, cellFormats, sheets, dir);
  }

  return { open };
})();
