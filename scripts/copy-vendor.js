// Copies the browser builds of pdf.js and pdf-lib from node_modules into vendor/
// so the renderer can load them locally with <script>/<module> tags — no bundler,
// fully offline.
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'vendor');
fs.mkdirSync(vendor, { recursive: true });

function copy(from, to) {
  const dest = path.join(vendor, to);
  fs.copyFileSync(from, dest);
  console.log('vendor <-', path.relative(root, from));
}

function resolveFirst(candidates) {
  for (const c of candidates) {
    const p = path.join(root, 'node_modules', c);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// pdf-lib UMD bundle — @cantoo/pdf-lib is a drop-in fork (same PDFLib global)
// that additionally supports writing encrypted PDFs (doc.encrypt()).
const pdfLib = resolveFirst(['@cantoo/pdf-lib/dist/pdf-lib.min.js', 'pdf-lib/dist/pdf-lib.min.js', 'pdf-lib/dist/pdf-lib.js']);
if (pdfLib) copy(pdfLib, 'pdf-lib.min.js');
else console.warn('!! pdf-lib build not found');

// pdf.js ESM build + worker
const pdfMjs = resolveFirst(['pdfjs-dist/build/pdf.min.mjs', 'pdfjs-dist/build/pdf.mjs']);
if (pdfMjs) copy(pdfMjs, 'pdf.mjs');
else console.warn('!! pdf.js build not found');

const pdfWorker = resolveFirst(['pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs-dist/build/pdf.worker.mjs']);
if (pdfWorker) copy(pdfWorker, 'pdf.worker.mjs');
else console.warn('!! pdf.js worker not found');

// Phosphor icon font (regular weight): css + font files into vendor/phosphor/
const phSrc = path.join(root, 'node_modules', '@phosphor-icons', 'web', 'src', 'regular');
if (fs.existsSync(phSrc)) {
  const phDest = path.join(vendor, 'phosphor');
  fs.mkdirSync(phDest, { recursive: true });
  for (const f of ['style.css', 'Phosphor.woff2', 'Phosphor.woff', 'Phosphor.ttf']) {
    const from = path.join(phSrc, f);
    if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(phDest, f)); console.log('vendor <- phosphor/' + f); }
  }
} else console.warn('!! phosphor icons not found');

// tesseract.js browser build (lib + worker + all wasm core variants) for the
// PWA OCR path. The renderer picks the right core via SIMD detection.
const tessDest = path.join(vendor, 'tesseract');
fs.mkdirSync(tessDest, { recursive: true });
const tDist = path.join(root, 'node_modules', 'tesseract.js', 'dist');
for (const f of ['tesseract.min.js', 'worker.min.js']) {
  const from = path.join(tDist, f);
  if (fs.existsSync(from)) { fs.copyFileSync(from, path.join(tessDest, f)); console.log('vendor <- tesseract/' + f); }
  else console.warn('!! tesseract dist missing: ' + f);
}
const tCore = path.join(root, 'node_modules', 'tesseract.js-core');
if (fs.existsSync(tCore)) {
  for (const f of fs.readdirSync(tCore)) {
    if (/\.(wasm|js)$/.test(f)) fs.copyFileSync(path.join(tCore, f), path.join(tessDest, f));
  }
  console.log('vendor <- tesseract core files');
} else console.warn('!! tesseract.js-core not found');

// OCR-Sprachdaten (tesseract.js): einmalig herunterladen, danach offline.
// tessdata_fast ist klein (~2-6 MB pro Sprache) und für Scans völlig ausreichend.
const https = require('https');
const tessdata = path.join(vendor, 'tessdata');
fs.mkdirSync(tessdata, { recursive: true });
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) return download(res.headers.location, dest).then(resolve, reject);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const file = fs.createWriteStream(dest);
      res.pipe(file); file.on('finish', () => file.close(resolve)); file.on('error', reject);
    }).on('error', reject);
  });
}
(async () => {
  for (const l of ['deu', 'eng']) {
    const dest = path.join(tessdata, l + '.traineddata.gz');
    if (fs.existsSync(dest) && fs.statSync(dest).size > 100000) { console.log('tessdata ok:', l); continue; }
    try {
      await download(`https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/${l}.traineddata.gz`, dest);
      console.log('tessdata <-', l);
    } catch (e) {
      console.warn(`!! tessdata-Download fehlgeschlagen (${l}): ${e.message} — OCR braucht diese Datei; npm run copy-vendor mit Internet wiederholen`);
    }
  }
  console.log('vendor ready ->', vendor);
})();
