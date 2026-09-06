// Launches the real Electron app and checks the startup update notice end to
// end: main process asks GitHub, renderer shows the bar, buttons behave, and
// the Hilfe-menu switch really stops the request.
//
// The expectation is derived from the running version, so this passes both ways:
// with an older version it demands the bar, with the current one it demands
// silence. To see the bar, temporarily lower "version" in package.json.
//
// Usage: node test/check-update.mjs <projectRoot> <pathToPlaywrightPackage>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = process.argv[2];
const PW = process.argv[3];
const SHOT = path.join(os.tmpdir(), 'novapdf-update-bar.png'); // Beleg, gehoert nicht ins Repo
const RELEASES = 'https://github.com/mozzi86/NovaPDF/releases/latest';

const pw = await import(pathToFileURL(path.join(PW, 'index.js')).href);
const _electron = pw._electron || pw.default?._electron;
const electronPath = createRequire(path.join(ROOT, 'package.json'))('electron');
const launch = () => _electron.launch({ args: [ROOT], executablePath: electronPath, cwd: ROOT });

let ok = true;

// ---- Phase 1: Startprüfung eingeschaltet (Auslieferungszustand) ----
const app = await launch();
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');

const userData = await app.evaluate(({ app: a }) => a.getPath('userData'));
const res = await page.evaluate(() => window.nova.checkUpdate());
console.log('Prüfung                  :', JSON.stringify(res));

const bar = page.locator('#update-bar');

if (res.state === 'error') {
  // Kein Netz ist kein Fehler der App: sie muss laufen und darf nichts anzeigen.
  const visible = await bar.isVisible();
  const usable = await page.locator('#tool-groups button, #tool-groups .tile').first().isVisible().catch(() => false);
  console.log('Ohne Netz — Streifen sichtbar:', visible, '| Oberfläche bedienbar:', usable);
  ok &&= !visible && usable;
  console.log(ok ? 'Ohne Netz: Verhalten korrekt (Prüfung scheitert still)' : 'Ohne Netz: FEHLER');
} else if (res.state === 'update') {
  await bar.waitFor({ state: 'visible', timeout: 20000 });
  const text = (await page.locator('#update-text').textContent()).trim();
  console.log('Streifen                 :', text);
  ok &&= text.includes(res.version) && text.includes(res.current);

  await page.screenshot({ path: SHOT });
  console.log('Screenshot               :', SHOT);

  // shell.openExternal darf im Test keinen echten Browser aufmachen.
  await app.evaluate(({ shell }) => { globalThis.__opened = null; shell.openExternal = async (u) => { globalThis.__opened = u; }; });
  await page.locator('#update-download').click();
  const opened = await app.evaluate(() => globalThis.__opened);
  console.log('Button öffnet            :', opened);
  ok &&= opened === RELEASES;

  await page.locator('#update-dismiss').click();
  const still = await bar.isVisible();
  console.log('Nach Ausblenden sichtbar :', still);
  ok &&= still === false;
} else {
  await page.waitForTimeout(4000);
  const visible = await bar.isVisible();
  console.log('Aktuelle Version — Streifen sichtbar:', visible, '(erwartet: false)');
  console.log('Hinweis: für den sichtbaren Streifen "version" in package.json kurz herabsetzen.');
  ok &&= visible === false;
}
await app.close();

// ---- Phase 2: Schalter aus — es darf gar keine Abfrage mehr laufen ----
const cfg = path.join(userData, 'settings.json');
const backup = fs.existsSync(cfg) ? fs.readFileSync(cfg, 'utf8') : null;
try {
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(cfg, JSON.stringify({ updateCheck: false }));

  const app2 = await launch();
  const page2 = await app2.firstWindow();
  await page2.waitForLoadState('domcontentloaded');
  await page2.waitForTimeout(6000); // die Startprüfung liefe nach 2,5 s
  const visible2 = await page2.locator('#update-bar').isVisible();
  const stillWorks = await page2.evaluate(() => window.nova.checkUpdate());
  console.log('Schalter aus — Streifen sichtbar:', visible2, '(erwartet: false)');
  console.log('Schalter aus — Prüfung von Hand :', stillWorks.state, '(muss weiter funktionieren)');
  ok &&= visible2 === false && Boolean(stillWorks.state);
  // Beweiskraft: nur wenn Phase 1 ein Update gefunden hat, sagt ein fehlender
  // Streifen etwas aus — sonst waere er auch mit Schalter "ein" nicht da.
  console.log(res.state === 'update'
    ? 'Schalter aus: aussagekräftig (Phase 1 hatte ein Update gefunden)'
    : 'Schalter aus: nur Rauchtest — für den echten Beweis "version" herabsetzen und erneut laufen lassen');
  await app2.close();
} finally {
  if (backup === null) { try { fs.unlinkSync(cfg); } catch {} }
  else fs.writeFileSync(cfg, backup);
}

console.log(ok ? 'ERGEBNIS: OK' : 'ERGEBNIS: FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
