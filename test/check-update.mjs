// Launches the real Electron app and checks the startup update notice end to
// end: main process asks GitHub, renderer shows the bar, buttons behave.
//
// The expectation is derived from the running version, so this passes both ways:
// with an older version it demands the bar, with the current one it demands
// silence. To see the bar, temporarily lower "version" in package.json.
//
// Usage: node test/check-update.mjs <projectRoot> <pathToPlaywrightPackage>
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

const app = await _electron.launch({ args: [ROOT], executablePath: electronPath, cwd: ROOT });
const page = await app.firstWindow();
await page.waitForLoadState('domcontentloaded');

const res = await page.evaluate(() => window.nova.checkUpdate());
console.log('Prüfung                  :', JSON.stringify(res));
const bar = page.locator('#update-bar');

// Kein Netz ist kein Fehler der App: sie muss laufen und darf nichts anzeigen.
if (res.state === 'error') {
  const visible = await bar.isVisible();
  const usable = await page.locator('#tool-groups .tile, #tool-groups button').first().isVisible().catch(() => false);
  console.log('Ohne Netz — Streifen sichtbar:', visible, '| Oberfläche bedienbar:', usable);
  console.log(!visible && usable
    ? 'ERGEBNIS: OK (Prüfung fehlgeschlagen, App unbeeinträchtigt — das ist das gewünschte Verhalten)'
    : 'ERGEBNIS: FEHLGESCHLAGEN (App leidet unter der fehlgeschlagenen Prüfung)');
  await app.close();
  process.exit(!visible && usable ? 0 : 1);
}
const expectBar = res.state === 'update';
let ok = true;

if (expectBar) {
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
  // Version ist aktuell: der Streifen darf gar nicht erst auftauchen.
  await page.waitForTimeout(4000);
  const visible = await bar.isVisible();
  console.log('Streifen bei aktueller Version sichtbar :', visible, '(erwartet: false)');
  console.log('Hinweis: zum Sehen des Streifens "version" in package.json kurz herabsetzen.');
  ok &&= visible === false;
}

await app.close();
console.log(ok ? 'ERGEBNIS: OK' : 'ERGEBNIS: FEHLGESCHLAGEN');
process.exit(ok ? 0 : 1);
