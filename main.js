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
  },
  // Bis v1.1.0 hieß die App "NovaPDF". userData leitet sich vom App-Namen ab und
  // liegt seit der Umbenennung woanders, sonst starten Bestandsnutzer ohne
  // "Zuletzt geöffnet". Beide alten Ordner prüfen: gepackt benennt Electron das
  // Profil nach productName ("NovaPDF"), im Dev-Start nach name ("nova-pdf").
  // Das alte Profil bleibt unangetastet — nur kopieren, damit ein Downgrade
  // nichts verliert.
  migrateLegacyProfile() {
    try {
      const dest = this.file();
      if (fs.existsSync(dest)) return;
      const appData = app.getPath('appData');
      const legacy = ['NovaPDF', 'nova-pdf']
        .map((n) => path.join(appData, n, 'recent.json'))
        .find((f) => f !== dest && fs.existsSync(f));
      if (!legacy) return;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(legacy, dest);
      console.log('recent.json übernommen aus', legacy);
    } catch {}
  }
};

// ---- Update check ----------------------------------------------------------
// The portable build cannot replace itself: it runs from a temp unpack dir, does
// not know where its own .exe was put, and here that place is Program Files,
// which needs admin rights. So this only NOTIFIES — ask GitHub for the latest
// release, compare tags, let the renderer show a bar with a download button.
// No document data leaves the machine and a failed request is silently ignored,
// so the app stays usable with no network at all.
const UPDATE_API = 'https://api.github.com/repos/mozzi86/NovaPDF/releases/latest';
const UPDATE_PAGE = 'https://github.com/mozzi86/NovaPDF/releases/latest';

function fetchLatestRelease() {
  return new Promise((resolve, reject) => {
    const req = require('https').get(UPDATE_API, {
      headers: { 'User-Agent': 'BIT-Nova-PDF/' + app.getVersion(), Accept: 'application/vnd.github+json' },
      timeout: 8000
    }, (res) => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error('HTTP ' + res.statusCode)); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; if (body.length > 512 * 1024) req.destroy(new Error('Antwort zu groß')); });
      res.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitüberschreitung')));
    req.on('error', reject);
  });
}

// Part by part and numeric, so 1.1.10 counts as newer than 1.1.9.
function isNewer(remote, local) {
  const parts = (v) => String(v).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const a = parts(remote), b = parts(local);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

async function checkForUpdate() {
  const current = app.getVersion();
  try {
    const rel = await fetchLatestRelease();
    const version = String(rel.tag_name || '').replace(/^v/, '');
    if (!version) throw new Error('Release ohne tag_name');
    if (!isNewer(version, current)) return { state: 'current', version, current };
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-available', { version, current });
    return { state: 'update', version, current };
  } catch (e) {
    return { state: 'error', error: e.message, current };
  }
}

function createWindow() {
  rendererReady = false;
  // Fenster-/Taskleisten-Icon. Die .ico/.icns der Installer erzeugt
  // electron-builder aus derselben PNG (siehe build.win/build.mac).
  const iconPath = path.join(__dirname, 'icons', 'icon-512.png');
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#1f2430',
    title: 'BIT-Nova PDF',
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

  mainWindow.webContents.once('did-finish-load', () => {
    rendererReady = true;
    // Erst das Fenster benutzbar machen, dann nach Updates sehen.
    setTimeout(() => { checkForUpdate().catch(() => {}); }, 2500);
    // macOS: Datei aus Finder-Doppelklick (open-file kam vor dem Fensteraufbau)
    if (pendingOpen) { sendOpenFile(pendingOpen); pendingOpen = null; return; }
    // Windows/Linux/CLI: Datei als Programmargument
    const fileArg = process.argv.slice(1).find((a) => a.toLowerCase().endsWith('.pdf'));
    if (fileArg && fs.existsSync(fileArg)) sendOpenFile(fileArg);
  });
}

// Datei an den Renderer schicken (Recent-Liste inklusive)
let pendingOpen = null;
let rendererReady = false;
function sendOpenFile(p) {
  if (!p || !fs.existsSync(p)) return;
  try {
    const data = fs.readFileSync(p);
    Recent.add(p);
    mainWindow.webContents.send('open-file-data', { name: path.basename(p), bytes: data });
  } catch {}
}

// macOS: Doppelklick auf eine PDF im Finder / "Öffnen mit BIT-Nova PDF".
// Feuert ggf. schon vor app.whenReady — Listener muss früh registriert sein.
app.on('open-file', (e, p) => {
  e.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed() && rendererReady) {
    sendOpenFile(p);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  } else {
    pendingOpen = p;
  }
});

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
        { label: 'Drucken…', accelerator: 'CmdOrCtrl+P', click: () => mainWindow.webContents.send('menu', 'print') },
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
        {
          label: 'Nach Updates suchen…',
          click: async () => {
            const r = await checkForUpdate();
            if (r.state === 'update') return; // der Hinweisstreifen im Fenster sagt schon Bescheid
            dialog.showMessageBox(mainWindow, r.state === 'current'
              ? { type: 'info', title: 'Update', message: 'BIT-Nova PDF ist aktuell.', detail: 'Installiert: ' + r.current }
              : { type: 'warning', title: 'Update', message: 'Prüfung nicht möglich.', detail: 'Installiert: ' + r.current + '\n' + r.error });
          }
        },
        { type: 'separator' },
        { label: 'Über BIT-Nova PDF', click: () => dialog.showMessageBox(mainWindow, { type: 'info', title: 'BIT-Nova PDF', message: 'BIT-Nova PDF ' + app.getVersion(), detail: 'Portabler PDF-Editor\nView · Annotate · Organize · Forms · Sign · Edit\n\nIhre Dokumente verlassen diesen Rechner nicht. Beim Start fragt das Programm einmal bei github.com nach, ob eine neuere Version vorliegt — dabei werden keine Dateien oder Dokumentdaten übertragen.\n\nBIT-Atelier · Schwarz Architekturbüro' }) }
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

// Update: der Renderer darf NICHT sagen, welche Adresse geöffnet wird — er
// verarbeitet fremde PDFs. Das Ziel steht deshalb fest im Hauptprozess.
ipcMain.handle('update:check', () => checkForUpdate());
ipcMain.handle('update:download', () => { shell.openExternal(UPDATE_PAGE); return true; });

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

app.whenReady().then(() => { Recent.migrateLegacyProfile(); createWindow(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
