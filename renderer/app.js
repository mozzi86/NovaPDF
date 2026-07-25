// NovaPDF renderer — PDF24-style tool launcher + editor.
// pdf.js renders; pdf-lib owns document structure and bakes annotations on export.

import * as pdfjsLib from '../vendor/pdf.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.mjs', import.meta.url).href;

const { PDFDocument, rgb, StandardFonts, degrees } = window.PDFLib;

// ---------------- State ----------------
const S = {
  pdfDoc: null, bytes: null, pdfjs: null,
  zoom: 1.0, tool: 'cursor', color: '#ffd400', size: 3,
  annos: {}, formValues: {}, vp1: [], textItems: [], fileName: 'dokument.pdf',
  selected: 0, undo: [], watermark: null, pageNumbers: null, stamp: null,
  sel: null // aktuell ausgewählte Annotation: { page, anno }
};

const $ = (s) => document.querySelector(s);
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const status = (m) => { $('#status').textContent = m; };
function hexToRgb(hex) { const n = parseInt(hex.replace('#', ''), 16); return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255); }
const loadImg = (src) => new Promise((res) => { const im = new Image(); im.onload = () => res(im); im.src = src; });
const blobToBytes = async (b) => new Uint8Array(await b.arrayBuffer());

// ---------------- Tools (launcher tiles) ----------------
const TOOLS = [
  { id: 'organize', g: 'Organisieren', icon: 'ph-squares-four', label: 'Seiten organisieren', desc: 'Drehen, löschen, neu ordnen' },
  { id: 'merge', g: 'Organisieren', icon: 'ph-arrows-merge', label: 'PDF zusammenführen', desc: 'Mehrere PDFs zu einem vereinen' },
  { id: 'split', g: 'Organisieren', icon: 'ph-arrows-split', label: 'PDF teilen', desc: 'In mehrere Dateien aufteilen' },
  { id: 'rotate', g: 'Organisieren', icon: 'ph-arrow-clockwise', label: 'Seiten drehen', desc: 'Einzelne Seiten ausrichten' },
  { id: 'remove', g: 'Organisieren', icon: 'ph-trash', label: 'Seiten entfernen', desc: 'Bestimmte Seiten löschen' },
  { id: 'extract', g: 'Organisieren', icon: 'ph-export', label: 'Seiten extrahieren', desc: 'Auswahl als neue PDF' },
  { id: 'compare', g: 'Organisieren', icon: 'ph-git-diff', label: 'PDF vergleichen', desc: 'Zwei Versionen nebeneinander + Differenz' },

  { id: 'img2pdf', g: 'Konvertieren', icon: 'ph-images', label: 'Bilder zu PDF', desc: 'PNG/JPG in ein PDF wandeln' },
  { id: 'pdf2img', g: 'Konvertieren', icon: 'ph-image', label: 'PDF zu Bildern', desc: 'Jede Seite als PNG/JPG' },
  { id: 'compress', g: 'Konvertieren', icon: 'ph-arrows-in-simple', label: 'Komprimieren', desc: 'Dateigröße reduzieren (Seiten als Bild)' },
  { id: 'ocr', g: 'Konvertieren', icon: 'ph-scan', label: 'OCR (Texterkennung)', desc: 'Gescanntes PDF durchsuchbar machen' },

  { id: 'nup', g: 'Layout', icon: 'ph-grid-four', label: 'Mehrere Seiten pro Blatt', desc: '2 oder 4 Seiten auf ein Blatt (N-up)' },
  { id: 'booklet', g: 'Layout', icon: 'ph-book-open', label: 'Broschüre (Booklet)', desc: 'Seitenfolge für Heftbindung' },
  { id: 'scale', g: 'Layout', icon: 'ph-frame-corners', label: 'Seiten skalieren', desc: 'Auf A4/A3/A2/A1/A0 bringen' },
  { id: 'blank', g: 'Layout', icon: 'ph-file-dashed', label: 'Leerseiten entfernen', desc: 'Leere Seiten erkennen & löschen' },

  { id: 'edit', g: 'Bearbeiten', icon: 'ph-pencil-simple', label: 'PDF bearbeiten', desc: 'Text & Bilder hinzufügen' },
  { id: 'annotate', g: 'Bearbeiten', icon: 'ph-highlighter', label: 'Kommentieren', desc: 'Markieren, zeichnen, Notizen' },
  { id: 'edittext', g: 'Bearbeiten', icon: 'ph-note-pencil', label: 'Text bearbeiten', desc: 'Vorhandenen Text ändern & ersetzen' },
  { id: 'sign', g: 'Bearbeiten', icon: 'ph-signature', label: 'PDF signieren', desc: 'Unterschrift einfügen' },
  { id: 'redact', g: 'Bearbeiten', icon: 'ph-eraser', label: 'Schwärzen', desc: 'Inhalte unkenntlich machen' },
  { id: 'stamp', g: 'Bearbeiten', icon: 'ph-stamp', label: 'Stempel', desc: 'Bild-/Textstempel auf gewählte Seiten' },
  { id: 'overlay', g: 'Bearbeiten', icon: 'ph-stack', label: 'Briefkopf / Overlay', desc: 'Zweites PDF über Seiten legen' },
  { id: 'watermark', g: 'Bearbeiten', icon: 'ph-drop', label: 'Wasserzeichen', desc: 'Text über alle Seiten' },
  { id: 'numbers', g: 'Bearbeiten', icon: 'ph-list-numbers', label: 'Seitenzahlen', desc: 'Nummerierung hinzufügen' },
  { id: 'metadata', g: 'Bearbeiten', icon: 'ph-info', label: 'Metadaten', desc: 'Titel, Autor, Stichwörter' },

  { id: 'forensic', g: 'Abschließen', icon: 'ph-shield-check', label: 'Forensisch schwärzen', desc: 'Text unter Schwärzungen wirklich entfernen' },
  { id: 'flatten', g: 'Abschließen', icon: 'ph-lock-simple', label: 'PDF fixieren', desc: 'Formular & Notizen sperren' },
  { id: 'protect', g: 'Abschließen', icon: 'ph-lock', label: 'Passwort schützen', desc: 'PDF mit AES verschlüsseln' },
  { id: 'unlock', g: 'Abschließen', icon: 'ph-lock-key-open', label: 'Beschränkungen entfernen', desc: 'Bearbeitungssperre lösen' }
];

function renderTiles(filter = '') {
  const host = $('#tool-groups'); host.innerHTML = '';
  const q = filter.trim().toLowerCase();
  const groups = [...new Set(TOOLS.map((t) => t.g))];
  let shown = 0;
  for (const g of groups) {
    const items = TOOLS.filter((t) => t.g === g && (!q || (t.label + t.desc).toLowerCase().includes(q)));
    if (!items.length) continue;
    shown += items.length;
    const sec = el('section', 'group');
    const h = el('h2', 'group-title'); h.textContent = g; sec.appendChild(h);
    const grid = el('div', 'tiles');
    for (const t of items) {
      const tile = el('button', 'tile');
      tile.innerHTML = `<div class="ico"><i class="ph ${t.icon}"></i></div>
        <div class="t-label">${t.label}</div><div class="t-desc">${t.desc}</div>`;
      tile.onclick = () => dispatch(t.id);
      grid.appendChild(tile);
    }
    sec.appendChild(grid); host.appendChild(sec);
  }
  $('#no-results').classList.toggle('hidden', shown > 0);
}

// ---------------- View switching ----------------
function showView(v) {
  $('#home').classList.toggle('hidden', v !== 'home');
  $('#editor').classList.toggle('hidden', v !== 'editor');
  $('#editor-tools').classList.toggle('hidden', v !== 'editor');
  $('#home-search-wrap').classList.toggle('hidden', v === 'editor');
  if (v === 'home') { $('#search').value = ''; renderTiles(); renderRecent(); status('Bereit'); }
}

// ---------------- Open / load ----------------
// Bytes arriving over the Electron IPC bridge (or the e2e realm) may be a
// Uint8Array from a different JS realm, which pdf-lib's instanceof checks
// reject. Normalize everything crossing the file boundary to a local copy.
const u8 = (b) => (b instanceof Uint8Array ? b : new Uint8Array(b));

async function openAndShow(bytes, name, opts = {}) {
  let doc;
  try { doc = await PDFDocument.load(u8(bytes), { ignoreEncryption: true }); }
  catch (e) { status('Fehler beim Laden: ' + e.message); return false; }
  if (doc.isEncrypted && !opts.allowEncrypted) {
    // pdf-lib kann nicht entschlüsseln — weiterarbeiten würde beim Speichern
    // eine beschädigte Datei erzeugen. Lieber ehrlich ablehnen.
    status('Diese PDF ist verschlüsselt (Passwort/Beschränkungen). Bearbeiten würde die Datei beschädigen — bitte zuerst entsperren.');
    return false;
  }
  S.pdfDoc = doc;
  S.annos = {}; S.formValues = {}; S.undo = []; S.watermark = null; S.pageNumbers = null; S.stamp = null;
  if (name) { S.fileName = name; $('#doc-name').textContent = name; }
  await refresh(true); readForm();
  showView('editor');
  status(`${name || 'PDF'} geladen — ${S.pdfDoc.getPageCount()} Seite(n)`);
  return true;
}

// Ensure a document is open (prompt to pick one if not). Returns boolean.
async function ensureDoc() {
  if (S.pdfDoc) { showView('editor'); return true; }
  const files = await window.nova.openDialog({ multi: false });
  if (!files[0]) return false;
  return openAndShow(files[0].bytes, files[0].name);
}

async function refresh(resetScroll = false) {
  const saved = await S.pdfDoc.save({ updateFieldAppearances: false });
  S.bytes = saved;
  // When a watermark / page numbers / stamp is active, render the preview with
  // those baked in (but NOT the user annotations — drawAnnos shows those live,
  // so baking them too would double them up).
  const previewOnly = S.watermark || S.pageNumbers || S.stamp;
  const src = previewOnly ? await buildExport({ bakeAnnos: false }) : saved;
  S.pdfjs = await pdfjsLib.getDocument({ data: src.slice(0) }).promise;
  await renderPages(); await renderThumbs();
  $('#page-count').textContent = `(${S.pdfjs.numPages})`;
  if (resetScroll) $('#viewer').scrollTop = 0;
}

// ---------------- Render ----------------
let renderGen = 0; // guards against interleaved async re-renders (rapid zoom clicks)
async function renderPages() {
  const gen = ++renderGen;
  const host = $('#pages'); host.innerHTML = ''; S.vp1 = []; S.textItems = [];
  for (let i = 0; i < S.pdfjs.numPages; i++) {
    if (gen !== renderGen) return;
    const page = await S.pdfjs.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    S.vp1[i] = { w: vp1.width, h: vp1.height };
    try {
      const tc = await page.getTextContent();
      S.textItems[i] = tc.items.map((it) => {
        const m = pdfjsLib.Util.transform(vp1.transform, it.transform);
        const size = Math.hypot(m[2], m[3]);
        return { str: it.str, x: m[4], y: m[5] - size, w: it.width || (it.str.length * size * 0.5), h: size, size };
      }).filter((t) => t.str && t.str.trim());
    } catch { S.textItems[i] = []; }
    const vp = page.getViewport({ scale: S.zoom });
    const dpr = Math.min(window.devicePixelRatio || 1, 3); // render at native display resolution → crisp on HiDPI / Windows scaling
    const wrap = el('div', 'page-wrap'); wrap.dataset.page = i;
    wrap.style.width = vp.width + 'px'; wrap.style.height = vp.height + 'px';
    const canvas = el('canvas', 'pdf');
    canvas.width = Math.round(vp.width * dpr); canvas.height = Math.round(vp.height * dpr);
    canvas.style.width = vp.width + 'px'; canvas.style.height = vp.height + 'px';
    wrap.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined }).promise;
    const anno = el('canvas', 'anno'); anno.width = vp.width; anno.height = vp.height; wrap.appendChild(anno);
    const overlay = el('div', 'overlay'); overlay.dataset.page = i; wrap.appendChild(overlay);
    host.appendChild(wrap);
    drawAnnos(i); attachPageEvents(wrap, i);
  }
  $('#zoom-label').textContent = Math.round(S.zoom * 100) + '%';
}

