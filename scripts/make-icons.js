// Rendert icons/logo.svg mit Electron (offscreen) zu allen PNG-Icon-Größen.
// Aufruf: npm run make-icons
//
// Nur PNGs: die .ico/.icns für die Installer erzeugt electron-builder selbst aus
// icons/icon-512.png, und das Fenster-Icon in main.js lädt dieselbe PNG direkt.
const { app, BrowserWindow } = require('electron');
const UPNG = require('@pdf-lib/upng').default || require('@pdf-lib/upng');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'icons');

// Maskable: Android beschneidet das Icon auf einen Kreis/Squircle. Nur die
// mittleren ~80 % sind garantiert sichtbar, deshalb wird der Vordergrund
// (#mark) hineinskaliert — der Hintergrund bleibt vollflächig.
const MASKABLE_SCALE = 0.72;

async function render(win, svg, scaleMark) {
  const marked = scaleMark
    ? svg.replace('<g id="mark">', `<g id="mark" transform="translate(256,256) scale(${MASKABLE_SCALE}) translate(-256,-256)">`)
    : svg;
  if (scaleMark && marked === svg) throw new Error('logo.svg: <g id="mark"> nicht gefunden — Maskable-Icon waere identisch zum normalen');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block}</style></head><body>${marked}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // Auf Schriften und einen echten Frame warten, statt blind zu schlafen.
  await win.webContents.executeJavaScript(
    'document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))'
  );
  return win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
}

// Electrons toPNG() komprimiert kaum (512px ≈ 217 kB). Die Icons haben wenige
// hundert echte Farben, daher ist die palettierte Fassung optisch identisch,
// aber ~3x kleiner — spürbar, weil der Service Worker sie alle vorlädt.
function writePng(file, image) {
  const { width, height } = image.getSize();
  const bgra = image.toBitmap();
  const rgba = Buffer.allocUnsafe(bgra.length);
  for (let i = 0; i < bgra.length; i += 4) {
    rgba[i] = bgra[i + 2]; rgba[i + 1] = bgra[i + 1]; rgba[i + 2] = bgra[i]; rgba[i + 3] = bgra[i + 3];
  }
  const png = Buffer.from(UPNG.encode([rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.length)], width, height, 256));
  fs.writeFileSync(file, png);
  console.log('icons <-', path.basename(file), width + 'px', Math.round(png.length / 1024) + ' kB');
}

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(iconsDir, 'logo.svg'), 'utf8');
  const win = new BrowserWindow({
    show: false, width: 512, height: 512, frame: false, transparent: true,
    webPreferences: { offscreen: true }
  });
  win.webContents.setZoomFactor(1);

  // Auf HiDPI-/skalierten Displays liefert capturePage mehr Pixel als die
  // logischen 512 (z. B. 748 bei 146 %). Das ist willkommenes Supersampling —
  // jede Zielgröße wird ohnehin aus dem Rohbild heruntergerechnet.
  const fit = (img, size) => (img.getSize().width === size ? img : img.resize({ width: size, height: size, quality: 'best' }));

  const base = await render(win, svg, false);
  writePng(path.join(iconsDir, 'icon-512.png'), fit(base, 512));
  writePng(path.join(iconsDir, 'icon-192.png'), fit(base, 192));
  writePng(path.join(iconsDir, 'apple-touch-icon-180.png'), fit(base, 180));

  const maskable = await render(win, svg, true);
  writePng(path.join(iconsDir, 'icon-maskable-512.png'), fit(maskable, 512));

  app.exit(0);
}).catch((e) => { console.error('make-icons fehlgeschlagen:', e.message); app.exit(1); });
