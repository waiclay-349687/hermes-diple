[English](README.md) | [简体中文](README.zh.md) | [繁體中文](README.zh-hant.md) | [日本語](README.ja.md) | [العربية](README.ar.md) | [Русский](README.ru.md) | [Français](README.fr.md) | **Deutsch** | [Español](README.es.md)

# Diple — Chatpassagen markieren und kommentieren, für die KI (Plugin für Hermes Desktop)

Markieren Sie eine Passage in einer Unterhaltung in Hermes Desktop, schreiben Sie bei Bedarf einen Kommentar dazu und senden Sie mehrere davon mit Ihrer nächsten Nachricht; die KI beantwortet jeden Kommentar einzeln, und Sie können zwischen jeder Antwort und ihrer Passage hin und her springen.

> **Der Name.** Eine *Diple* (›) ist das Zeichen, mit dem altgriechische Schreiber am Rand eine Zeile mit ihrem Kommentar verbanden — der Vorfahr des Anführungszeichens. Der chinesische Name 圈批 bedeutet „markieren und kommentieren“.

> **Inoffiziell.** Dies ist ein Community-Plugin. Es wird nicht von Nous Research oder dem Projekt Hermes Agent erstellt, geprüft oder unterstützt.

## Funktionen

- **Auswahl annotieren** — markieren Sie Text in einer Chatnachricht; sobald Sie die Maus loslassen, erscheint direkt rechts unterhalb dieser Stelle, neben dem Mauszeiger, eine Schaltfläche **Annotieren** (oder drücken Sie <kbd>⌘⇧E</kbd>). Sie funktioniert auch dann, wenn die App die Auswahl einen Moment später aufhebt. Die Passage behält ihre Herkunft: welche Sitzung, welche Nachricht, wer es gesagt hat.
- **Markierung oder Kommentar** — jede hinzugefügte Passage ist eine *Annotation*. Mit Kommentar ist sie ein *Kommentar* (die KI muss darauf antworten); ohne ist sie eine *Markierung* (nur Hintergrundmaterial).
- **Direkt an der Stelle kommentieren** — dort, wo die Schaltfläche war, öffnet sich unter der Passage ein kleiner Editor (darüber, wenn unten kein Platz ist): oben die Passage (Markdown gerendert), darunter Ihr Kommentar, unten **Speichern** und **Speichern und senden**, dazu eine Symbolschaltfläche, um die Passage durch die aktuelle Auswahl zu ersetzen.
- **Pins am Original** — annotierter Text wird hinterlegt (Kommentare zusätzlich unterstrichen) und bekommt oben rechts einen nummerierten Pin. Fahren Sie über einen Pin, um eine Karte mit drei Schaltflächen zu sehen: **Bearbeiten** (bei einer Markierung **Kommentar hinzufügen**), **Kopieren** und **Löschen**; eine gesendete Annotation bietet nur **Kopieren**.
- **Eine Leiste über dem Eingabefeld** — gespeicherte Annotationen warten dort je Sitzung als nummerierte Chips, bis Sie senden. Ein Klick auf einen Chip führt zur Passage zurück; entfernen, alle löschen (rückgängig machbar) oder Vorschau; die Liste übersteht ein Neuladen.
- **N senden ▾** — mit der nächsten Nachricht senden oder **N senden** klicken, um nur die Annotationen zu senden. Das Menü ▾ bietet **Jetzt senden** und **Für die KI kopieren** (Markdown, nichts wird gesendet).
- **Antwortmarker** — die KI markiert jeden Absatz, der einen Kommentar beantwortet; die App zeigt ihn als kleinen Chip „↩ Kommentar 2“, der zur Passage zurückspringt.
- **Hinweis auf fehlende Antworten** — überspringt eine Antwort einen Kommentar, werden Sie informiert („Kommentar 2 wurde nicht beantwortet“) und können ihn mit einem Klick zurück auf die Warteliste legen.
- **Ruhiges Hin- und Herspringen** — beim Zurückspringen wird nur gescrollt, wenn die Passage außerhalb des Bildschirms liegt, und sie bleibt hervorgehoben, ohne Aufblitzen.
- **Warteschlange, solange die KI antwortet** — „Nach der Antwort senden“ stellt den Stapel in die Warteschlange und sendet ihn, wenn der Zug endet.
- **Vorschau vor dem Senden** — sehen Sie genau, was die Chatblase zeigt und was die KI erhält, mit einer Größenschätzung gegenüber den Kontextgrenzen des Hosts.