let thumbGen = 0; // same interleaving guard as renderPages
async function renderThumbs() {
  const gen = ++thumbGen;
  const host = $('#thumbs'); host.innerHTML = '';
  for (let i = 0; i < S.pdfjs.numPages; i++) {
    if (gen !== thumbGen) return;
    const page = await S.pdfjs.getPage(i + 1);
    const vp = page.getViewport({ scale: 0.22 });
    const t = el('div', 'thumb' + (i === S.selected ? ' sel' : '')); t.draggable = true; t.dataset.page = i;
    const c = el('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    t.appendChild(c);
    const num = el('div', 'num'); num.textContent = 'Seite ' + (i + 1); t.appendChild(num);
    const ops = el('div', 'ops');
    const rot = el('button', 'ghost'); rot.innerHTML = '<i class="ph ph-arrow-clockwise"></i>'; rot.title = 'Drehen';
    rot.onclick = (e) => { e.stopPropagation(); rotatePage(i); };
    const del = el('button', 'ghost'); del.innerHTML = '<i class="ph ph-trash"></i>'; del.title = 'Löschen';
    del.onclick = (e) => { e.stopPropagation(); deletePage(i); };
    ops.append(rot, del); t.appendChild(ops);
    t.onclick = () => selectPage(i);
    t.ondragstart = (e) => e.dataTransfer.setData('text/plain', String(i));
    t.ondragover = (e) => { e.preventDefault(); t.classList.add('dragover'); };
    t.ondragleave = () => t.classList.remove('dragover');
    t.ondrop = (e) => { e.preventDefault(); t.classList.remove('dragover'); const from = parseInt(e.dataTransfer.getData('text/plain'), 10); if (!isNaN(from)) movePage(from, i); };
    host.appendChild(t);
  }
}

function selectPage(i) {
  S.selected = i;
  document.querySelectorAll('.thumb').forEach((t, k) => t.classList.toggle('sel', k === i));
  const wrap = document.querySelector(`.page-wrap[data-page="${i}"]`);
  if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------- Annotations ----------------
// Umriss (in Seiten-Koordinaten) einer Annotation — für Auswahl-Rahmen & Treffertest
function annoBBox(a) {
  if (a.type === 'check') return { x: a.x - a.s / 2, y: a.y - a.s / 2, w: a.s, h: a.s };
  if (a.type === 'draw') {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const p of a.points) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  if (a.type === 'text') return { x: a.x, y: a.y, w: Math.max(20, (a.text || '').length * a.size * 0.5), h: a.size * 1.3 };
  return { x: a.x, y: a.y, w: a.w, h: a.h }; // rect, highlight, redact, cover, image, sign
}
function moveAnno(a, dx, dy) {
  if (a.type === 'draw') a.points = a.points.map((p) => ({ x: p.x + dx, y: p.y + dy }));
  else { a.x += dx; a.y += dy; }
}
// Oberste Annotation unter einem Punkt (cover-Helfer werden übersprungen)
function annoAt(pageIndex, pt) {
  const list = S.annos[pageIndex] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const a = list[i]; if (a.type === 'cover') continue;
    const b = annoBBox(a), pad = 5;
    if (pt.x >= b.x - pad && pt.x <= b.x + b.w + pad && pt.y >= b.y - pad && pt.y <= b.y + b.h + pad) return a;
  }
  return null;
}
function clearSel() { if (S.sel) { const p = S.sel.page; S.sel = null; drawAnnos(p); } }
const isSelected = (a) => !!(S.sel && S.sel.annos.includes(a));
// Alle Annotationen einer Seite, deren Umriss das Rechteck berührt
function annosInRect(pageIndex, rx, ry, rw, rh) {
  const out = [];
  for (const a of (S.annos[pageIndex] || [])) {
    if (a.type === 'cover') continue;
    const b = annoBBox(a);
    if (b.x < rx + rw && b.x + b.w > rx && b.y < ry + rh && b.y + b.h > ry) out.push(a);
  }
  return out;
}

function drawAnnos(pageIndex) {
  const wrap = document.querySelector(`.page-wrap[data-page="${pageIndex}"]`); if (!wrap) return;
  const anno = wrap.querySelector('canvas.anno'); const overlay = wrap.querySelector('.overlay');
  const ctx = anno.getContext('2d'); ctx.clearRect(0, 0, anno.width, anno.height);
  overlay.querySelectorAll('.anno-text').forEach((n) => n.remove());
  const z = S.zoom;
  for (const a of (S.annos[pageIndex] || [])) {
    if (a.type === 'draw') {
      ctx.strokeStyle = a.color; ctx.lineWidth = a.size * z; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.beginPath();
      a.points.forEach((p, k) => { const x = p.x * z, y = p.y * z; k ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
    } else if (a.type === 'highlight') { ctx.globalAlpha = .35; ctx.fillStyle = a.color; ctx.fillRect(a.x * z, a.y * z, a.w * z, a.h * z); ctx.globalAlpha = 1; }
    else if (a.type === 'rect') { ctx.strokeStyle = a.color; ctx.lineWidth = a.size * z; ctx.strokeRect(a.x * z, a.y * z, a.w * z, a.h * z); }
    else if (a.type === 'redact') { ctx.fillStyle = '#000'; ctx.fillRect(a.x * z, a.y * z, a.w * z, a.h * z); }
    else if (a.type === 'cover') { ctx.fillStyle = '#fff'; ctx.fillRect(a.x * z, a.y * z, a.w * z, a.h * z); }
    else if (a.type === 'check') {
      ctx.strokeStyle = '#17a13c'; ctx.lineWidth = Math.max(2, a.s / 5 * z); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo((a.x - a.s / 2) * z, a.y * z);
      ctx.lineTo((a.x - a.s / 6) * z, (a.y + a.s / 3) * z);
      ctx.lineTo((a.x + a.s / 2) * z, (a.y - a.s / 2) * z);
      ctx.stroke();
    }
    else if ((a.type === 'image' || a.type === 'sign') && a._img) { ctx.drawImage(a._img, a.x * z, a.y * z, a.w * z, a.h * z); }
    else if (a.type === 'text') {
      const d = el('div', 'anno-text'); d.contentEditable = 'true'; d.textContent = a.text;
      d.__anno = a;
      d.style.left = a.x * z + 'px'; d.style.top = a.y * z + 'px'; d.style.color = a.color; d.style.fontSize = a.size * z + 'px';
      d.oninput = () => { a.text = d.textContent; };
      d.onblur = () => { if (!a.text.trim()) removeAnno(pageIndex, a); };
      // Mit dem Pfeil-Werkzeug: ziehen = verschieben, Doppelklick = bearbeiten.
      d.addEventListener('mousedown', (e) => {
        if (S.tool !== 'cursor') return; // Text-/Bearbeiten-Werkzeug: normal tippen
        e.preventDefault();
        if (!isSelected(a)) S.sel = { page: pageIndex, annos: [a] };
        const sx = e.clientX, sy = e.clientY; let last = { x: sx, y: sy }, moved = false;
        const mv = (ev) => {
          if (!moved) { pushUndo(); moved = true; }
          const dx = (ev.clientX - last.x) / S.zoom, dy = (ev.clientY - last.y) / S.zoom;
          for (const s of S.sel.annos) moveAnno(s, dx, dy);
          last = { x: ev.clientX, y: ev.clientY };
          drawAnnos(pageIndex);
        };
        const up = () => { window.removeEventListener('mousemove', mv); window.removeEventListener('mouseup', up); };
        window.addEventListener('mousemove', mv); window.addEventListener('mouseup', up);
      });
      d.addEventListener('dblclick', () => { d.focus(); });
      overlay.appendChild(d);
    }
  }
  // Auswahl-Rahmen um jede ausgewählte Annotation (+ Gesamtrahmen bei mehreren)
  if (S.sel && S.sel.page === pageIndex && S.sel.annos.length) {
    ctx.save();
    ctx.strokeStyle = '#4d8dff'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
    let gx0 = 1e9, gy0 = 1e9, gx1 = -1e9, gy1 = -1e9;
    for (const a of S.sel.annos) {
      let bx, by, bw, bh;
      if (a.type === 'text') {
        const d = [...overlay.querySelectorAll('.anno-text')].find((n) => n.__anno === a);
        if (d) { bx = d.offsetLeft; by = d.offsetTop; bw = d.offsetWidth; bh = d.offsetHeight; }
      }
      if (bx === undefined) { const b = annoBBox(a); bx = b.x * z; by = b.y * z; bw = b.w * z; bh = b.h * z; }
      ctx.strokeRect(bx - 5, by - 5, bw + 10, bh + 10);
      gx0 = Math.min(gx0, bx); gy0 = Math.min(gy0, by); gx1 = Math.max(gx1, bx + bw); gy1 = Math.max(gy1, by + bh);
    }
    if (S.sel.annos.length > 1) { // hellerer Gesamtrahmen
      ctx.strokeStyle = 'rgba(77,141,255,0.5)'; ctx.setLineDash([2, 3]);
      ctx.strokeRect(gx0 - 9, gy0 - 9, (gx1 - gx0) + 18, (gy1 - gy0) + 18);
    }
    ctx.restore();
  }
  // Live-Markierungsrahmen (während des Aufziehens)
  if (marqueeBox && marqueeBox.page === pageIndex) {
    ctx.save();
    ctx.strokeStyle = '#4d8dff'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.fillStyle = 'rgba(77,141,255,0.10)';
    ctx.fillRect(marqueeBox.x * z, marqueeBox.y * z, marqueeBox.w * z, marqueeBox.h * z);
    ctx.strokeRect(marqueeBox.x * z, marqueeBox.y * z, marqueeBox.w * z, marqueeBox.h * z);
    ctx.restore();
  }
}
let marqueeBox = null; // { page, x, y, w, h } während des Aufziehens
function removeAnno(p, a) { S.annos[p] = (S.annos[p] || []).filter((x) => x !== a); drawAnnos(p); }
function pushUndo() { S.undo.push(JSON.stringify(serializeAnnos())); if (S.undo.length > 40) S.undo.shift(); }
function serializeAnnos() { const o = {}; for (const k in S.annos) o[k] = S.annos[k].map(({ _img, ...r }) => r); return { annos: o, forms: S.formValues }; }
async function undo() {
  const snap = S.undo.pop(); if (!snap) { status('Nichts rückgängig zu machen'); return; }
  const d = JSON.parse(snap); S.annos = d.annos || {}; S.formValues = d.forms || {};
  S.sel = null; marqueeBox = null; // Auswahl zeigt sonst auf nicht mehr existierende Objekte
  await rehydrateImages();
  document.querySelectorAll('.page-wrap').forEach((w) => drawAnnos(+w.dataset.page));
  status('Rückgängig');
}
async function rehydrateImages() { for (const k in S.annos) for (const a of S.annos[k]) if ((a.type === 'image' || a.type === 'sign') && a.dataUrl && !a._img) a._img = await loadImg(a.dataUrl); }

// Shared drag state + ONE window-level mouseup — page wraps are rebuilt on every
// zoom/refresh, so per-page window listeners would accumulate forever.
let dragState = null; // { pageIndex, start, cur }
window.addEventListener('mouseup', () => {
  if (!dragState) return;
  const { pageIndex, start, cur, mode } = dragState; dragState = null;
  document.querySelectorAll('.page-wrap canvas.anno').forEach((c) => (c.style.cursor = ''));
  if (mode === 'move') return; // Verschieben wurde live erledigt
  if (mode === 'marquee') {
    // Aufgezogenes Rechteck → alle Elemente darin auswählen
    const b = marqueeBox; marqueeBox = null;
    let picked = [];
    if (b && b.w > 3 && b.h > 3) picked = annosInRect(pageIndex, b.x, b.y, b.w, b.h);
    S.sel = picked.length ? { page: pageIndex, annos: picked } : null;
    drawAnnos(pageIndex);
    status(picked.length ? `${picked.length} Element(e) markiert — verschieben oder ⌫ löscht` : 'Nichts im Rahmen');
    return;
  }
  if (['highlight', 'rect', 'redact'].includes(S.tool) && start && cur) {
    const x = Math.min(start.x, cur.x), y = Math.min(start.y, cur.y), w = Math.abs(cur.x - start.x), h = Math.abs(cur.y - start.y);
    if (w > 3 && h > 3) (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: S.tool, x, y, w, h, color: S.color, size: S.size });
    drawAnnos(pageIndex);
  }
});

function attachPageEvents(wrap, pageIndex) {
  const anno = wrap.querySelector('canvas.anno');
  const toLocal = (e) => { const r = anno.getBoundingClientRect(); return { x: (e.clientX - r.left) / S.zoom, y: (e.clientY - r.top) / S.zoom }; };
  const drawTool = () => ['highlight', 'draw', 'text', 'rect', 'redact'].includes(S.tool);
  const clickTool = () => ['image', 'sign', 'edittext', 'check'].includes(S.tool);
  // Pfeil- und Markierungsrahmen-Werkzeug brauchen die Canvas ebenfalls
  const setPE = () => { anno.style.pointerEvents = (drawTool() || clickTool() || S.tool === 'cursor' || S.tool === 'marquee') ? 'auto' : 'none'; };
  setPE(); wrap._setPE = setPE;

  anno.addEventListener('mousedown', (e) => {
    // Markierungsrahmen aufziehen
    if (S.tool === 'marquee') {
      const pt = toLocal(e);
      marqueeBox = { page: pageIndex, x: pt.x, y: pt.y, w: 0, h: 0, ox: pt.x, oy: pt.y };
      dragState = { pageIndex, mode: 'marquee' };
      return;
    }
    // Auswählen & Verschieben mit dem Pfeil-Werkzeug
    if (S.tool === 'cursor') {
      const pt = toLocal(e);
      const found = annoAt(pageIndex, pt);
      // Klick auf ein bereits markiertes Element → ganze Gruppe verschieben; sonst neu auswählen
      if (!(found && isSelected(found) && S.sel.page === pageIndex)) {
        S.sel = found ? { page: pageIndex, annos: [found] } : null;
      }
      drawAnnos(pageIndex);
      if (found) { dragState = { pageIndex, mode: 'move', last: pt, moved: false }; anno.style.cursor = 'grabbing'; }
      return;
    }
    if (!drawTool()) return;
    pushUndo(); const start = toLocal(e);
    dragState = { pageIndex, start, cur: start };
    if (S.tool === 'draw') { (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: 'draw', color: S.color, size: S.size, points: [start] }); }
    else if (S.tool === 'text') {
      (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: 'text', x: start.x, y: start.y, text: 'Text…', color: S.color, size: Math.max(12, S.size * 4) });
      dragState = null; drawAnnos(pageIndex);
      const d = wrap.querySelector('.anno-text:last-child'); if (d) { d.focus(); document.execCommand('selectAll', false, null); }
    }
  });
  anno.addEventListener('mousemove', (e) => {
    if (!dragState || dragState.pageIndex !== pageIndex) return;
    if (dragState.mode === 'marquee') {
      const pt = toLocal(e);
      marqueeBox.x = Math.min(pt.x, marqueeBox.ox); marqueeBox.y = Math.min(pt.y, marqueeBox.oy);
      marqueeBox.w = Math.abs(pt.x - marqueeBox.ox); marqueeBox.h = Math.abs(pt.y - marqueeBox.oy);
      drawAnnos(pageIndex);
      return;
    }
    if (dragState.mode === 'move') {
      const pt = toLocal(e);
      const dx = pt.x - dragState.last.x, dy = pt.y - dragState.last.y;
      if (!dragState.moved) { pushUndo(); dragState.moved = true; }
      if (S.sel) for (const s of S.sel.annos) moveAnno(s, dx, dy);
      dragState.last = pt;
      drawAnnos(pageIndex);
      return;
    }
    dragState.cur = toLocal(e);
    const { start, cur } = dragState;
    const ctx = anno.getContext('2d'), z = S.zoom;
    if (S.tool === 'draw') { S.annos[pageIndex][S.annos[pageIndex].length - 1].points.push(cur); drawAnnos(pageIndex); }
    else {
      drawAnnos(pageIndex);
      const x = Math.min(start.x, cur.x) * z, y = Math.min(start.y, cur.y) * z, w = Math.abs(cur.x - start.x) * z, h = Math.abs(cur.y - start.y) * z;
      if (S.tool === 'highlight') { ctx.globalAlpha = .35; ctx.fillStyle = S.color; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; }
      else if (S.tool === 'redact') { ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); }
      else if (S.tool === 'rect') { ctx.strokeStyle = S.color; ctx.lineWidth = S.size * z; ctx.strokeRect(x, y, w, h); }
    }
  });
  anno.addEventListener('click', (e) => {
    if (S.tool === 'image') placeImage(pageIndex, toLocal(e));
    else if (S.tool === 'sign') openSign(pageIndex, toLocal(e));
    else if (S.tool === 'edittext') editTextAt(pageIndex, toLocal(e), wrap);
    else if (S.tool === 'check') placeCheck(pageIndex, toLocal(e));
  });
}
function refreshPE() { document.querySelectorAll('.page-wrap').forEach((w) => w._setPE && w._setPE()); }

