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
  selected: 0, undo: [], watermark: null, pageNumbers: null
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

  { id: 'img2pdf', g: 'Konvertieren', icon: 'ph-images', label: 'Bilder zu PDF', desc: 'PNG/JPG in ein PDF wandeln' },
  { id: 'pdf2img', g: 'Konvertieren', icon: 'ph-image', label: 'PDF zu Bildern', desc: 'Jede Seite als PNG/JPG' },

  { id: 'edit', g: 'Bearbeiten', icon: 'ph-pencil-simple', label: 'PDF bearbeiten', desc: 'Text & Bilder hinzufügen' },
  { id: 'annotate', g: 'Bearbeiten', icon: 'ph-highlighter', label: 'Kommentieren', desc: 'Markieren, zeichnen, Notizen' },
  { id: 'edittext', g: 'Bearbeiten', icon: 'ph-note-pencil', label: 'Text bearbeiten', desc: 'Vorhandenen Text ändern & ersetzen' },
  { id: 'sign', g: 'Bearbeiten', icon: 'ph-signature', label: 'PDF signieren', desc: 'Unterschrift einfügen' },
  { id: 'redact', g: 'Bearbeiten', icon: 'ph-eraser', label: 'Schwärzen', desc: 'Inhalte unkenntlich machen' },
  { id: 'watermark', g: 'Bearbeiten', icon: 'ph-drop', label: 'Wasserzeichen', desc: 'Text über alle Seiten' },
  { id: 'numbers', g: 'Bearbeiten', icon: 'ph-list-numbers', label: 'Seitenzahlen', desc: 'Nummerierung hinzufügen' },
  { id: 'metadata', g: 'Bearbeiten', icon: 'ph-info', label: 'Metadaten', desc: 'Titel, Autor, Stichwörter' },

  { id: 'forensic', g: 'Abschließen', icon: 'ph-shield-check', label: 'Forensisch schwärzen', desc: 'Text unter Schwärzungen wirklich entfernen' },
  { id: 'flatten', g: 'Abschließen', icon: 'ph-lock-simple', label: 'PDF fixieren', desc: 'Formular & Notizen sperren' },
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
async function openAndShow(bytes, name) {
  let doc;
  try { doc = await PDFDocument.load(bytes, { ignoreEncryption: true }); }
  catch (e) { status('Fehler beim Laden: ' + e.message); return false; }
  if (doc.isEncrypted) {
    // pdf-lib kann nicht entschlüsseln — weiterarbeiten würde beim Speichern
    // eine beschädigte Datei erzeugen. Lieber ehrlich ablehnen.
    status('Diese PDF ist verschlüsselt (Passwort/Beschränkungen). Bearbeiten würde die Datei beschädigen — bitte zuerst entsperren.');
    return false;
  }
  S.pdfDoc = doc;
  S.annos = {}; S.formValues = {}; S.undo = []; S.watermark = null; S.pageNumbers = null;
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
  S.pdfjs = await pdfjsLib.getDocument({ data: saved.slice(0) }).promise;
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
    const wrap = el('div', 'page-wrap'); wrap.dataset.page = i;
    wrap.style.width = vp.width + 'px'; wrap.style.height = vp.height + 'px';
    const canvas = el('canvas', 'pdf'); canvas.width = vp.width; canvas.height = vp.height;
    wrap.appendChild(canvas);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const anno = el('canvas', 'anno'); anno.width = vp.width; anno.height = vp.height; wrap.appendChild(anno);
    const overlay = el('div', 'overlay'); overlay.dataset.page = i; wrap.appendChild(overlay);
    host.appendChild(wrap);
    drawAnnos(i); attachPageEvents(wrap, i);
  }
  $('#zoom-label').textContent = Math.round(S.zoom * 100) + '%';
}

