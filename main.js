const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const fs = require('fs');
const path = require('path');

let mainWindow = null;

// Recent-files store in userData (%APPDATA%) — writable even when the app
// itself lives in a read-only location like Program Files.
const Recent = {
  file: () => path.join(app.getPath('userData'), 'recent.json'),
  get() { try { return JSON.parse(fs.readFileSync(this.file(), 'utf8')); } catch { return []; } },
  set(a) { try { fs.writeFileSync(this.file(), JSON.stringify(a)); } catch {} },
  add(p) {
    if (!p) return;
    let a = this.get().filter((x) => x.path !== p);
    a.unshift({ path: p, name: path.basename(p), time: Date.now() });
    this.set(a.slice(0, 12));
  }
};

function createWindow() {
  const iconPath = path.join(__dirname, 'build', process.platform === 'darwin' ? 'icon.icns' : 'icon.ico');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1f2430',
    title: 'NovaPDF',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // The renderer parses untrusted PDFs — never let it navigate away or open windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  buildMenu();

  // Open a file passed on the command line (e.g. "open with NovaPDF")
  const fileArg = process.argv.slice(1).find((a) => a.toLowerCase().endsWith('.pdf'));
  if (fileArg && fs.existsSync(fileArg)) {
    Recent.add(fileArg);
    mainWindow.webContents.once('did-finish-load', () => {
      const data = fs.readFileSync(fileArg);
      mainWindow.webContents.send('open-file-data', { name: path.basename(fileArg), bytes: data });
    });
  }
}

function buildMenu() {
  const template = [
    {
      label: 'Datei',
      submenu: [
        { label: 'Startseite', accelerator: 'CmdOrCtrl+H', click: () => mainWindow.webContents.send('menu', 'home') },
        { label: 'Öffnen…', accelerator: 'CmdOrCtrl+O', click: () => mainWindow.webContents.send('menu', 'open') },
        { label: 'Hinzufügen / Zusammenführen…', click: () => mainWindow.webContents.send('menu', 'add') },
        { type: 'separator' },
        { label: 'Speichern unter…', accelerator: 'CmdOrCtrl+S', click: () => mainWindow.webContents.send('menu', 'save') },
        { type: 'separator' },
        { role: 'quit', label: 'Beenden' }
      ]
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { label: 'Rückgängig', accelerator: 'CmdOrCtrl+Z', click: () => mainWindow.webContents.send('menu', 'undo') },
        { type: 'separator' },
        { label: 'Suchen…', accelerator: 'CmdOrCtrl+F', click: () => mainWindow.webContents.send('menu', 'find') }
      ]
    },
    {
      label: 'Ansicht',
      submenu: [
        { label: 'Vergrößern', accelerator: 'CmdOrCtrl+=', click: () => mainWindow.webContents.send('menu', 'zoom-in') },
        { label: 'Verkleinern', accelerator: 'CmdOrCtrl+-', click: () => mainWindow.webContents.send('menu', 'zoom-out') },
        { label: 'An Breite anpassen', accelerator: 'CmdOrCtrl+0', click: () => mainWindow.webContents.send('menu', 'zoom-fit') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Vollbild' },
        { role: 'toggleDevTools', label: 'Entwicklertools' }
      ]
    },
    {
      label: 'Hilfe',
      submenu: [
        { label: 'Über NovaPDF', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'NovaPDF', message: 'NovaPDF', detail: 'Portabler PDF-Editor\nView · Annotate · Organize · Forms · Sign · Edit\n\nSchwarz Architekturbüro' }) }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ---- IPC: file dialogs (main process owns the filesystem) ----
ipcMain.handle('dialog:open', async (_e, { multi } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'PDF öffnen',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
  });
  if (res.canceled) return [];
  res.filePaths.forEach((p) => Recent.add(p));
  return res.filePaths
    .map((p) => { try { return { name: path.basename(p), path: p, bytes: fs.readFileSync(p) }; } catch { return null; } })
    .filter(Boolean);
});