// Grüner Prüfhaken — Größe folgt dem Strichstärke-Regler
function placeCheck(pageIndex, pt) {
  pushUndo();
  (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: 'check', x: pt.x, y: pt.y, s: Math.max(14, S.size * 5) });
  drawAnnos(pageIndex);
  status('Haken gesetzt — weitere Klicks setzen weitere Haken');
}

async function placeImage(pageIndex, pt) {
  const img = await window.nova.openImageDialog(); if (!img) return;
  pushUndo();
  const dataUrl = `data:image/${img.ext === '.png' ? 'png' : 'jpeg'};base64,` + bytesToB64(img.bytes);
  const im = await loadImg(dataUrl); const w = 160, h = w * (im.height / im.width);
  (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: 'image', x: pt.x, y: pt.y, w, h, dataUrl, _img: im });
  drawAnnos(pageIndex); status('Bild eingefügt');
}
function bytesToB64(bytes) { let bin = ''; const a = new Uint8Array(bytes); for (let i = 0; i < a.length; i++) bin += String.fromCharCode(a[i]); return btoa(bin); }
function dataUrlToBytes(d) { const bin = atob(d.split(',')[1]); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }

// Signature pad — listeners are bound once at module scope, not per opening.
let signTarget = null, signDrawing = false;
{
  const cv = $('#sign-pad'); const ctx = cv.getContext('2d');
  cv.onmousedown = (e) => { signDrawing = true; ctx.beginPath(); ctx.moveTo(e.offsetX, e.offsetY); };
  cv.onmousemove = (e) => { if (signDrawing) { ctx.lineTo(e.offsetX, e.offsetY); ctx.stroke(); } };
  window.addEventListener('mouseup', () => { signDrawing = false; });
}
function openSign(pageIndex, pt) {
  signTarget = { pageIndex, pt }; $('#sign-modal').classList.remove('hidden');
  const cv = $('#sign-pad'); const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#111';
}
$('#sign-clear').onclick = () => { const cv = $('#sign-pad'); cv.getContext('2d').clearRect(0, 0, cv.width, cv.height); };
$('#sign-cancel').onclick = () => $('#sign-modal').classList.add('hidden');
$('#sign-ok').onclick = async () => {
  const cv = $('#sign-pad'); const dataUrl = cv.toDataURL('image/png'); const im = await loadImg(dataUrl);
  const { pageIndex, pt } = signTarget; pushUndo(); const w = 180, h = w * (cv.height / cv.width);
  (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: 'sign', x: pt.x, y: pt.y, w, h, dataUrl, _img: im });
  drawAnnos(pageIndex); $('#sign-modal').classList.add('hidden'); status('Unterschrift eingefügt');
};

// ---------------- Edit existing text ----------------
// Click a text line: cover the original and drop an editable copy in its place.
function editTextAt(pageIndex, pt, wrap) {
  const items = S.textItems[pageIndex] || [];
  let hit = items.find((t) => pt.x >= t.x - 2 && pt.x <= t.x + t.w + 2 && pt.y >= t.y - 2 && pt.y <= t.y + t.h + 2);
  if (!hit) {
    let best = null, bd = 1e9;
    for (const t of items) { const cx = t.x + t.w / 2, cy = t.y + t.h / 2; const d = Math.hypot(cx - pt.x, cy - pt.y); if (d < bd) { bd = d; best = t; } }
    if (best && bd < 60) hit = best;
  }
  if (!hit) { status('Kein Text an dieser Stelle gefunden. Tipp: direkt auf eine Textzeile klicken.'); return; }
  pushUndo();
  (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: 'cover', x: hit.x - 1, y: hit.y - 1, w: hit.w + 3, h: hit.h + 4 });
  (S.annos[pageIndex] = S.annos[pageIndex] || []).push({ type: 'text', x: hit.x, y: hit.y, text: hit.str, color: '#111111', size: hit.size });
  drawAnnos(pageIndex);
  const d = wrap.querySelector('.anno-text:last-child'); if (d) { d.focus(); document.execCommand('selectAll', false, null); }
  status('Text bearbeiten — Original ist abgedeckt. Für echte Entfernung danach „Forensisch" anwenden.');
}

