# NovaPDF — portabler PDF-Editor

Vollständig lokaler, portabler PDF-Editor (Electron). Keine Cloud, kein Server, offline.
Startseite im Werkzeugraster-Stil („Was möchten Sie tun?"), klare Phosphor-Icons.

## Startseite
- Werkzeugraster („Was möchten Sie tun?") + **Zuletzt geöffnet** (letzte 12 Dateien, ein Klick zum erneuten Öffnen).
- Die Liste liegt in `%APPDATA%\NovaPDF\recent.json` — funktioniert auch, wenn die `.exe` schreibgeschützt unter *Programme* liegt.

## Werkzeuge
**Organisieren:** Seiten organisieren · zusammenführen · teilen · drehen · entfernen · extrahieren · **PDF vergleichen** (nebeneinander oder Pixel-Differenz — für Planrevisionen)
**Konvertieren:** Bilder zu PDF · PDF zu Bildern (PNG/JPG) · **Komprimieren** (Seiten als JPEG neu berechnen) · **OCR** (Texterkennung Deutsch/Englisch, komplett offline)
**Layout:** Mehrere Seiten pro Blatt (N-up 2/4) · Broschüre (Booklet-Reihenfolge für Heftbindung) · Seiten skalieren (A4–A0) · Leerseiten entfernen
**Bearbeiten:** bearbeiten · Text bearbeiten · kommentieren · signieren · schwärzen · **Stempel** (Bild/Text, z. B. Prüfstempel) · **Briefkopf/Overlay** · Wasserzeichen · Seitenzahlen · Metadaten
**Abschließen:** forensisch schwärzen · fixieren (flatten) · **Passwort schützen** (AES) · Beschränkungen entfernen

Ist eine PDF geöffnet, sind **alle** Werkzeuge über das Menü **„Werkzeuge"** direkt im Editor erreichbar — kein Wechsel zur Startseite nötig.

## Text bearbeiten & forensisch schwärzen
- **Text bearbeiten:** auf eine Textzeile klicken → Original wird abgedeckt, der Text wird editierbar.
- **Forensisch schwärzen:** Seiten mit Schwärzungen/Text-Bearbeitungen werden zu Bildern gerendert — der darunterliegende Text ist danach **physisch entfernt** (nicht kopier- oder wiederherstellbar). Andere Seiten behalten ihren Textlayer.

## OCR (Texterkennung)
- tesseract.js läuft im Main-Prozess, Sprachdaten (Deutsch + Englisch) liegen lokal in `vendor/tessdata` — **keine Internetverbindung nötig**.
- Der erkannte Text wird als unsichtbare Ebene eingebettet: Suchen, Kopieren und Screenreader funktionieren danach wie bei einem digital erzeugten PDF.

## PDF vergleichen
- Zwei Versionen nebeneinander oder als **Pixel-Differenz**: Abweichungen leuchten magenta, unveränderter Inhalt wird abgesoftet — gemacht für Planrevisionen.

## Passwortschutz & Verschlüsselung
- **Passwort schützen** verschlüsselt mit AES (`@cantoo/pdf-lib`); Berechtigungen wählbar (alles / nur Drucken / nur Lesen).
- **Öffnen verschlüsselter PDFs wird bewusst abgelehnt** — pdf-lib kann nicht entschlüsseln, ein Weiterbearbeiten würde die Datei beschädigen. Zum Entsperren fremder PDFs qpdf o. Ä. verwenden.

## Öffnen & Speichern
- **Öffnet:** PDF sowie PNG/JPG (Bilder werden automatisch zu PDF). Drag & Drop möglich.
- **Speichert als:** PDF · PDF (fixiert/gesperrt) · PDF (forensisch, Text entfernt) · PDF (verschlüsselt) · Einzelbilder PNG · Einzelbilder JPG.

## Entwicklung
```
npm install        # Electron + pdf-Libs + Phosphor + tesseract.js, kopiert Vendor-Dateien
                   # (lädt beim ersten Mal die OCR-Sprachdaten herunter, danach offline)
npm start          # startet die App
```

## Portable .exe bauen
```
npm run dist       # erzeugt release/NovaPDF-1.0.0-portable.exe
npm run dist:mac   # erzeugt release/NovaPDF-1.0.0-*.dmg (macOS)
```
Die `.exe` ist eigenständig — kopierbar auf jeden Windows-Rechner oder USB-Stick, keine Installation.

## Bewusst (noch) nicht enthalten
- **Office → PDF** (Word/Excel → PDF) — braucht LibreOffice/Office
- **PDF → Word/Excel** — braucht echte Konverter
- **Passwort entfernen** bei echter Verschlüsselung — braucht qpdf + Passwort

## Hinweise
- `Schwärzen` deckt Inhalt ab und brennt ihn beim Speichern in die Seite; für echte Entfernung „Forensisch schwärzen" verwenden.
- `Komprimieren` wandelt Seiten in JPEG-Bilder — die Textebene geht dabei verloren (bei Bedarf danach OCR anwenden).
- Liegt das Projekt in Google Drive: `node_modules/` und `release/` von der Sync ausschließen (groß).
