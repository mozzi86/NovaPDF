# NovaPDF — portabler PDF-Editor

Vollständig lokaler, portabler PDF-Editor (Electron). Keine Cloud, kein Server, offline.
Startseite im Werkzeugraster-Stil ("Was möchten Sie tun?"), klare Phosphor-Icons.

## Startseite
- Werkzeugraster ("Was möchten Sie tun?") + **Zuletzt geöffnet** (letzte 12 Dateien, ein Klick zum erneuten Öffnen).
- Die Liste liegt in `%APPDATA%\NovaPDF\recent.json` — funktioniert auch, wenn die `.exe` schreibgeschützt unter *Programme* liegt.

## Werkzeuge
**Organisieren:** Seiten organisieren · zusammenführen · teilen · drehen · entfernen · extrahieren
**Konvertieren:** Bilder zu PDF · PDF zu Bildern (PNG/JPG)
**Bearbeiten:** bearbeiten · Text bearbeiten · kommentieren · signieren · schwärzen · Wasserzeichen · Seitenzahlen · Metadaten
**Abschließen:** forensisch schwärzen · fixieren (flatten) · Beschränkungen entfernen

Ist eine PDF geöffnet, sind **alle** Werkzeuge über das Menü **„Werkzeuge"** direkt im Editor erreichbar — kein Wechsel zur Startseite nötig.

## Text bearbeiten & forensisch schwärzen
- **Text bearbeiten:** auf eine Textzeile klicken → Original wird abgedeckt, der Text wird editierbar.
- **Forensisch schwärzen:** Seiten mit Schwärzungen/Text-Bearbeitungen werden zu Bildern gerendert — der darunterliegende Text ist danach **physisch entfernt** (nicht kopier- oder wiederherstellbar). Andere Seiten behalten ihren Textlayer.

## Öffnen & Speichern
- **Öffnet:** PDF sowie PNG/JPG (Bilder werden automatisch zu PDF). Drag & Drop möglich.
- **Speichert als:** PDF · PDF (fixiert/gesperrt) · **PDF (forensisch, Text entfernt)** · Einzelbilder PNG · Einzelbilder JPG.

## Entwicklung
```
npm install        # Electron + pdf-Libs + Phosphor, kopiert Vendor-Dateien
npm start          # startet die App
```

## Portable .exe bauen
```
npm run dist       # erzeugt release/NovaPDF-1.0.0-portable.exe
```
Die `.exe` ist eigenständig — kopierbar auf jeden Windows-Rechner oder USB-Stick, keine Installation.

## Bewusst (noch) nicht enthalten
Diese PDF24-Kacheln brauchen zusätzliche native Bibliotheken und sind daher offline nicht ohne Weiteres umsetzbar:
- **OCR** (Texterkennung) — benötigt Tesseract
- **Komprimieren** — braucht Ghostscript/qpdf
- **Office → PDF** (Word/Excel → PDF) — braucht LibreOffice/Office
- **Passwortschutz** — pdf-lib kann keine Verschlüsselung schreiben (qpdf nötig)

## Hinweise
- `Schwärzen` deckt Inhalt ab und brennt ihn beim Speichern in die Seite.
- Liegt das Projekt in Google Drive: `node_modules/` und `release/` von der Sync ausschließen (groß).