// ---------------- Forensic apply (true text removal) ----------------
// Pages carrying redactions or text edits are rasterized to images, so the
// underlying text/vector content is physically gone. Other pages keep their text.
async function applyForensic({ silent = false } = {}) {
  if (!S.pdfDoc) { status('Kein Dokument geöffnet'); return false; }
  closeMenus();
  const affected = new Set();
  for (const k in S.annos) if ((S.annos[k] || []).some((a) => a.type === 'redact' || a.type === 'cover')) affected.add(+k);
  if (!affected.size) { if (!silent) status('Keine Schwärzungen oder Text-Bearbeitungen vorhanden.'); return false; }
  status('Forensisch anwenden — Seiten werden gerendert…');
  const baked = await buildExport({ flatten: false });
  const bakedDoc = await PDFDocument.load(baked.slice(0), { ignoreEncryption: true });
  const rdoc = await pdfjsLib.getDocument({ data: baked.slice(0) }).promise;
  // Betroffene Seiten IN-PLACE durch Rasterbilder ersetzen — ein Neuaufbau per
  // copyPages würde den AcroForm-Baum (Formularfelder) verlieren.
  for (const i of [...affected].sort((a, b) => a - b)) {
    const srcPage = bakedDoc.getPage(i);
    const { width, height } = srcPage.getSize();
    const R = pageRot(srcPage);
    // Rasterbild kommt in Anzeige-Orientierung — Ausgabeseite entsprechend drehen
    const pw = R % 180 ? height : width, ph = R % 180 ? width : height;
    const page = await rdoc.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const eff = Math.min(200 / 72, 8000 / Math.max(vp1.width, vp1.height)); // Speicherschutz bei Planformaten
    const vp = page.getViewport({ scale: eff });
    const c = el('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const png = await bakedDoc.embedPng(await blobToBytes(blob));
    bakedDoc.removePage(i);
    const pg = bakedDoc.insertPage(i, [pw, ph]);
    pg.drawImage(png, { x: 0, y: 0, width: pw, height: ph });
  }
  S.pdfDoc = await PDFDocument.load(await bakedDoc.save());
  S.annos = {}; S.formValues = {}; S.watermark = null; S.pageNumbers = null; S.stamp = null;
  await refresh(); readForm();
  status(`Forensisch angewendet — Text auf ${affected.size} Seite(n) unwiederbringlich entfernt.`);
  return true;
}

// ---------------- Page operations ----------------
// Forward transform: PDF user space → viewport (top-left origin) for rotation R.
function pdfToVp(px, py, W, H, R) {
  if (R === 90) return { x: py, y: px };
  if (R === 180) return { x: W - px, y: py };
  if (R === 270) return { x: H - py, y: W - px };
  return { x: px, y: H - py };
}
function pdfToVpRect(r, W, H, R) {
  if (R === 90) return { x: r.y, y: r.x, w: r.h, h: r.w };
  if (R === 180) return { x: W - r.x - r.w, y: r.y, w: r.w, h: r.h };
  if (R === 270) return { x: H - r.y - r.h, y: W - r.x - r.w, w: r.h, h: r.w };
  return { x: r.x, y: H - r.y - r.h, w: r.w, h: r.h };
}
async function rotatePage(i) {
  const p = S.pdfDoc.getPage(i);
  const oldR = pageRot(p), newR = (oldR + 90) % 360;
  p.setRotation(degrees(newR));
  // Bestehende Annotationen in die Koordinaten der neuen Ansicht mitdrehen.
  const { width: W, height: H } = p.getSize();
  for (const a of (S.annos[i] || [])) {
    if (a.points) a.points = a.points.map((pt) => { const q = vpPoint(pt.x, pt.y, W, H, oldR); return pdfToVp(q.x, q.y, W, H, newR); });
    else if (a.type === 'text' || a.type === 'image' || a.type === 'sign') { const q = vpPoint(a.x, a.y, W, H, oldR); const v = pdfToVp(q.x, q.y, W, H, newR); a.x = v.x; a.y = v.y; }
    else { const r = vpRect(a, W, H, oldR); const v = pdfToVpRect(r, W, H, newR); a.x = v.x; a.y = v.y; a.w = v.w; a.h = v.h; }
  }
  await refresh(); status('Seite gedreht');
}
async function deletePage(i) {
  if (S.pdfDoc.getPageCount() <= 1) { status('Letzte Seite kann nicht gelöscht werden'); return; }
  S.pdfDoc.removePage(i); remapAnnos((idx) => (idx === i ? null : idx > i ? idx - 1 : idx)); await refresh(); status('Seite gelöscht');
}
async function movePage(from, to) {
  if (from === to) return;
  // Verlustfrei: die Seiten-Referenz im (flachen) Seitenbaum umhängen —
  // ein Neuaufbau per copyPages würde Formularfelder verlieren, und
  // removePage+insertPage derselben PDFPage korrumpiert den Baum.
  let moved = false;
  try {
    const kids = S.pdfDoc.catalog.Pages().Kids();
    if (kids.size() === S.pdfDoc.getPageCount()) {
      const ref = kids.get(from);
      kids.remove(from);
      kids.insert(to, ref);
      try { S.pdfDoc.pageCache.invalidate(); } catch {}
      moved = true;
    }
  } catch {}
  if (!moved) {
    // Verschachtelter Seitenbaum: Seite innerhalb desselben Dokuments kopieren.
    const [cp] = await S.pdfDoc.copyPages(S.pdfDoc, [from]);
    S.pdfDoc.removePage(from);
    S.pdfDoc.insertPage(Math.min(to, S.pdfDoc.getPageCount()), cp);
  }
  remapAnnos((idx) => {
    if (idx === from) return to;
    if (from < to) return (idx > from && idx <= to) ? idx - 1 : idx;
    return (idx >= to && idx < from) ? idx + 1 : idx;
  });
  await refresh(); status('Seite verschoben');
}
function remapAnnos(map) { const o = {}; for (const k in S.annos) { const nk = map(+k); if (nk !== null) o[nk] = S.annos[k]; } S.annos = o; }

async function addMerge() {
  const files = await window.nova.openDialog({ multi: true }); if (!files.length) return;
  for (const f of files) { const src = await PDFDocument.load(u8(f.bytes), { ignoreEncryption: true }); (await S.pdfDoc.copyPages(src, src.getPageIndices())).forEach((p) => S.pdfDoc.addPage(p)); }
  await refresh(); status(`${files.length} Datei(en) zusammengeführt — jetzt ${S.pdfDoc.getPageCount()} Seiten`);
}

// ---------------- Forms ----------------
function readForm() {
  const host = $('#fields'); host.innerHTML = '';
  let form; try { form = S.pdfDoc.getForm(); } catch { form = null; }
  const fields = form ? form.getFields() : [];
  if (!fields.length) { host.innerHTML = '<div class="muted-note">Keine Formularfelder in diesem PDF.</div>'; return; }
  for (const f of fields) {
    const name = f.getName(), type = f.constructor.name, box = el('div', 'field');
    if (type === 'PDFCheckBox') {
      box.classList.add('cb'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = f.isChecked();
      cb.onchange = () => { S.formValues[name] = cb.checked; };
      const lab = el('label'); lab.textContent = name; lab.style.margin = 0; box.append(cb, lab);
    } else if (type === 'PDFDropdown' || type === 'PDFOptionList') {
      const lab = el('label'); lab.textContent = name; const sel = el('select');
      (f.getOptions() || []).forEach((o) => { const op = el('option'); op.value = o; op.textContent = o; sel.appendChild(op); });
      const cur = f.getSelected && f.getSelected(); if (cur && cur[0]) sel.value = cur[0];
      sel.onchange = () => { S.formValues[name] = sel.value; }; box.append(lab, sel);
    } else {
      const lab = el('label'); lab.textContent = name; const inp = el('input'); inp.type = 'text';
      try { inp.value = f.getText ? (f.getText() || '') : ''; } catch {}
      inp.oninput = () => { S.formValues[name] = inp.value; }; box.append(lab, inp);
    }
    host.appendChild(box);
  }
}
function applyFormValues(doc) {
  let form; try { form = doc.getForm(); } catch { return; }
  for (const name in S.formValues) {
    try { const f = form.getField(name), t = f.constructor.name;
      if (t === 'PDFCheckBox') S.formValues[name] ? f.check() : f.uncheck();
      else if (t === 'PDFDropdown' || t === 'PDFOptionList') f.select(S.formValues[name]);
      else if (f.setText) f.setText(String(S.formValues[name]));
    } catch {}
  }
}

// ---------------- Bake + export ----------------
// Annotations are captured in pdf.js viewport coordinates (top-left origin,
// rotation-aware). pdf-lib draws in unrotated PDF user space — these helpers
// invert the viewport transform for /Rotate 0/90/180/270.
const pageRot = (page) => ((page.getRotation().angle % 360) + 360) % 360;
function vpPoint(vx, vy, W, H, R) {
  if (R === 90) return { x: vy, y: vx };
  if (R === 180) return { x: W - vx, y: vy };
  if (R === 270) return { x: W - vy, y: H - vx };
  return { x: vx, y: H - vy };
}
function vpRect(r, W, H, R) {
  if (R === 90) return { x: r.y, y: r.x, w: r.h, h: r.w };
  if (R === 180) return { x: W - r.x - r.w, y: r.y, w: r.w, h: r.h };
  if (R === 270) return { x: W - r.y - r.h, y: H - r.x - r.w, w: r.h, h: r.w };
  return { x: r.x, y: H - r.y - r.h, w: r.w, h: r.h };
}
// Standard-Helvetica ist WinAnsi-kodiert — Zeichen außerhalb (Pfeile, Emojis)
// dürfen den Export nicht crashen.
function drawTextSafe(page, text, opts) {
  try { page.drawText(text, opts); }
  catch {
    const cleaned = [...String(text)].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : '?')).join('');
    try { page.drawText(cleaned, opts); } catch {}
  }
}

async function buildExport({ flatten = false, bakeAnnos = true } = {}) {
  const doc = await PDFDocument.load(S.bytes.slice(0), { ignoreEncryption: true });
  applyFormValues(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let stampEmb = null, stampBold = null; // per-export caches (doc-bound)
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i], { width, height } = page.getSize();
    const R = pageRot(page);
    const dw = R % 180 ? height : width, dh = R % 180 ? width : height; // displayed dims
    if (bakeAnnos) for (const a of (S.annos[i] || [])) {
      if (a.type === 'highlight') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: hexToRgb(a.color), opacity: .35 }); }
      else if (a.type === 'rect') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: hexToRgb(a.color), borderWidth: a.size, opacity: 0 }); }
      else if (a.type === 'redact') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(0, 0, 0) }); }
      else if (a.type === 'cover') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(1, 1, 1) }); }
      else if (a.type === 'check') {
        const g = rgb(0.09, 0.63, 0.24), th = Math.max(1.5, a.s / 5);
        const q1 = vpPoint(a.x - a.s / 2, a.y, width, height, R);
        const q2 = vpPoint(a.x - a.s / 6, a.y + a.s / 3, width, height, R);
        const q3 = vpPoint(a.x + a.s / 2, a.y - a.s / 2, width, height, R);
        page.drawLine({ start: q1, end: q2, thickness: th, color: g });
        page.drawLine({ start: q2, end: q3, thickness: th, color: g });
      }
      else if (a.type === 'draw') for (let k = 1; k < a.points.length; k++) {
        const p0 = vpPoint(a.points[k - 1].x, a.points[k - 1].y, width, height, R);
        const p1 = vpPoint(a.points[k].x, a.points[k].y, width, height, R);
        page.drawLine({ start: p0, end: p1, thickness: a.size, color: hexToRgb(a.color) });
      }
      else if (a.type === 'text') {
        const p = vpPoint(a.x, a.y + a.size, width, height, R);
        drawTextSafe(page, a.text || '', { x: p.x, y: p.y, size: a.size, font, color: hexToRgb(a.color), rotate: degrees(R) });
      }
      else if (a.type === 'image' || a.type === 'sign') {
        const raw = dataUrlToBytes(a.dataUrl); const emb = a.dataUrl.startsWith('data:image/png') ? await doc.embedPng(raw) : await doc.embedJpg(raw);
        const p = vpPoint(a.x, a.y + a.h, width, height, R); // displayed bottom-left corner
        page.drawImage(emb, { x: p.x, y: p.y, width: a.w, height: a.h, rotate: degrees(R) });
      }
    }
    if (S.watermark) {
      const t = S.watermark.text, fsz = Math.max(28, Math.min(96, dw / (t.length * 0.55)));
      const p = vpPoint(dw * 0.12, dh * 0.58, width, height, R);
      drawTextSafe(page, t, { x: p.x, y: p.y, size: fsz, font, color: rgb(0.5, 0.5, 0.55), opacity: 0.22, rotate: degrees(R + 38) });
    }
    if (S.pageNumbers) {
      const label = S.pageNumbers.withTotal ? `${i + 1} / ${pages.length}` : `${i + 1}`;
      const w = font.widthOfTextAtSize(label, 10);
      const p = vpPoint((dw - w) / 2, dh - 22, width, height, R);
      drawTextSafe(page, label, { x: p.x, y: p.y, size: 10, font, color: rgb(0.35, 0.4, 0.5), rotate: degrees(R) });
    }
    if (S.stamp && (!S.stamp.pages || S.stamp.pages.includes(i))) {
      const st = S.stamp, m = 24;
      const w = dw * st.widthPct / 100;
      if (st.kind === 'image') {
        if (!stampEmb) { const raw = dataUrlToBytes(st.dataUrl); stampEmb = st.dataUrl.startsWith('data:image/png') ? await doc.embedPng(raw) : await doc.embedJpg(raw); }
        const h = w * st.aspect;
        const xd = st.pos[1] === 'l' ? m : st.pos[1] === 'c' ? (dw - w) / 2 : dw - w - m;
        const yd = st.pos[0] === 't' ? m : st.pos[0] === 'c' ? (dh - h) / 2 : dh - h - m;
        const p = vpPoint(xd, yd + h, width, height, R);
        page.drawImage(stampEmb, { x: p.x, y: p.y, width: w, height: h, rotate: degrees(R), opacity: st.opacity });
      } else {
        if (!stampBold) stampBold = await doc.embedFont(StandardFonts.HelveticaBold);
        const size = Math.max(8, w / Math.max(0.1, stampBold.widthOfTextAtSize(st.text, 1)));
        const tw = stampBold.widthOfTextAtSize(st.text, size);
        const xd = st.pos[1] === 'l' ? m : st.pos[1] === 'c' ? (dw - tw) / 2 : dw - tw - m;
        const yd = st.pos[0] === 't' ? m : st.pos[0] === 'c' ? (dh - size) / 2 : dh - size - m;
        const p = vpPoint(xd, yd + size, width, height, R);
        drawTextSafe(page, st.text, { x: p.x, y: p.y, size, font: stampBold, color: rgb(0.78, 0.12, 0.12), opacity: st.opacity, rotate: degrees(R) });
      }
    }
  }
  if (flatten) { try { doc.getForm().flatten(); } catch {} }
  return await doc.save();
}

