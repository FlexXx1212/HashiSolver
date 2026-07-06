# HashiSolver

Reine Browser-SPA für Hashiwokakero / Hashi.

## Aktueller Stand

- Screenshot hochladen
- Inseln aus hellen Kreis-/Zahlen-Elementen grob erkennen
- Erkennung manuell korrigieren
  - Inseln hinzufügen
  - Inseln löschen
  - Zahlen ändern
  - Brücken durch Klick zwischen zwei Inseln setzen
- Next-Move-Button mit logischer Begründung
- Kein Backtracking, kein Raten
- GitHub-Pages-Deployment per GitHub Actions

## Bedienung

1. Screenshot hochladen.
2. `Inseln erkennen` klicken.
3. Erkannte Inseln kontrollieren und Zahlen rechts korrigieren.
4. Fehlende Inseln mit `Insel hinzufügen` oder Shift+Klick ergänzen.
5. Brücken durch Klick auf zwei ausgerichtete Inseln setzen.
6. `Next Move` klicken.

## Hinweise zur Erkennung

Die erste Erkennung ist bewusst konservativ und verwendet keine externe OCR-Library. Zahlen werden aktuell nicht zuverlässig erkannt und stehen nach der Erkennung erst einmal auf `1`. Der Korrekturmodus ist daher Teil des Workflows.

Nächste sinnvolle Ausbaustufe: Template-/OCR-Erkennung für Ziffern 1-8 und Grid-Snapping.
