# Konsum Tracker (PWA)

## Wichtig
- Offline-Cache / „App“-Nutzung auf iOS funktioniert zuverlässig nur über **HTTPS**.
- **Lokale Daten gehen nicht verloren**: v5 migriert bestehende Einträge (LocalStorage) ohne sie zu löschen.

## Netlify Sync (mehrere Geräte)
Diese Version kann optional über **Netlify Functions + Netlify Blobs** synchronisieren.

### Voraussetzungen
- Deployment über **Git (Continuous Deployment)** oder **Netlify CLI** (damit Functions + npm Dependencies gebaut werden).
- In Netlify: **Base directory** = `konsum-tracker-pwa`  
  (damit `netlify.toml` im Base-Dir greift)

### Netlify Einstellungen (empfohlen)
- Site settings → Build & deploy:
  - Base directory: `konsum-tracker-pwa`
  - Publish directory: `.` (kommt aus netlify.toml)
  - Functions directory: `netlify/functions` (kommt aus netlify.toml)

### Auth-Gate
- Beim ersten Öffnen auf einem neuen Gerät fragt die App nach dem Passwort (standard: `PeachR`).
- Danach wird das Gerät per LocalStorage „gemerkt“ und fragt nicht erneut.

## Daten
- Lokal: Browser-Speicher (LocalStorage)
- Sync: Netlify Blobs (Store `konsum-tracker`, Key `vault/<hash>.json`)
- Export: CSV (Excel-kompatibel), Backup/Restore: JSON