async function renderThumbs() {
  const host = $('#thumbs'); host.innerHTML = '';
  for (let i = 0; i < S.pdfjs.numPages; i++) {
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
    else if ((a.type === 'image' || a.type === 'sign') && a._img) { ctx.drawImage(a._img, a.x * z, a.y * z, a.w * z, a.h * z); }
    else if (a.type === 'text') {
      const d = el('div', 'anno-text'); d.contentEditable = 'true'; d.textContent = a.text;
      d.style.left = a.x * z + 'px'; d.style.top = a.y * z + 'px'; d.style.color = a.color; d.style.fontSize = a.size * z + 'px';
      d.oninput = () => { a.text = d.textContent; };
      d.onblur = () => { if (!a.text.trim()) removeAnno(pageIndex, a); };
      overlay.appendChild(d);
    }
  }
}
function removeAnno(p, a) { S.annos[p] = (S.annos[p] || []).filter((x) => x !== a); drawAnnos(p); }
function pushUndo() { S.undo.push(JSON.stringify(serializeAnnos())); if (S.undo.length > 40) S.undo.shift(); }
function serializeAnnos() { const o = {}; for (const k in S.annos) o[k] = S.annos[k].map(({ _img, ...r }) => r); return { annos: o, forms: S.formValues }; }
async function undo() {
  const snap = S.undo.pop(); if (!snap) { status('Nichts rückgängig zu machen'); return; }
  const d = JSON.parse(snap); S.annos = d.annos || {}; S.formValues = d.forms || {};
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
  const { pageIndex, start, cur } = dragState; dragState = null;
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
  const clickTool = () => ['image', 'sign', 'edittext'].includes(S.tool);
  const setPE = () => { anno.style.pointerEvents = (drawTool() || clickTool()) ? 'auto' : 'none'; };
  setPE(); wrap._setPE = setPE;

  anno.addEventListener('mousedown', (e) => {
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
  });
}
function refreshPE() { document.querySelectorAll('.page-wrap').forEach((w) => w._setPE && w._setPE()); }

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
  const out = await PDFDocument.create();
  for (let i = 0; i < bakedDoc.getPageCount(); i++) {
    if (affected.has(i)) {
      const { width, height } = bakedDoc.getPage(i).getSize();
      const page = await rdoc.getPage(i + 1); const vp = page.getViewport({ scale: 200 / 72 });
      const c = el('canvas'); c.width = vp.width; c.height = vp.height;
      await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
      const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
      const png = await out.embedPng(await blobToBytes(blob));
      const pg = out.addPage([width, height]); pg.drawImage(png, { x: 0, y: 0, width, height });
    } else { const [cp] = await out.copyPages(bakedDoc, [i]); out.addPage(cp); }
  }
  S.pdfDoc = await PDFDocument.load(await out.save());
  S.annos = {}; S.formValues = {}; S.watermark = null; S.pageNumbers = null;
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
  const order = [...Array(S.pdfDoc.getPageCount()).keys()]; order.splice(to, 0, order.splice(from, 1)[0]);
  const nd = await PDFDocument.create(); (await nd.copyPages(S.pdfDoc, order)).forEach((p) => nd.addPage(p)); S.pdfDoc = nd;
  const na = {}; order.forEach((o, n) => { if (S.annos[o]) na[n] = S.annos[o]; }); S.annos = na;
  await refresh(); status('Seite verschoben');
}
function remapAnnos(map) { const o = {}; for (const k in S.annos) { const nk = map(+k); if (nk !== null) o[nk] = S.annos[k]; } S.annos = o; }

async function addMerge() {
  const files = await window.nova.openDialog({ multi: true }); if (!files.length) return;
  for (const f of files) { const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true }); (await S.pdfDoc.copyPages(src, src.getPageIndices())).forEach((p) => S.pdfDoc.addPage(p)); }
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