const saveResultStatus = (res, okMsg) => status(res.ok ? okMsg + ': ' + res.path : (res.error ? 'Fehler beim Speichern: ' + res.error : 'Abgebrochen'));

async function saveAs(kind) {
  if (!S.pdfDoc) { status('Kein Dokument geöffnet'); return; }
  closeMenus();
  try {
    if (kind === 'forensic') {
      const did = await applyForensic({ silent: true });
      if (!did) { status('Keine Schwärzungen/Bearbeitungen — speichere als normales PDF.'); }
      const name = S.fileName.replace(/\.pdf$/i, '') + '-forensisch.pdf';
      const res = await window.nova.save({ defaultName: name, bytes: await buildExport({ flatten: true }), ext: 'pdf' });
      saveResultStatus(res, 'Forensisch gespeichert');
      return;
    }
    if (kind === 'pdf' || kind === 'flat') {
      status('Speichern…');
      const bytes = await buildExport({ flatten: kind === 'flat' });
      const name = kind === 'flat' ? S.fileName.replace(/\.pdf$/i, '') + '-fixiert.pdf' : S.fileName;
      const res = await window.nova.save({ defaultName: name, bytes, ext: 'pdf' });
      saveResultStatus(res, 'Gespeichert');
    } else if (kind === 'png' || kind === 'jpg') {
      await exportImages(kind);
    }
  } catch (e) { status('Fehler beim Speichern: ' + e.message); }
}

async function exportImages(fmt) {
  status('Seiten werden gerendert…');
  const baked = await buildExport({ flatten: false });
  const doc = await pdfjsLib.getDocument({ data: baked.slice(0) }).promise;
  const files = [];
  const base = S.fileName.replace(/\.pdf$/i, '');
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i); const vp = page.getViewport({ scale: 2 });
    const c = el('canvas'); c.width = vp.width; c.height = vp.height;
    await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
    const blob = await new Promise((r) => c.toBlob(r, fmt === 'png' ? 'image/png' : 'image/jpeg', 0.92));
    files.push({ name: `${base}-${String(i).padStart(3, '0')}.${fmt}`, bytes: await blobToBytes(blob) });
  }
  const res = await window.nova.saveMany({ files, subdir: base + '-Bilder' });
  status(res.ok ? `${res.count} Bilder gespeichert: ${res.path}` : (res.error ? 'Fehler beim Speichern: ' + res.error : 'Abgebrochen'));
}

async function flatten() {
  if (!S.pdfDoc) return; pushUndo();
  const bytes = await buildExport({ flatten: true });
  S.pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  S.annos = {}; S.formValues = {}; S.watermark = null; S.pageNumbers = null; S.stamp = null;
  await refresh(); readForm(); status('Formular & Notizen fixiert (flattened)');
}

// ---------------- Search ----------------
async function search(q) {
  if (!q || !S.pdfjs) return; let total = 0, first = -1;
  for (let i = 1; i <= S.pdfjs.numPages; i++) {
    const tc = await (await S.pdfjs.getPage(i)).getTextContent();
    const c = tc.items.map((it) => it.str).join(' ').toLowerCase().split(q.toLowerCase()).length - 1;
    if (c > 0 && first < 0) first = i - 1; total += c;
  }
  if (first >= 0) selectPage(first);
  status(total ? `${total} Treffer für „${q}"` : `Keine Treffer für „${q}"`);
}

// ---------------- Generic prompt modal ----------------
let promptDone = null; // ein offener Prompt zur Zeit — neuer Aufruf bricht den alten sauber ab
function showPrompt({ title, fields }) {
  return new Promise((resolve) => {
    if (promptDone) promptDone(false);
    $('#prompt-title').textContent = title;
    const body = $('#prompt-body'); body.innerHTML = '';
    const inputs = {};
    for (const f of fields) {
      const lab = el('label'); lab.textContent = f.label; body.appendChild(lab);
      let inp;
      if (f.type === 'select') { inp = el('select'); (f.options || []).forEach((o) => { const op = el('option'); op.value = o.value; op.textContent = o.label; inp.appendChild(op); }); inp.value = f.value ?? (f.options[0] && f.options[0].value); }
      else { inp = el('input'); inp.type = f.type || 'text'; inp.value = f.value ?? ''; if (f.placeholder) inp.placeholder = f.placeholder; }
      body.appendChild(inp); inputs[f.key] = inp;
      if (f.hint) { const h = el('div', 'hint'); h.textContent = f.hint; body.appendChild(h); }
    }
    const modal = $('#prompt-modal'); modal.classList.remove('hidden');
    const first = body.querySelector('input,select'); if (first) first.focus();
    const done = (ok) => {
      promptDone = null;
      modal.classList.add('hidden'); $('#prompt-ok').onclick = null; $('#prompt-cancel').onclick = null;
      if (!ok) return resolve(null);
      const out = {}; for (const k in inputs) out[k] = inputs[k].value; resolve(out);
    };
    promptDone = done;
    $('#prompt-ok').onclick = () => done(true);
    $('#prompt-cancel').onclick = () => done(false);
  });
}
// Parse "1-3,5,8" (1-based) into 0-based unique sorted indices within [0,max)
function parseRanges(str, max) {
  const set = new Set();
  for (const part of String(str).split(',')) {
    const m = part.trim().match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) { let a = +m[1], b = +m[2]; if (a > b) [a, b] = [b, a]; for (let i = a; i <= b; i++) if (i >= 1 && i <= max) set.add(i - 1); }
    else { const n = parseInt(part, 10); if (n >= 1 && n <= max) set.add(n - 1); }
  }
  return [...set].sort((a, b) => a - b);
}

// ---------------- Tile dispatch ----------------
async function dispatch(id) {
  switch (id) {
    case 'organize': case 'edit': if (await ensureDoc()) setTool('cursor'); break;
    case 'annotate': if (await ensureDoc()) setTool('highlight'); break;
    case 'sign': if (await ensureDoc()) setTool('sign'); break;
    case 'redact': if (await ensureDoc()) setTool('redact'); break;
    case 'edittext': if (await ensureDoc()) setTool('edittext'); break;
    case 'forensic': if (await ensureDoc()) await applyForensic(); break;
    case 'rotate': if (await ensureDoc()) { setTool('cursor'); status('Seiten über die Miniaturansicht links drehen (⟳).'); } break;
    case 'merge': S.pdfDoc ? await addMerge() : await opMerge(); break;
    case 'split': if (await ensureDoc()) await opSplit(); break;
    case 'remove': if (await ensureDoc()) await opRemove(); break;
    case 'extract': if (await ensureDoc()) await opExtract(); break;
    case 'img2pdf': await opImagesToPdf(); break;
    case 'pdf2img': if (await ensureDoc()) await exportImages('png'); break;
    case 'stamp': if (await ensureDoc()) await opStamp(); break;
    case 'overlay': if (await ensureDoc()) await opOverlay(); break;
    case 'compare': if (await ensureDoc()) await opCompare(); break;
    case 'watermark': if (await ensureDoc()) await opWatermark(); break;
    case 'numbers': if (await ensureDoc()) await opNumbers(); break;
    case 'metadata': if (await ensureDoc()) await opMetadata(); break;
    case 'compress': if (await ensureDoc()) await opCompress(); break;
    case 'ocr': if (await ensureDoc()) await opOcr(); break;
    case 'nup': if (await ensureDoc()) await opNup(); break;
    case 'booklet': if (await ensureDoc()) await opBooklet(); break;
    case 'scale': if (await ensureDoc()) await opScale(); break;
    case 'blank': if (await ensureDoc()) await opBlank(); break;
    case 'protect': if (await ensureDoc()) await opProtect(); break;
    case 'flatten': if (await ensureDoc()) await flatten(); break;
    case 'unlock': await opUnlock(); break;
  }
}

async function opMerge() {
  const files = await window.nova.openDialog({ multi: true }); if (files.length < 1) return;
  const doc = await PDFDocument.load(u8(files[0].bytes), { ignoreEncryption: true });
  for (let i = 1; i < files.length; i++) { const src = await PDFDocument.load(u8(files[i].bytes), { ignoreEncryption: true }); (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p)); }
  await openAndShow(await doc.save(), files.length > 1 ? 'zusammengefuehrt.pdf' : files[0].name);
  status(`${files.length} Datei(en) zusammengeführt — ${S.pdfDoc.getPageCount()} Seiten`);
}

async function opSplit() {
  const total = S.pdfDoc.getPageCount();
  const a = await showPrompt({ title: 'PDF teilen', fields: [
    { key: 'mode', label: 'Aufteilen', type: 'select', options: [{ value: 'each', label: 'Jede Seite als eigene Datei' }, { value: 'every', label: 'Alle N Seiten' }] },
    { key: 'n', label: 'N (nur bei „Alle N Seiten")', type: 'number', value: '2' }
  ] });
  if (!a) return;
  const step = a.mode === 'each' ? 1 : Math.max(1, parseInt(a.n, 10) || 1);
  const files = []; const base = S.fileName.replace(/\.pdf$/i, '');
  for (let start = 0, part = 1; start < total; start += step, part++) {
    const nd = await PDFDocument.create();
    const idx = []; for (let i = start; i < Math.min(start + step, total); i++) idx.push(i);
    (await nd.copyPages(S.pdfDoc, idx)).forEach((p) => nd.addPage(p));
    files.push({ name: `${base}-Teil${String(part).padStart(2, '0')}.pdf`, bytes: await nd.save() });
  }
  const res = await window.nova.saveMany({ files, subdir: base + '-geteilt' });
  status(res.ok ? `${res.count} Dateien gespeichert: ${res.path}` : 'Abgebrochen');
}

