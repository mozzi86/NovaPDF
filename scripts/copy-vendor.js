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

console.log('vendor ready ->', vendor);