async function buildExport({ flatten = false } = {}) {
  const doc = await PDFDocument.load(S.bytes.slice(0), { ignoreEncryption: true });
  applyFormValues(doc);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i], { width, height } = page.getSize();
    const R = pageRot(page);
    const dw = R % 180 ? height : width, dh = R % 180 ? width : height; // displayed dims
    for (const a of (S.annos[i] || [])) {
      if (a.type === 'highlight') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: hexToRgb(a.color), opacity: .35 }); }
      else if (a.type === 'rect') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, borderColor: hexToRgb(a.color), borderWidth: a.size, opacity: 0 }); }
      else if (a.type === 'redact') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(0, 0, 0) }); }
      else if (a.type === 'cover') { const r = vpRect(a, width, height, R); page.drawRectangle({ x: r.x, y: r.y, width: r.w, height: r.h, color: rgb(1, 1, 1) }); }
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
      const t = S.watermark.text, fsz = Math.max(28, dw / (t.length * 0.5));
      const p = vpPoint(dw * 0.12, dh * 0.58, width, height, R);
      drawTextSafe(page, t, { x: p.x, y: p.y, size: fsz, font, color: rgb(0.5, 0.5, 0.55), opacity: 0.22, rotate: degrees(R + 38) });
    }
    if (S.pageNumbers) {
      const label = S.pageNumbers.withTotal ? `${i + 1} / ${pages.length}` : `${i + 1}`;
      const w = font.widthOfTextAtSize(label, 10);
      const p = vpPoint((dw - w) / 2, dh - 22, width, height, R);
      drawTextSafe(page, label, { x: p.x, y: p.y, size: 10, font, color: rgb(0.35, 0.4, 0.5), rotate: degrees(R) });
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
  S.annos = {}; S.formValues = {}; S.watermark = null; S.pageNumbers = null;
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
function showPrompt({ title, fields }) {
  return new Promise((resolve) => {
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
      modal.classList.add('hidden'); $('#prompt-ok').onclick = null; $('#prompt-cancel').onclick = null;
      if (!ok) return resolve(null);
      const out = {}; for (const k in inputs) out[k] = inputs[k].value; resolve(out);
    };
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
    case 'watermark': if (await ensureDoc()) await opWatermark(); break;
    case 'numbers': if (await ensureDoc()) await opNumbers(); break;
    case 'metadata': if (await ensureDoc()) await opMetadata(); break;
    case 'flatten': if (await ensureDoc()) await flatten(); break;
    case 'unlock': await opUnlock(); break;
  }
}

async function opMerge() {
  const files = await window.nova.openDialog({ multi: true }); if (files.length < 1) return;
  const doc = await PDFDocument.load(files[0].bytes, { ignoreEncryption: true });
  for (let i = 1; i < files.length; i++) { const src = await PDFDocument.load(files[i].bytes, { ignoreEncryption: true }); (await doc.copyPages(src, src.getPageIndices())).forEach((p) => doc.addPage(p)); }
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
  S.annos = {}; await refresh(); status(`${idx.length} Seite(n) entfernt — ${S.pdfDoc.getPageCount()} übrig`);
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
    const emb = img.ext === '.png' ? await doc.embedPng(img.bytes) : await doc.embedJpg(img.bytes);
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
// Re-render the viewer showing watermark/numbers by baking into a preview
async function refreshOverlayFromExport() {
  const preview = await buildExport({ flatten: false });
  S.pdfjs = await pdfjsLib.getDocument({ data: preview.slice(0) }).promise;
  await renderPages();
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

async function opUnlock() {
  const files = await window.nova.openDialog({ multi: false }); if (!files[0]) return;
  const ok = await openAndShow(files[0].bytes, files[0].name);
  // Echte Verschlüsselung (auch reine Berechtigungs-Sperren nutzen /Encrypt)
  // lehnt openAndShow ab — alles andere wird beim Speichern neu geschrieben.
  if (ok) status('Geladen. Beim Speichern wird die Datei ohne Sperr-Flags neu geschrieben.');
}

// ---------------- Toolbar / menus ----------------
const TOOL_LABELS = { cursor: 'Auswählen', highlight: 'Markieren', draw: 'Zeichnen', text: 'Textfeld', rect: 'Rechteck', redact: 'Schwärzen', edittext: 'Text bearbeiten', image: 'Bild einfügen', sign: 'Unterschrift' };
function setTool(t) { S.tool = t; document.querySelectorAll('#tool-buttons button').forEach((b) => b.classList.toggle('active', b.dataset.tool === t)); refreshPE(); status('Werkzeug: ' + (TOOL_LABELS[t] || TOOLS.find((x) => x.id === t)?.label || t)); }
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