async function opRemove() {
  const total = S.pdfDoc.getPageCount();
  const a = await showPrompt({ title: 'Seiten entfernen', fields: [{ key: 'r', label: 'Welche Seiten?', placeholder: 'z. B. 1,3,5-8', hint: `Dokument hat ${total} Seiten` }] });
  if (!a) return;
  const idx = parseRanges(a.r, total); if (!idx.length) { status('Keine gültigen Seiten angegeben'); return; }
  if (idx.length >= total) { status('Es müssen Seiten übrig bleiben'); return; }
  for (const i of idx.slice().reverse()) S.pdfDoc.removePage(i);
  // Annotationen der überlebenden Seiten erhalten und Indizes verschieben
  const removed = new Set(idx);
  remapAnnos((o) => (removed.has(o) ? null : o - idx.filter((r) => r < o).length));
  await refresh(); status(`${idx.length} Seite(n) entfernt — ${S.pdfDoc.getPageCount()} übrig`);
}

async function opExtract() {
  const total = S.pdfDoc.getPageCount();
  const a = await showPrompt({ title: 'Seiten extrahieren', fields: [{ key: 'r', label: 'Welche Seiten?', placeholder: 'z. B. 2-5', hint: `Dokument hat ${total} Seiten` }] });
  if (!a) return;
  const idx = parseRanges(a.r, total); if (!idx.length) { status('Keine gültigen Seiten angegeben'); return; }
  const nd = await PDFDocument.create(); (await nd.copyPages(S.pdfDoc, idx)).forEach((p) => nd.addPage(p));
  const name = S.fileName.replace(/\.pdf$/i, '') + '-Auszug.pdf';
  const res = await window.nova.save({ defaultName: name, bytes: await nd.save(), ext: 'pdf' });
  status(res.ok ? `${idx.length} Seite(n) gespeichert: ${res.path}` : 'Abgebrochen');
}

async function opImagesToPdf() {
  const imgs = await window.nova.openImageDialog({ multi: true }); if (!imgs.length) return;
  const doc = await PDFDocument.create();
  for (const img of imgs) {
    const emb = img.ext === '.png' ? await doc.embedPng(u8(img.bytes)) : await doc.embedJpg(u8(img.bytes));
    const page = doc.addPage([emb.width, emb.height]); page.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
  }
  await openAndShow(await doc.save(), 'bilder.pdf');
  status(`${imgs.length} Bild(er) als PDF erstellt`);
}

async function opWatermark() {
  const a = await showPrompt({ title: 'Wasserzeichen', fields: [{ key: 't', label: 'Text', placeholder: 'z. B. VERTRAULICH', value: 'ENTWURF' }] });
  if (!a || !a.t.trim()) return;
  S.watermark = { text: a.t.trim() };
  await refreshOverlayFromExport(); status('Wasserzeichen gesetzt — beim Speichern eingebrannt');
}
async function opNumbers() {
  const a = await showPrompt({ title: 'Seitenzahlen', fields: [{ key: 'fmt', label: 'Format', type: 'select', options: [{ value: 'n', label: '1, 2, 3 …' }, { value: 'nt', label: '1 / N, 2 / N …' }] }] });
  if (!a) return; S.pageNumbers = { withTotal: a.fmt === 'nt' };
  await refreshOverlayFromExport(); status('Seitenzahlen gesetzt — beim Speichern eingebrannt');
}
// Re-render showing watermark/numbers/stamp (refresh bakes those into the
// preview without double-drawing the live annotations).
async function refreshOverlayFromExport() { await refresh(); }

async function opStamp() {
  const total = S.pdfDoc.getPageCount();
  const a = await showPrompt({ title: 'Stempel', fields: [
    { key: 'kind', label: 'Art', type: 'select', options: [{ value: 'image', label: 'Bild (PNG/JPG) — z. B. Prüfstempel' }, { value: 'text', label: 'Text' }] },
    { key: 'text', label: 'Text (nur bei Art „Text")', value: 'GEPRÜFT' },
    { key: 'pos', label: 'Position', type: 'select', value: 'tr', options: [
      { value: 'tl', label: 'Oben links' }, { value: 'tc', label: 'Oben Mitte' }, { value: 'tr', label: 'Oben rechts' },
      { value: 'cc', label: 'Mitte' },
      { value: 'bl', label: 'Unten links' }, { value: 'bc', label: 'Unten Mitte' }, { value: 'br', label: 'Unten rechts' }
    ] },
    { key: 'size', label: 'Breite in % der Seitenbreite', type: 'number', value: '20' },
    { key: 'pages', label: 'Seiten (leer = alle)', placeholder: 'z. B. 1,3-5', hint: `Dokument hat ${total} Seiten` },
    { key: 'opacity', label: 'Deckkraft in % (10–100)', type: 'number', value: '100' }
  ] });
  if (!a) return;
  const stamp = {
    kind: a.kind, pos: a.pos,
    widthPct: Math.min(100, Math.max(3, parseFloat(a.size) || 20)),
    opacity: Math.min(1, Math.max(0.1, (parseFloat(a.opacity) || 100) / 100)),
    pages: a.pages.trim() ? parseRanges(a.pages, total) : null
  };
  if (a.kind === 'image') {
    const img = await window.nova.openImageDialog(); if (!img) return;
    stamp.dataUrl = `data:image/${img.ext === '.png' ? 'png' : 'jpeg'};base64,` + bytesToB64(img.bytes);
    const im = await loadImg(stamp.dataUrl); stamp.aspect = im.height / im.width;
  } else {
    // WinAnsi-sicher halten, sonst wirft widthOfTextAtSize beim Baken
    stamp.text = [...a.text.trim()].map((ch) => (ch.charCodeAt(0) <= 0xff ? ch : '?')).join('');
    if (!stamp.text) return;
  }
  S.stamp = stamp;
  await refreshOverlayFromExport();
  status('Stempel gesetzt — beim Speichern eingebrannt');
}

async function opOverlay() {
  status('Overlay-PDF wählen (z. B. Briefkopf)…');
  const files = await window.nova.openDialog({ multi: false }); if (!files[0]) { status('Bereit'); return; }
  let src;
  try { src = await PDFDocument.load(u8(files[0].bytes), { ignoreEncryption: true }); }
  catch (e) { status('Overlay konnte nicht geladen werden: ' + e.message); return; }
  if (src.isEncrypted) { status('Overlay-PDF ist verschlüsselt — bitte zuerst entsperren.'); return; }
  const total = S.pdfDoc.getPageCount();
  const a = await showPrompt({ title: 'Briefkopf / Overlay', fields: [
    { key: 'src', label: `Overlay-Seite aus „${files[0].name}" (1–${src.getPageCount()})`, type: 'number', value: '1' },
    { key: 'pages', label: 'Auf welche Seiten legen? (leer = alle)', placeholder: 'z. B. 1 oder 2-99', hint: `Dokument hat ${total} Seiten. Das Overlay wird über den Inhalt gelegt und auf Seitengröße skaliert.` }
  ] });
  if (!a) return;
  const srcIdx = Math.min(src.getPageCount(), Math.max(1, parseInt(a.src, 10) || 1)) - 1;
  const targets = a.pages.trim() ? parseRanges(a.pages, total) : [...Array(total).keys()];
  if (!targets.length) { status('Keine gültigen Seiten angegeben'); return; }
  const [emb] = await S.pdfDoc.embedPdf(files[0].bytes, [srcIdx]);
  for (const t of targets) {
    const page = S.pdfDoc.getPage(t); const { width, height } = page.getSize();
    page.drawPage(emb, { x: 0, y: 0, width, height });
  }
  await refresh();
  status(`Overlay auf ${targets.length} Seite(n) gelegt — nicht rückgängig machbar, ggf. Datei neu öffnen.`);
}

