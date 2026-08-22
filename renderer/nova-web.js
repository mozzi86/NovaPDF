// NovaPDF browser bridge — provides window.nova when NOT running inside Electron
// (i.e. as a PWA / plain web page). The Electron preload sets window.nova first;
// this file only fills in when that's absent, so the identical renderer runs on
// Android, iOS/iPadOS, Windows tablets and every desktop browser.
// Register the service worker for offline/installable PWA (skipped under
// Electron's file:// protocol, where service workers aren't available).
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('../sw.js').catch(() => {}));
}

(function () {
  if (window.nova) return; // Electron already provided the real bridge

  // ---- helpers ----
  const readFile = (file) => file.arrayBuffer().then((b) => new Uint8Array(b));
  const pickFiles = (accept, multi) => new Promise((resolve) => {
    const inp = document.createElement('input');
    inp.type = 'file'; inp.accept = accept; inp.multiple = !!multi;
    inp.style.position = 'fixed'; inp.style.left = '-9999px';
    let settled = false;
    const done = (v) => { if (settled) return; settled = true; inp.remove(); resolve(v); };
    inp.addEventListener('change', async () => {
      const out = [];
      for (const f of [...inp.files]) out.push({ name: f.name, path: f.name, ext: '.' + (f.name.split('.').pop() || '').toLowerCase(), bytes: await readFile(f) });
      done(out);
    });
    inp.addEventListener('cancel', () => done([]));
    document.body.appendChild(inp);
    inp.click();
  });

  const downloadBlob = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const mimeFor = (ext) => ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' : 'application/pdf';

  // ---- minimal store-only ZIP (no compression) for saveMany ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {
    const enc = new TextEncoder(); const chunks = []; const central = []; let offset = 0;
    const u16 = (n) => new Uint8Array([n & 255, (n >> 8) & 255]);
    const u32 = (n) => new Uint8Array([n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255]);
    for (const f of files) {
      const nameB = enc.encode(f.name); const data = f.bytes instanceof Uint8Array ? f.bytes : new Uint8Array(f.bytes);
      const crc = crc32(data);
      const local = [enc.encode('PK\x03\x04'), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), nameB, data];
      const localLen = local.reduce((s, a) => s + a.length, 0);
      chunks.push(...local);
      central.push([enc.encode('PK\x01\x02'), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0), u32(crc), u32(data.length), u32(data.length), u16(nameB.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), nameB]);
      offset += localLen;
    }
    const cdParts = []; let cdLen = 0;
    for (const c of central) { cdParts.push(...c); cdLen += c.reduce((s, a) => s + a.length, 0); }
    const end = [enc.encode('PK\x05\x06'), u16(0), u16(0), u16(files.length), u16(files.length), u32(cdLen), u32(offset), u16(0)];
    const all = [...chunks, ...cdParts, ...end];
    const total = all.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total); let p = 0;
    for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  // ---- recent files in IndexedDB (stores the actual bytes so reopen works) ----
  const DB = { name: 'novapdf', store: 'recent' };
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB.name, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(DB.store)) r.result.createObjectStore(DB.store, { keyPath: 'id' }); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  async function idbTx(mode, fn) {
    try { const db = await idb(); return await new Promise((res, rej) => { const tx = db.transaction(DB.store, mode); const st = tx.objectStore(DB.store); const out = fn(st); tx.oncomplete = () => res(out); tx.onerror = () => rej(tx.error); }); }
    catch { return null; }
  }
  async function recentAdd(name, bytes) {
    const id = name; const time = Date.now();
    await idbTx('readwrite', (st) => { st.put({ id, name, time, blob: new Blob([bytes], { type: 'application/pdf' }) }); });
    // prune to newest 12
    const all = await recentList();
    if (all.length > 12) await idbTx('readwrite', (st) => { all.slice(12).forEach((r) => st.delete(r.id)); });
  }
  function recentList() {
    return idbTx('readonly', (st) => { const out = []; st.openCursor().onsuccess = (e) => { const c = e.target.result; if (c) { out.push(c.value); c.continue(); } }; return out; })
      .then((a) => (a || []).sort((x, y) => y.time - x.time));
  }

  // ---- launchQueue (File Handling API): opened-with files ----
  let openCb = null, pendingLaunch = [];
  if ('launchQueue' in window && 'files' in LaunchParams.prototype) {
    window.launchQueue.setConsumer(async (params) => {
      for (const fh of (params.files || [])) {
        const f = await fh.getFile(); const item = { name: f.name, bytes: await readFile(f) };
        if (openCb) openCb(item); else pendingLaunch.push(item);
      }
    });
  }

  // ---- browser OCR via tesseract.js (WASM in a worker) ----
  const VBASE = new URL('../vendor/', document.baseURI).href;
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.appendChild(s); });
  let ocrP = null;
  async function ocrWorker() {
    if (ocrP) return ocrP;
    ocrP = (async () => {
      if (!window.Tesseract) await loadScript(VBASE + 'tesseract/tesseract.min.js');
      return window.Tesseract.createWorker(['deu', 'eng'], 1, {
        workerPath: VBASE + 'tesseract/worker.min.js',
        corePath: VBASE + 'tesseract/',
        langPath: VBASE + 'tessdata/',
        gzip: true, cacheMethod: 'none'
      });
    })();
    return ocrP;
  }

  window.nova = {
    openDialog: (opts = {}) => pickFiles('application/pdf,.pdf', opts.multi),
    openImageDialog: async (opts = {}) => { const r = await pickFiles('image/png,image/jpeg,.png,.jpg,.jpeg', opts.multi); return opts.multi ? r : (r[0] || null); },
    save: async ({ defaultName, bytes, ext }) => {
      try { downloadBlob(new Blob([bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)], { type: mimeFor(ext) }), defaultName || 'dokument.pdf'); return { ok: true, path: defaultName || 'dokument.pdf' }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    saveMany: async ({ files, subdir }) => {
      try { const zip = makeZip(files); downloadBlob(new Blob([zip], { type: 'application/zip' }), (subdir || 'BIT-Nova-PDF') + '.zip'); return { ok: true, path: (subdir || 'BIT-Nova-PDF') + '.zip', count: files.length }; }
      catch (e) { return { ok: false, error: e.message }; }
    },
    getRecent: async () => (await recentList()).map((r) => ({ path: r.id, name: r.name, time: r.time })),
    readRecent: async (p) => { const all = await recentList(); const hit = all.find((r) => r.id === p); if (!hit) return { missing: true }; return { name: hit.name, path: hit.id, bytes: await readFile(hit.blob) }; },
    clearRecent: async () => { await idbTx('readwrite', (st) => st.clear()); return true; },
    ocrPage: async ({ png }) => {
      try {
        const w = await ocrWorker();
        const blob = new Blob([png instanceof Uint8Array ? png : new Uint8Array(png)], { type: 'image/png' });
        const { data } = await w.recognize(blob, {}, { text: false, blocks: true });
        const words = [];
        for (const b of (data.blocks || [])) for (const par of (b.paragraphs || [])) for (const line of (par.lines || [])) for (const wd of (line.words || [])) words.push({ text: wd.text, conf: wd.confidence, bbox: wd.bbox });
        return { ok: true, words };
      } catch (e) { return { ok: false, error: e.message }; }
    },
    onMenu: () => {},
    onOpenFileData: (cb) => { openCb = cb; pendingLaunch.splice(0).forEach(cb); }
  };

  // Record opens into recent (wrap openDialog + drag/drop happens in app.js via openAndShow;
  // we hook openDialog + readRecent here so both desktop-parity and reopen work).
  const _open = window.nova.openDialog;
  window.nova.openDialog = async (opts) => { const r = await _open(opts); for (const f of r) recentAdd(f.name, f.bytes); return r; };
})();