Die Oberfläche des Plugins gibt es in allen Sprachen von Hermes Desktop: **English, 简体中文, 繁體中文, 日本語, العربية, Русский, Français, Deutsch und Español** (Arabisch von rechts nach links). Standardmäßig folgt sie der Sprache der App; Sie können in den Plugin-Einstellungen auch eine eigene wählen. Die Anweisungen an die KI bleiben bei den beiden chinesischen Oberflächen auf Chinesisch und bei allen anderen Sprachen auf Englisch.

## Screenshots

Der Editor unter der markierten Passage, geöffnet dort, wo die Schaltfläche **Annotieren** war (vereinfacht-chinesische Oberfläche):

![Der Kommentareditor unter der markierten Passage: oben die Passage, das Kommentarfeld, unten die Schaltflächen zum Speichern und Senden (auf Chinesisch)](docs/screenshots/editor.png)

Nummerierte Pins oben rechts an jeder Passage; benachbarte Pins weichen aus (chinesische Oberfläche und Beispieltext):

![Hinterlegte Passagen mit den Pins 1, 2 und 3](docs/screenshots/pins.png)

Die Karte beim Überfahren eines Pins, mit Bearbeiten · Kopieren · Löschen:

![Eine Pin-Karte mit dem Kommentar und drei Schaltflächen](docs/screenshots/pin-card.png)

Die Leiste über dem Eingabefeld und das Menü N senden ▾ (Jetzt senden, Für die KI kopieren):

![Nummerierte Chips über dem Eingabefeld und das geöffnete Sendemenü](docs/screenshots/strip-send-menu.png)

Die Bildschirmfotos entstanden in einer Sandbox mit erfundenen Unterhaltungen.

## Installation

Das Plugin hat zwei Hälften: ein Desktop-Plugin (`plugin.js`) und ein kleines Python-Backend (`plugins/diple/`). Beide werden gebraucht. In den Befehlen unten ist `~/.hermes` Ihr Hermes-Verzeichnis; für ein benanntes Profil verwenden Sie stattdessen `~/.hermes/profiles/<Name>`.

### Option A: ein Release herunterladen