// ---------------- Compare ----------------
let CMP = null;
async function opCompare() {
  status('Vergleichs-PDF wählen…');
  const files = await window.nova.openDialog({ multi: false }); if (!files[0]) { status('Bereit'); return; }
  status('Vergleich wird vorbereitet…');
  try {
    const aDoc = await pdfjsLib.getDocument({ data: S.bytes.slice(0) }).promise;
    const bDoc = await pdfjsLib.getDocument({ data: new Uint8Array(files[0].bytes) }).promise;
    CMP = { a: aDoc, b: bDoc, nameA: S.fileName, nameB: files[0].name, page: 0, n: Math.max(aDoc.numPages, bDoc.numPages) };
    $('#compare-modal').classList.remove('hidden');
    await renderCompare();
    status(`Vergleich: ${S.fileName} ↔ ${files[0].name}`);
  } catch (e) { status('Vergleich fehlgeschlagen: ' + e.message); }
}
async function renderCmpPage(doc, idx, scale) {
  if (idx >= doc.numPages) return null;
  const page = await doc.getPage(idx + 1);
  const vp = page.getViewport({ scale });
  const c = el('canvas'); c.width = vp.width; c.height = vp.height;
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  return c;
}
async function renderCompare() {
  if (!CMP) return;
  const host = $('#cmp-canvases'); host.innerHTML = '';
  const mode = $('#cmp-mode').value, i = CMP.page;
  $('#cmp-label').textContent = `Seite ${i + 1} / ${CMP.n}`;
  const ca = await renderCmpPage(CMP.a, i, 1.5), cb = await renderCmpPage(CMP.b, i, 1.5);
  const col = (c, cap) => {
    const d = el('div', 'cmp-col');
    if (c) d.appendChild(c); else { const m2 = el('div', 'muted-note'); m2.textContent = 'Seite fehlt in dieser Datei'; d.appendChild(m2); }
    const s = el('div', 'cmp-cap'); s.textContent = cap; d.appendChild(s); return d;
  };
  if (mode === 'side') { host.append(col(ca, CMP.nameA + ' (geöffnet)'), col(cb, CMP.nameB)); return; }
  // Differenzmodus: Abweichungen magenta auf abgesoftetem Original
  const w = Math.max(ca ? ca.width : 1, cb ? cb.width : 1), h = Math.max(ca ? ca.height : 1, cb ? cb.height : 1);
  const read = (srcC) => { const t = el('canvas'); t.width = w; t.height = h; const tc = t.getContext('2d'); tc.fillStyle = '#fff'; tc.fillRect(0, 0, w, h); if (srcC) tc.drawImage(srcC, 0, 0); return tc.getImageData(0, 0, w, h); };
  const A = read(ca), B = read(cb);
  const c = el('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
  const out = ctx.createImageData(w, h);
  let diff = 0;
  for (let p = 0; p < A.data.length; p += 4) {
    const d = Math.abs(A.data[p] - B.data[p]) + Math.abs(A.data[p + 1] - B.data[p + 1]) + Math.abs(A.data[p + 2] - B.data[p + 2]);
    if (d > 48) { out.data[p] = 226; out.data[p + 1] = 30; out.data[p + 2] = 120; out.data[p + 3] = 255; diff++; }
    else { const g = A.data[p] * 0.3 + A.data[p + 1] * 0.59 + A.data[p + 2] * 0.11; const v = 255 - (255 - g) * 0.3; out.data[p] = v; out.data[p + 1] = v; out.data[p + 2] = v; out.data[p + 3] = 255; }
  }
  ctx.putImageData(out, 0, 0);
  host.append(col(c, diff ? `${((diff / (w * h)) * 100).toFixed(2)} % der Fläche unterschiedlich` : 'Keine Unterschiede auf dieser Seite'));
}

async function opMetadata() {
  let title = '', author = '', subject = '', keywords = '';
  try { title = S.pdfDoc.getTitle() || ''; author = S.pdfDoc.getAuthor() || ''; subject = S.pdfDoc.getSubject() || ''; keywords = (S.pdfDoc.getKeywords() || ''); } catch {}
  const a = await showPrompt({ title: 'Metadaten bearbeiten', fields: [
    { key: 'title', label: 'Titel', value: title }, { key: 'author', label: 'Autor', value: author },
    { key: 'subject', label: 'Betreff', value: subject }, { key: 'keywords', label: 'Stichwörter (Komma)', value: keywords }
  ] });
  if (!a) return;
  try { S.pdfDoc.setTitle(a.title); S.pdfDoc.setAuthor(a.author); S.pdfDoc.setSubject(a.subject); S.pdfDoc.setKeywords(a.keywords ? a.keywords.split(',').map((s) => s.trim()) : []); } catch {}
  await refresh(); status('Metadaten aktualisiert');
}

function fmtBytes(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB'; }

// ---------------- Layout tools ----------------
// embedPdf wirft bei Seiten ohne Contents-Stream (z. B. komplett leere Seiten).
// Vor dem Einbetten bekommen solche Seiten einen unsichtbaren No-op-Inhalt.
async function bakedForEmbed() {
  const baked = await buildExport({ flatten: false });
  let src = await PDFDocument.load(baked.slice(0), { ignoreEncryption: true });
  let dirty = false;
  for (const p of src.getPages()) {
    let has = true; try { has = !!p.node.Contents(); } catch {}
    if (!has) { p.drawRectangle({ x: 0, y: 0, width: 0.1, height: 0.1, opacity: 0, borderOpacity: 0 }); dirty = true; }
  }
  const bytes = dirty ? await src.save() : baked;
  if (dirty) src = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
  return { bytes, src };
}
async function opNup() {
  const a = await showPrompt({ title: 'Mehrere Seiten pro Blatt', fields: [
    { key: 'n', label: 'Seiten pro Blatt', type: 'select', value: '2', options: [
      { value: '2', label: '2 nebeneinander (Querformat)' }, { value: '4', label: '4 im 2×2-Raster' }
    ] }
  ] });
  if (!a) return;
  const n = parseInt(a.n, 10);
  try {
    status('Layout wird berechnet…');
    const { bytes: baked, src } = await bakedForEmbed();
    const out = await PDFDocument.create();
    const emb = await out.embedPdf(baked.slice(0), src.getPageIndices());
    const p0 = src.getPage(0).getSize();
    const sw = n === 2 ? Math.max(p0.width, p0.height) : Math.min(p0.width, p0.height);
    const sh = n === 2 ? Math.min(p0.width, p0.height) : Math.max(p0.width, p0.height);
    const cols = 2, rows = n / 2, cw = sw / cols, ch = sh / rows, pad = 12;
    for (let i = 0; i < emb.length; i += n) {
      const sheet = out.addPage([sw, sh]);
      for (let k = 0; k < n && i + k < emb.length; k++) {
        const e2 = emb[i + k];
        const sc = Math.min((cw - pad * 2) / e2.width, (ch - pad * 2) / e2.height);
        const w = e2.width * sc, h = e2.height * sc;
        const x = (k % cols) * cw + (cw - w) / 2;
        const y = sh - (Math.floor(k / cols) + 1) * ch + (ch - h) / 2;
        sheet.drawPage(e2, { x, y, width: w, height: h });
      }
    }
    await openAndShow(await out.save(), S.fileName.replace(/\.pdf$/i, '') + '-' + n + 'up.pdf');
  } catch (e) { status('N-up fehlgeschlagen: ' + e.message); }
}

async function opBooklet() {
  try {
    status('Broschüre wird erzeugt…');
    const { bytes: baked, src } = await bakedForEmbed();
    const total = src.getPageCount();
    const N = Math.ceil(total / 4) * 4; // auf Vielfaches von 4 auffüllen (leere Plätze)
    const out = await PDFDocument.create();
    const emb = await out.embedPdf(baked.slice(0), src.getPageIndices());
    const p0 = src.getPage(0).getSize();
    const pw = Math.min(p0.width, p0.height), ph = Math.max(p0.width, p0.height);
    const order = [];
    for (let s = 0; s < N / 2; s++) order.push(s % 2 === 0 ? [N - s, s + 1] : [s + 1, N - s]);
    for (const [l, r] of order) {
      const sheet = out.addPage([pw * 2, ph]);
      const place = (no, x0) => {
        if (no > total) return;
        const e2 = emb[no - 1];
        const sc = Math.min(pw / e2.width, ph / e2.height);
        sheet.drawPage(e2, { x: x0 + (pw - e2.width * sc) / 2, y: (ph - e2.height * sc) / 2, width: e2.width * sc, height: e2.height * sc });
      };
      place(l, 0); place(r, pw);
    }
    await openAndShow(await out.save(), S.fileName.replace(/\.pdf$/i, '') + '-booklet.pdf');
    status(`Broschüre: ${order.length} Blattseiten — beidseitig drucken, an kurzer Kante wenden, mittig heften.`);
  } catch (e) { status('Broschüre fehlgeschlagen: ' + e.message); }
}

const PAPER = { a4: [595.28, 841.89], a3: [841.89, 1190.55], a2: [1190.55, 1683.78], a1: [1683.78, 2383.94], a0: [2383.94, 3370.39] };
async function opScale() {
  const a = await showPrompt({ title: 'Seiten skalieren', fields: [
    { key: 'fmt', label: 'Zielformat', type: 'select', value: 'a4', options: [
      { value: 'a4', label: 'A4' }, { value: 'a3', label: 'A3' }, { value: 'a2', label: 'A2' }, { value: 'a1', label: 'A1' }, { value: 'a0', label: 'A0' }
    ] },
    { key: 'orient', label: 'Ausrichtung', type: 'select', value: 'auto', options: [
      { value: 'auto', label: 'Automatisch (wie Original)' }, { value: 'p', label: 'Hochformat' }, { value: 'l', label: 'Querformat' }
    ], hint: 'Inhalt wird proportional eingepasst und zentriert.' }
  ] });
  if (!a) return;
  try {
    status('Skalieren…');
    const { bytes: baked, src } = await bakedForEmbed();
    const out = await PDFDocument.create();
    const emb = await out.embedPdf(baked.slice(0), src.getPageIndices());
    const [fw, fh] = PAPER[a.fmt];
    for (const e2 of emb) {
      const landscape = a.orient === 'l' || (a.orient === 'auto' && e2.width > e2.height);
      const tw = landscape ? Math.max(fw, fh) : Math.min(fw, fh);
      const th = landscape ? Math.min(fw, fh) : Math.max(fw, fh);
      const sc = Math.min(tw / e2.width, th / e2.height);
      const page = out.addPage([tw, th]);
      page.drawPage(e2, { x: (tw - e2.width * sc) / 2, y: (th - e2.height * sc) / 2, width: e2.width * sc, height: e2.height * sc });
    }
    await openAndShow(await out.save(), S.fileName.replace(/\.pdf$/i, '') + '-' + a.fmt.toUpperCase() + '.pdf');
  } catch (e) { status('Skalieren fehlgeschlagen: ' + e.message); }
}

async function opBlank() {
  try {
    status('Leerseiten werden gesucht…');
    const blank = [];
    for (let i = 0; i < S.pdfjs.numPages; i++) {
      const page = await S.pdfjs.getPage(i + 1);
      const vp = page.getViewport({ scale: 0.4 });
      const c = el('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      let ink = 0;
      for (let p = 0; p < d.length; p += 4) if (d[p] < 245 || d[p + 1] < 245 || d[p + 2] < 245) ink++;
      if (ink / (c.width * c.height) < 0.0005) blank.push(i);
    }
    if (!blank.length) { status('Keine Leerseiten gefunden.'); return; }
    if (blank.length >= S.pdfDoc.getPageCount()) { status('Alle Seiten wären leer — nichts entfernt.'); return; }
    const a = await showPrompt({ title: 'Leerseiten entfernen', fields: [
      { key: 'go', label: `${blank.length} Leerseite(n) gefunden: Seite ${blank.map((i) => i + 1).join(', ')}`, type: 'select', options: [{ value: 'yes', label: 'Jetzt entfernen' }] }
    ] });
    if (!a) return;
    for (const i of blank.slice().reverse()) S.pdfDoc.removePage(i);
    remapAnnos((idx) => (blank.includes(idx) ? null : idx - blank.filter((b) => b < idx).length));
    await refresh(); status(`${blank.length} Leerseite(n) entfernt — ${S.pdfDoc.getPageCount()} übrig`);
  } catch (e) { status('Leerseiten-Suche fehlgeschlagen: ' + e.message); }
}

async function opCompress() {
  const a = await showPrompt({ title: 'Komprimieren', fields: [
    { key: 'dpi', label: 'Auflösung', type: 'select', value: '150', options: [
      { value: '100', label: '100 dpi — kleinste Datei' },
      { value: '150', label: '150 dpi — guter Kompromiss' },
      { value: '200', label: '200 dpi — hohe Qualität' }
    ] },
    { key: 'q', label: 'JPEG-Qualität', type: 'select', value: '0.75', options: [
      { value: '0.6', label: 'Niedrig (60 %)' }, { value: '0.75', label: 'Mittel (75 %)' }, { value: '0.85', label: 'Hoch (85 %)' }
    ], hint: 'Seiten werden zu JPEG-Bildern — Text-/Vektorebene geht verloren (wie ein Scan). Bei Scans 80–90 % kleiner.' }
  ] });
  if (!a) return;
  try {
    status('Komprimieren — Seiten werden neu berechnet…');
    const baked = await buildExport({ flatten: false });
    const srcSize = baked.length;
    const bakedDoc = await PDFDocument.load(baked.slice(0), { ignoreEncryption: true });
    const rdoc = await pdfjsLib.getDocument({ data: baked.slice(0) }).promise;
    const out = await PDFDocument.create();
    const want = parseFloat(a.dpi) / 72, q = parseFloat(a.q);
    for (let i = 0; i < rdoc.numPages; i++) {
      const srcPage = bakedDoc.getPage(i);
      const { width, height } = srcPage.getSize();
      const R = pageRot(srcPage);
      const pw = R % 180 ? height : width, ph = R % 180 ? width : height;
      const page = await rdoc.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const eff = Math.min(want, 8000 / Math.max(vp1.width, vp1.height));
      const vp = page.getViewport({ scale: eff });
      const c = el('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', q));
      const jpg = await out.embedJpg(await blobToBytes(blob));
      const pg = out.addPage([pw, ph]); pg.drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
      status(`Komprimieren — Seite ${i + 1}/${rdoc.numPages}…`);
    }
    const bytes = await out.save();
    const name = S.fileName.replace(/\.pdf$/i, '') + '-komprimiert.pdf';
    const gain = srcSize > bytes.length ? `−${Math.round((1 - bytes.length / srcSize) * 100)} %` : 'keine Ersparnis';
    const res = await window.nova.save({ defaultName: name, bytes, ext: 'pdf' });
    saveResultStatus(res, `Komprimiert: ${fmtBytes(srcSize)} → ${fmtBytes(bytes.length)} (${gain}) — gespeichert`);
  } catch (e) { status('Komprimieren fehlgeschlagen: ' + e.message); }
}

async function opOcr() {
  if (!window.nova || !window.nova.ocrPage) { status('OCR ist nur in der Desktop-App verfügbar.'); return; }
  const total = S.pdfDoc.getPageCount();
  const a = await showPrompt({ title: 'OCR — Texterkennung (Deutsch + Englisch)', fields: [
    { key: 'pages', label: 'Seiten (leer = alle)', placeholder: 'z. B. 1-10', hint: `Dokument hat ${total} Seiten. Der erkannte Text wird als unsichtbare Ebene eingebettet — Suchen und Kopieren funktionieren danach. Läuft komplett lokal.` }
  ] });
  if (!a) return;
  const targets = a.pages.trim() ? parseRanges(a.pages, total) : [...Array(total).keys()];
  if (!targets.length) { status('Keine gültigen Seiten angegeben'); return; }
  try {
    const font = await S.pdfDoc.embedFont(StandardFonts.Helvetica);
    let count = 0;
    for (let k = 0; k < targets.length; k++) {
      const i = targets[k];
      status(`OCR — Seite ${i + 1} wird gelesen (${k + 1}/${targets.length})…`);
      const page = await S.pdfjs.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 });
      const sc = Math.min(300 / 72, 4000 / Math.max(vp1.width, vp1.height));
      const vp = page.getViewport({ scale: sc });
      const c = el('canvas'); c.width = vp.width; c.height = vp.height;
      const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const res = await window.nova.ocrPage({ png: await blobToBytes(blob) });
      if (!res.ok) { status('OCR fehlgeschlagen: ' + res.error); return; }
      const p = S.pdfDoc.getPage(i);
      const { width, height } = p.getSize();
      const R = pageRot(p);
      for (const w of res.words) {
        if (!w.text || !w.text.trim() || w.conf < 40) continue;
        const size = Math.max(4, (w.bbox.y1 - w.bbox.y0) / sc);
        const pt = vpPoint(w.bbox.x0 / sc, w.bbox.y1 / sc, width, height, R);
        // opacity 0: unsichtbar, aber für Suche/Kopieren/Screenreader vorhanden
        drawTextSafe(p, w.text, { x: pt.x, y: pt.y, size, font, opacity: 0, rotate: degrees(R) });
        count++;
      }
    }
    await refresh();
    status(`OCR fertig — ${count} Wörter als durchsuchbare Ebene eingebettet. Zum Behalten „Speichern" nicht vergessen.`);
  } catch (e) { status('OCR fehlgeschlagen: ' + e.message); }
}