// Recent files
ipcMain.handle('recent:get', () => Recent.get().filter((r) => { try { return fs.existsSync(r.path); } catch { return false; } }));
ipcMain.handle('recent:read', (_e, p) => {
  // Only paths that are actually on the recent list — the renderer must not
  // be able to read arbitrary files.
  if (!Recent.get().some((r) => r.path === p)) return { missing: true };
  try { if (!fs.existsSync(p)) return { missing: true }; Recent.add(p); return { name: path.basename(p), path: p, bytes: fs.readFileSync(p) }; }
  catch (e) { return { missing: true }; }
});
ipcMain.handle('recent:clear', () => { Recent.set([]); return true; });

ipcMain.handle('dialog:openImage', async (_e, { multi } = {}) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Bild wählen',
    filters: [{ name: 'Bilder', extensions: ['png', 'jpg', 'jpeg'] }],
    properties: multi ? ['openFile', 'multiSelections'] : ['openFile']
  });
  if (res.canceled) return multi ? [] : null;
  const map = (p) => ({ name: path.basename(p), ext: path.extname(p).toLowerCase(), bytes: fs.readFileSync(p) });
  return multi ? res.filePaths.map(map) : map(res.filePaths[0]);
});

ipcMain.handle('dialog:save', async (_e, { defaultName, bytes, ext }) => {
  const e2 = (ext || 'pdf').replace('.', '');
  const res = await dialog.showSaveDialog(mainWindow, {
    title: 'Datei speichern',
    defaultPath: defaultName || ('dokument.' + e2),
    filters: [{ name: e2.toUpperCase(), extensions: [e2] }]
  });
  if (res.canceled) return { ok: false };
  try { fs.writeFileSync(res.filePath, Buffer.from(bytes)); }
  catch (e) { return { ok: false, error: e.message }; }
  return { ok: true, path: res.filePath };
});

// Save many files (e.g. page images) into a chosen folder
ipcMain.handle('dialog:saveMany', async (_e, { files, subdir }) => {
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Zielordner wählen',
    properties: ['openDirectory', 'createDirectory']
  });
  if (res.canceled) return { ok: false };
  try {
    let dir = res.filePaths[0];
    if (subdir) { dir = path.join(dir, subdir); fs.mkdirSync(dir, { recursive: true }); }
    for (const f of files) fs.writeFileSync(path.join(dir, path.basename(f.name)), Buffer.from(f.bytes));
    return { ok: true, path: dir, count: files.length };
  } catch (e) { return { ok: false, error: e.message }; }
});

// ---- OCR: tesseract.js läuft im Main-Prozess (Node) — dort gibt es fs/wasm
// ohne CSP-Einschränkungen; die Sprachdaten liegen lokal in vendor/tessdata.
let ocrWorkerP = null;
function getOcrWorker() {
  if (!ocrWorkerP) {
    const { createWorker } = require('tesseract.js');
    const langPath = app.isPackaged
      ? path.join(process.resourcesPath, 'tessdata')
      : path.join(__dirname, 'vendor', 'tessdata');
    ocrWorkerP = createWorker(['deu', 'eng'], 1, { langPath, gzip: true, cacheMethod: 'none' });
  }
  return ocrWorkerP;
}
ipcMain.handle('ocr:page', async (_e, { png }) => {
  try {
    const worker = await getOcrWorker();
    const { data } = await worker.recognize(Buffer.from(png), {}, { text: false, blocks: true });
    const words = [];
    for (const b of (data.blocks || []))
      for (const par of (b.paragraphs || []))
        for (const line of (par.lines || []))
          for (const w of (line.words || []))
            words.push({ text: w.text, conf: w.confidence, bbox: w.bbox });
    return { ok: true, words };
  } catch (e) { return { ok: false, error: e.message }; }
});
app.on('before-quit', () => { if (ocrWorkerP) ocrWorkerP.then((w) => w.terminate()).catch(() => {}); });

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
