// Rendert icons/logo.svg mit Electron (offscreen) zu allen PNG-Icon-Größen.
// Aufruf: npx electron scripts/make-icons.js
const { app, BrowserWindow, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const iconsDir = path.join(root, 'icons');

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(iconsDir, 'logo.svg'), 'utf8');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden}svg{display:block}</style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    show: false, width: 512, height: 512, frame: false, transparent: true,
    webPreferences: { offscreen: true }
  });
  win.webContents.setZoomFactor(1);
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  // Schriften/Filter fertig rendern lassen
  await new Promise((r) => setTimeout(r, 800));

  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const base = img.getSize().width === 512 ? img : nativeImage.createFromBitmap(img.toBitmap(), { width: img.getSize().width, height: img.getSize().height });

  const out = (name, size) => {
    const resized = size === base.getSize().width ? base : base.resize({ width: size, height: size, quality: 'best' });
    fs.writeFileSync(path.join(iconsDir, name), resized.toPNG());
    console.log('icons <-', name, size + 'px');
  };
  out('icon-512.png', 512);
  out('icon-maskable-512.png', 512);
  out('icon-192.png', 192);
  out('apple-touch-icon-180.png', 180);

  // build/icon.ico + build/icon.icns — Fenster-/Dock-Icon (main.js) und Builder-Quelle.
  // Beide Container betten PNG-Daten direkt ein (ICO seit Vista, ICNS seit 10.7).
  const buildDir = path.join(root, 'build');
  fs.mkdirSync(buildDir, { recursive: true });
  const pngAt = (size) => base.resize({ width: size, height: size, quality: 'best' }).toPNG();

  const icoSizes = [256, 128, 64, 48, 32, 16];
  const icoPngs = icoSizes.map(pngAt);
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(1, 2); icoHeader.writeUInt16LE(icoSizes.length, 4);
  const entries = []; const blobs = [];
  let offset = 6 + 16 * icoSizes.length;
  icoSizes.forEach((s, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(s === 256 ? 0 : s, 0); e.writeUInt8(s === 256 ? 0 : s, 1);
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
    e.writeUInt32LE(icoPngs[i].length, 8); e.writeUInt32LE(offset, 12);
    offset += icoPngs[i].length;
    entries.push(e); blobs.push(icoPngs[i]);
  });
  fs.writeFileSync(path.join(buildDir, 'icon.ico'), Buffer.concat([icoHeader, ...entries, ...blobs]));
  console.log('build <- icon.ico', icoSizes.join('/'));

  const icnsChunks = [['ic09', 512], ['ic08', 256], ['ic07', 128]].map(([type, s]) => {
    const png = pngAt(s);
    const head = Buffer.alloc(8); head.write(type, 0, 'ascii'); head.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([head, png]);
  });
  const body = Buffer.concat(icnsChunks);
  const icnsHead = Buffer.alloc(8); icnsHead.write('icns', 0, 'ascii'); icnsHead.writeUInt32BE(body.length + 8, 4);
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), Buffer.concat([icnsHead, body]));
  console.log('build <- icon.icns 512/256/128');
  app.exit(0);
});