1. Laden Sie `plugin.js`, `plugin.js.sha256`, `diple-python-0.2.0.zip` und `diple-python-0.2.0.zip.sha256` aus dem [neuesten Release](https://github.com/waiclay-349687/hermes-diple/releases) herunter und prüfen Sie sie:

   ```bash
   shasum -a 256 -c plugin.js.sha256
   shasum -a 256 -c diple-python-0.2.0.zip.sha256
   ```

2. Legen Sie sie an ihren Platz:

   ```bash
   mkdir -p ~/.hermes/desktop-plugins/diple ~/.hermes/plugins
   cp plugin.js ~/.hermes/desktop-plugins/diple/plugin.js
   unzip -o diple-python-0.2.0.zip -d ~/.hermes/plugins/
   ```

3. Aktivieren Sie das Backend und starten Sie Hermes Desktop neu:

   ```bash
   hermes plugins enable diple
   ```

### Option B: aus dem Quelltext

Benötigt Node.js 22 oder neuer.

```bash
git clone https://github.com/waiclay-349687/hermes-diple.git
cd hermes-diple
npm install
node scripts/install.mjs --home ~/.hermes --no-enable
hermes plugins enable diple
```

`scripts/install.mjs` baut `plugin.js` und kopiert beide Hälften in das mit `--home` angegebene Hermes-Verzeichnis (es rät nie eines). Starten Sie Hermes Desktop danach neu: Die Python-Hälfte wird nur beim Start der App geladen.

## Verwendung

1. Markieren Sie Text in einer Chatnachricht und klicken Sie neben dem Mauszeiger auf **Annotieren** (oder drücken Sie <kbd>⌘⇧E</kbd>). Der Editor öffnet sich unter der Auswahl.
2. Schreiben Sie bei Bedarf einen Kommentar und drücken Sie <kbd>Enter</kbd> oder **Speichern**; ein leerer Kommentar speichert eine Markierung. Die Annotation bekommt einen nummerierten Pin und einen Chip über dem Eingabefeld. Fügen Sie beliebig viele hinzu, aus dieser oder anderen Sitzungen.
3. Schreiben Sie Ihre Nachricht und senden Sie sie wie gewohnt, oder klicken Sie auf **N senden** (oder <kbd>⌘⇧↩</kbd>), um nur die Annotationen zu senden. Eine Quittungszeile unter Ihrer Nachricht („3 Annotationen angehängt · Ansehen, was die KI erhalten hat“) zeigt, was rausging.
4. Klicken Sie in der Antwort auf einen Chip „↩ Kommentar n“, um zu seiner Passage zurückzuspringen. Wurde ein Kommentar übersprungen, nutzen Sie **Zurücklegen** im Hinweis.

**Kopieren** auf einer Pin-Karte kopiert bei einer Markierung den Text, bei einem Kommentar Markdown: die Passage als Zitat (`> ` vor jeder Zeile), eine Leerzeile, dann Ihr Kommentar — dasselbe Format wie **Als Markdown kopieren** in „Annotationen dieser Sitzung“. Um einen Kommentar wieder zur Markierung zu machen, leeren Sie den Kommentar und speichern.

Während die KI antwortet, steuert <kbd>Enter</kbd> den laufenden Turn, und Annotationen gehen nie mit einer Steuerung mit; nutzen Sie stattdessen **Nach der Antwort senden**.

### Tastenkürzel

| Aktion | Standard | Hinweise |
| --- | --- | --- |
| Auswahl zur Warteliste hinzufügen | <kbd>⌘⇧E</kbd> | In den Tastenkürzel-Einstellungen der App änderbar |
| Warteliste senden | <kbd>⌘⇧↩</kbd> | Änderbar |
| Aus der Leiste senden | <kbd>⌘↩</kbd> | Wenn der Fokus in der Leiste über dem Eingabefeld liegt |

Die Arbeitsflächen (Schaltfläche, Editor, Pins, Leiste, Menüs) zeigen diese Tasten nicht an; die Einstellungsseite des Plugins listet sie auf.

Unter Windows und Linux entspricht <kbd>⌘</kbd> der Taste <kbd>Strg</kbd>. Die Befehlspalette (<kbd>⌘K</kbd>) enthält außerdem „Zur Warteliste hinzufügen“, „Diple: Wartende Annotationen senden“, „Diple: Vorschau, was die KI erhält“, „Diple: Annotationen dieser Sitzung“ und „Diple: Einstellungen“ (in der Sprache der Oberfläche).

## Einstellungen

Öffnen Sie sie über die Befehlspalette („Diple: Einstellungen“) oder in den Einstellungen der App.

| Einstellung | Standard | Wirkung |
| --- | --- | --- |
| Diple aktivieren | an | Hauptschalter. Aus stoppt die Tastenkürzel, die Liste, die Hinterlegung hinzugefügter Passagen und die Marker-Interaktion; die Daten bleiben erhalten. |
| Werkzeugleiste bei Auswahl anzeigen | an | Die Schaltfläche **Annotieren** neben einer Auswahl. Aus: <kbd>⌘⇧E</kbd> oder die Befehlspalette verwenden. |
| Sprache | Wie die App | Wie die App oder eine der neun Sprachen, jede in ihrem eigenen Namen. Betrifft die Oberfläche des Plugins; die Anweisungen an die KI sind bei 简体中文 / 繁體中文 auf Chinesisch, sonst auf Englisch. |
| Ruhiger Modus: nur Pins am Original | aus | Annotierte Passagen bekommen keine Hinterlegung und keine Unterstreichung, nur einen nummerierten Pin daneben. |
| Markierungen nach dem Senden behalten | an | Gesendete Annotationen behalten eine blasse Markierung am Original, „beantwortet“ / „unbeantwortet“ steht am Pin. |
| Tastenkürzel | — | Öffnet die Tastenkürzel-Einstellungen der App, um die beiden Aktionen neu zu belegen. |
| Auf Standard zurücksetzen | — | Stellt die Standardwerte wieder her (die Sprache bleibt). |

## Funktionsweise

### Was die KI erhält

Ihre Chatblase bleibt kurz: Ihr Text, dann eine Zeile pro Annotation (Nummer, Herkunft, die ersten ~40 Zeichen, Ihr Kommentar) und eine letzte Zeile `@diple:<Stapel-ID>`. Diese Zeile ist eine Kontextreferenz von Hermes: Beim Senden des Turns erweitert das Backend des Plugins sie zur **Vollversion** — dem vollständigen Text jeder Annotation, ihrer Herkunft, dem Sprecher und dem Kommentar, dazu kurze Antwortregeln (jeden Kommentar beantworten; Markierungen sind nur Hintergrund). Eine einzelne Passage über 4000 Zeichen behält ihre ersten und letzten 1500. Nutzen Sie **Vorschau** vor dem Senden oder **Ansehen, was die KI erhalten hat** danach, um beide Versionen zu sehen.

### Antwortmarker

Die Antwortregeln bitten die KI, vor jeden Absatz, der die Kommentare 1 und 3 beantwortet, einen Marker wie `::ann{b="<Stapel-ID>" n="1,3"}` zu setzen. Hermes Desktop rendert diese Direktiven; das Plugin zeichnet sie als Chips „↩ Kommentar 1, 3“ und prüft die Antwort auf Kommentare ohne Marker. Marker in Code werden ignoriert.

### Wo Daten gespeichert werden

- Die Warteliste und der Sendestatus: der Desktop-Plugin-Speicher von Hermes Desktop (lokaler Speicher der App, Schlüssel mit dem Präfix `hermes.plugin.diple.`).
- Gesendete Stapel (nötig, um `@diple:`-Referenzen zu erweitern und zu zeigen, was die KI erhalten hat): SQLite unter `~/.hermes/plugin-data/diple/data.db`.

Designentscheidungen sind in [docs/adr](docs/adr/README.md) festgehalten, die Gesamtstruktur in [docs/architecture.md](docs/architecture.md).

## Datenschutz

Alles bleibt auf Ihrem Rechner. Das Plugin stellt selbst keine Netzwerkanfragen, hat keine Telemetrie und speichert nichts außerhalb Ihres Hermes-Verzeichnisses und des lokalen Speichers der App. Annotationen erreichen Ihren Modellanbieter nur als Teil einer Nachricht, die Sie senden — genau wie Text, den Sie tippen.

## Bekannte Einschränkungen

Die wichtigsten (vollständige Liste mit Gründen in [docs/known-limitations.md](docs/known-limitations.md)):

- Schreiben zwei Fenster im selben Moment die Warteliste derselben Sitzung, kann einer der beiden Schreibvorgänge verloren gehen.
- Eine Annotation, die während einer beschäftigten Sitzung entsteht, wird gegen den Turn geprüft, aus dem sie stammt; lässt sich das nicht feststellen, bleibt sie als „unbestätigt“ markiert, statt geraten zu werden.
- Nachdem die App eine Sitzungs-ID gewechselt hat (zum Beispiel nach einer Kontextkomprimierung), wird das erneute Erweitern einer alten `@diple:`-Referenz in der neuen Sitzung abgelehnt.
- Es gibt noch keinen Eintrag im Kontextmenü: Hermes Desktop bietet Plugins keinen Erweiterungspunkt für das Kontextmenü.

## Kompatibilität

Getestet mit Hermes Agent **v0.22.5 (2026.9.24)**, Commit `bf0203a` (2026-10-22), unter macOS. Benötigt Hermes Desktop (die CLI allein lädt keine Desktop-Plugins). Andere Versionen können funktionieren, wurden aber nicht getestet; bitte melden Sie, was Sie feststellen.

## Was es unterscheidet

Der kuratierte Katalog enthält ein verwandtes Desktop-Plugin, **quote-ask** (`hermes plugins info quote-ask`): Ausgewählter Text landet als Markdown-Zitat im Eingabefeld. Es ist leicht und zustandslos. Diple dient dazu, eine lange Antwort durchzuarbeiten: Es behält eine Warteliste über mehrere Sendungen, gibt jedem Kommentar eine Nummer, die die KI beantworten muss, prüft auf fehlende Antworten, verknüpft Antworten und Passagen in beide Richtungen und sendet den vollständigen Text über eine Kontextreferenz, während die Chatblase kurz bleibt. Diple verwendet eine angepasste Version des „Auswahl → Markdown“-Konverters von quote-ask (MIT, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)). Die Plugin-IDs unterscheiden sich (`quote-ask` und `diple`), daher lassen sich beide nebeneinander installieren.

## Roadmap und Issues

- [ROADMAP.md](ROADMAP.md) — woran jetzt, als Nächstes und später gearbeitet wird.
- [Issues](https://github.com/waiclay-349687/hermes-diple/issues) — offene Fragen, Designdiskussionen und bekannte Einschränkungen.
- [CHANGELOG.md](CHANGELOG.md) — was sich in jeder Version geändert hat.
- [CONTRIBUTING.md](CONTRIBUTING.md) — Bauen und Testen.

## Lizenz

[MIT](LICENSE). Code Dritter: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
