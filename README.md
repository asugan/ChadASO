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

## ASA ayarlari (Search Popularity)

ASA popularity sync icin API tarafinda su env degerlerini doldur:

```bash
ASA_ORG_ID=123456
ASA_CLIENT_ID=YOUR_CLIENT_ID
ASA_CLIENT_SECRET=YOUR_CLIENT_SECRET
ASA_TOKEN_URL=https://appleid.apple.com/auth/oauth2/token
ASA_SCOPE=searchadsorg
ASA_API_BASE_URL=https://api.searchads.apple.com/api/v5
ASA_POPULARITY_PATH=/searchterms/popularity
```

Not: Apple API versiyon/path farklarinda `ASA_POPULARITY_PATH` degerini guncelleyebilirsin.

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
- `GET /rankings/latest`
- `GET /runs`
- `GET /asa/status`
- `GET /asa/popularity/latest`
- `GET /asa/runs`
- `GET /dashboard/summary`
- `POST /crawl/run` (app-store-scraper ile aktif targetlari tarar)
- `POST /asa/popularity/sync` (ASA'dan popularity verisi cekmeyi dener)

## Siradaki adimlar

1. scheduler (`node-cron`) ile otomatik crawl + ASA sync
2. metadata snapshot + diff endpointlerini tamamlamak
3. trend chart (D1/D7) ve CSV export
4. Electron package/build pipeline (`electron-builder`) eklemek
