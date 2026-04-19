# Konsum Tracker (PWA)

## Wichtig: Sync (mehrere Geräte)
Der Sync nutzt **Netlify Functions + Netlify Blobs**. Dafür muss `@netlify/blobs` als Dependency installiert werden und die Function muss als „modern function“ (Request/Response, ESM) laufen.

**Wenn du per „Deploy manually“ (Drag & Drop) deployt hast**, werden npm-Dependencies oft **nicht installiert** → die Function kann `@netlify/blobs` nicht importieren und liefert 500/502. In dem Fall:
- nutze **Git-based Deploy** (Repository verbinden) oder
- deploye mit **Netlify CLI** (damit Dependencies gebundled werden).

Netlify Docs:
- Blobs: installiere `@netlify/blobs` und nutze es in Functions.  
- Dependencies werden im Build installiert.

## Deploy (Git, empfohlen)
1) Dateien aus `konsum-tracker-pwa/` ins Repo-Root kopieren (index.html, app.js, netlify/, netlify.toml, package.json …)
2) Netlify Site mit Git verbinden
3) Deploy

Danach test:
`/.netlify/functions/konsum-sync?vault=...`
- 404 = noch kein Sync-State
- 200 = State vorhanden
- 500 missing_dependency = Deploy ohne Dependency-Install