async function opProtect() {
  const a = await showPrompt({ title: 'Passwort schützen', fields: [
    { key: 'pw', label: 'Passwort zum Öffnen', type: 'password' },
    { key: 'pw2', label: 'Passwort wiederholen', type: 'password' },
    { key: 'perm', label: 'Nach dem Öffnen erlaubt', type: 'select', value: 'all', options: [
      { value: 'all', label: 'Alles (nur Öffnen geschützt)' },
      { value: 'print', label: 'Nur Drucken' },
      { value: 'none', label: 'Nur Lesen' }
    ], hint: 'AES-Verschlüsselung — ohne Passwort lässt sich die Datei nicht öffnen.' }
  ] });
  if (!a) return;
  if (!a.pw) { status('Kein Passwort angegeben'); return; }
  if (a.pw !== a.pw2) { status('Passwörter stimmen nicht überein'); return; }
  try {
    status('Verschlüsseln…');
    const bytes = await buildExport({ flatten: false });
    const doc = await PDFDocument.load(bytes.slice(0), { ignoreEncryption: true });
    if (typeof doc.encrypt !== 'function') { status('Diese pdf-lib-Version unterstützt keine Verschlüsselung (npm install nötig).'); return; }
    const permissions = a.perm === 'all'
      ? { printing: 'highResolution', modifying: true, copying: true, annotating: true, fillingForms: true }
      : a.perm === 'print' ? { printing: 'highResolution' } : {};
    await doc.encrypt({ userPassword: a.pw, ownerPassword: a.pw, permissions });
    const out = await doc.save();
    const name = S.fileName.replace(/\.pdf$/i, '') + '-geschuetzt.pdf';
    const res = await window.nova.save({ defaultName: name, bytes: out, ext: 'pdf' });
    saveResultStatus(res, 'Verschlüsselt gespeichert');
  } catch (e) { status('Verschlüsseln fehlgeschlagen: ' + e.message); }
}

async function opUnlock() {
  const files = await window.nova.openDialog({ multi: false }); if (!files[0]) return;
  // Bewusst mit allowEncrypted: Berechtigungs-Sperren (nur Owner-Passwort) lassen
  // sich mit ignoreEncryption laden und beim Speichern ohne /Encrypt neu schreiben.
  // Ein echtes User-Passwort lässt pdf-lib gar nicht erst laden (Fehlermeldung).
  const ok = await openAndShow(files[0].bytes, files[0].name, { allowEncrypted: true });
  if (ok) status('Entsperrt geladen. Beim Speichern wird die Datei ohne Sperr-Flags (Berechtigungen) neu geschrieben. Ein echtes Öffnungs-Passwort kann nicht entfernt werden.');
}

// ---------------- Toolbar / menus ----------------
const TOOL_LABELS = { cursor: 'Auswählen', marquee: 'Markierungsrahmen', highlight: 'Markieren', draw: 'Zeichnen', text: 'Textfeld', rect: 'Rechteck', redact: 'Schwärzen', check: 'Grüner Haken', edittext: 'Text bearbeiten', image: 'Bild einfügen', sign: 'Unterschrift' };
function setTool(t) {
  const prev = S.tool; S.tool = t;
  if (t !== 'cursor' && t !== 'marquee' && S.sel) { const p = S.sel.page; S.sel = null; drawAnnos(p); } // Auswahl beim Wechsel aufheben
  document.querySelectorAll('#tool-buttons button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t));
  refreshPE();
  const hint = t === 'cursor' ? ' — Element anklicken zum Auswählen, ziehen zum Verschieben, ⌫ löscht'
    : t === 'marquee' ? ' — Rahmen aufziehen: erfasst alle Elemente darin; dann verschieben oder ⌫ löscht' : '';
  status('Werkzeug: ' + (TOOL_LABELS[t] || TOOLS.find((x) => x.id === t)?.label || t) + hint);
}
function zoom(d) { S.zoom = Math.min(4, Math.max(0.25, +(S.zoom + d).toFixed(2))); renderPages(); }
function zoomFit() { if (!S.vp1[0]) return; S.zoom = +(($('#viewer').clientWidth - 64) / S.vp1[0].w).toFixed(2); renderPages(); }
function closeMenus() { document.querySelectorAll('.menu').forEach((m) => m.classList.add('hidden')); }

async function doAct(act) {
  switch (act) {
    case 'home': showView('home'); break;
    case 'open': { const f = await window.nova.openDialog({ multi: false }); if (f[0]) await openAndShow(f[0].bytes, f[0].name); break; }
    case 'add': S.pdfDoc ? await addMerge() : await doAct('open'); break;
    case 'export-menu': { const m = $('#export-menu'); const open = m.classList.contains('hidden'); closeMenus(); if (open) m.classList.remove('hidden'); break; }
    case 'tools-menu': { const m = $('#tools-menu'); const open = m.classList.contains('hidden'); closeMenus(); if (open) m.classList.remove('hidden'); break; }
    case 'forensic': await applyForensic(); break;
    case 'undo': await undo(); break;
    case 'zoom-in': zoom(0.15); break;
    case 'zoom-out': zoom(-0.15); break;
  }
}

function buildToolsMenu() {
  const m = $('#tools-menu'); m.innerHTML = '';
  let lastG = null;
  for (const t of TOOLS) {
    if (t.g !== lastG) { const s = el('div', 'menu-sec'); s.textContent = t.g; m.appendChild(s); lastG = t.g; }
    const b = el('button'); b.innerHTML = `<i class="ph ${t.icon}"></i> ${t.label}`;
    b.onclick = () => { closeMenus(); dispatch(t.id); };
    m.appendChild(b);
  }
}

// Recent files on the start page
async function renderRecent() {
  if (!window.nova || !window.nova.getRecent) return;
  let list = []; try { list = await window.nova.getRecent(); } catch {}
  const wrap = $('#recent-group'), host = $('#recent-list');
  if (!list.length) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden'); host.innerHTML = '';
  for (const r of list) {
    const b = el('button', 'rfile');
    // Dateinamen stammen aus dem Dateisystem — nie als HTML interpretieren.
    const ico = el('i', 'ph ph-file-pdf'), meta = el('div', 'meta');
    const rname = el('div', 'rname'); rname.textContent = r.name;
    const rtime = el('div', 'rtime'); rtime.textContent = fmtTime(r.time);
    meta.append(rname, rtime); b.append(ico, meta);
    b.onclick = async () => {
      const res = await window.nova.readRecent(r.path);
      if (!res || res.missing) { status('Datei nicht gefunden: ' + r.path); renderRecent(); return; }
      await openAndShow(new Uint8Array(res.bytes), res.name);
    };
    host.appendChild(b);
  }
}
function fmtTime(t) {
  if (!t) return ''; const d = new Date(t), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const hh = String(d.getHours()).padStart(2, '0'), mm = String(d.getMinutes()).padStart(2, '0');
  return sameDay ? `heute ${hh}:${mm}` : `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()} ${hh}:${mm}`;
}

function bind() {
  document.querySelectorAll('[data-tool]').forEach((b) => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll('[data-act]').forEach((b) => b.onclick = (e) => { e.stopPropagation(); doAct(b.dataset.act); });
  document.querySelectorAll('[data-export]').forEach((b) => b.onclick = () => saveAs(b.dataset.export));
  $('#color').oninput = (e) => { S.color = e.target.value; };
  $('#size').oninput = (e) => { S.size = +e.target.value; };
  $('#search').addEventListener('input', (e) => renderTiles(e.target.value));
  $('#find').addEventListener('keydown', (e) => { if (e.key === 'Enter') search($('#find').value); });
  $('#recent-clear').onclick = async (e) => { e.stopPropagation(); if (window.nova) await window.nova.clearRecent(); renderRecent(); };
  $('#cmp-prev').onclick = () => { if (CMP && CMP.page > 0) { CMP.page--; renderCompare(); } };
  $('#cmp-next').onclick = () => { if (CMP && CMP.page < CMP.n - 1) { CMP.page++; renderCompare(); } };
  $('#cmp-mode').onchange = () => renderCompare();
  $('#cmp-close').onclick = () => { $('#compare-modal').classList.add('hidden'); CMP = null; status('Bereit'); };
  // Entf/Backspace löscht die ausgewählte Annotation (nicht beim Tippen in Feldern)
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Delete' && e.key !== 'Backspace') return;
    if (!S.sel) return;
    const t = document.activeElement;
    if (t && (t.isContentEditable || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
    e.preventDefault();
    pushUndo();
    const p = S.sel.page, list = S.sel.annos.slice(); S.sel = null;
    S.annos[p] = (S.annos[p] || []).filter((x) => !list.includes(x));
    drawAnnos(p);
    status(list.length > 1 ? `${list.length} Elemente gelöscht` : 'Element gelöscht');
  });
  buildToolsMenu();
  document.addEventListener('click', closeMenus);
}

// Drag & drop open (PDF or image)
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault(); const f = e.dataTransfer.files[0]; if (!f) return;
  const buf = new Uint8Array(await f.arrayBuffer());
  if (f.name.toLowerCase().endsWith('.pdf')) await openAndShow(buf, f.name);
  else if (/\.(png|jpe?g)$/i.test(f.name)) {
    const doc = await PDFDocument.create(); const ext = f.name.toLowerCase().endsWith('.png') ? 'png' : 'jpg';
    const emb = ext === 'png' ? await doc.embedPng(buf) : await doc.embedJpg(buf);
    const p = doc.addPage([emb.width, emb.height]); p.drawImage(emb, { x: 0, y: 0, width: emb.width, height: emb.height });
    await openAndShow(await doc.save(), f.name.replace(/\.(png|jpe?g)$/i, '.pdf'));
  }
});

// Menu + boot
if (window.nova) {
  window.nova.onMenu((action) => { if (action === 'home') showView('home'); else if (action === 'save') saveAs('pdf'); else if (action === 'find') $('#find').focus(); else if (action === 'zoom-fit') zoomFit(); else doAct(action); });
  window.nova.onOpenFileData(async ({ name, bytes }) => { await openAndShow(new Uint8Array(bytes), name); });
}

bind(); renderTiles(); renderRecent(); showView('home');
status('Bereit — Werkzeug wählen');
