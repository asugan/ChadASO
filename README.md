# ASO Desktop Tool (Electron + Express + SQLite)

Bu repo, coklu uygulama icin lokal ASO takip araci MVP iskeletidir.

## Stack

- Electron (desktop shell)
- Express (lokal API)
- SQLite (`better-sqlite3`)
- React + Vite (dashboard)

## Ilk kurulum

```bash
npm install
npm run dev
```

Calisma sirasinda acilan servisler:

- API: `http://127.0.0.1:4010`
- Renderer: `http://127.0.0.1:5173`
- Electron: React arayuzunu desktop penceresinde acar

## Mevcut MVP endpointleri

- `GET /health`
- `GET/POST /apps`
- `GET/POST /keywords`
- `GET/POST /locales`
- `GET/POST /targets`
- `GET /dashboard/summary`
- `POST /crawl/run` (placeholder)

## Siradaki adimlar

1. `app-store-scraper` ile crawler servisini eklemek
2. `rank_snapshots` tablosuna gercek veri yazmak
3. metadata snapshot + diff endpointlerini tamamlamak
4. Electron package/build pipeline (`electron-builder`) eklemek
