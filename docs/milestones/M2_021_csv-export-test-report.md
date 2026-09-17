# M2_021 - CSV Export Test Report

Milestone: `M2 - Browser CDP Health And Vbee Preview Harness`

Test date: 2026-09-16

## Module / Slice Under Test

Queue and assets CSV export: encoder, QueueService export lists, Gateway routes, static UI buttons.

## Commands Run

```bash
source ~/.nvm/nvm.sh
nvm use 24
node --check gateway/src/infrastructure/csv.js
node --check gateway/src/application/queue-service.js
node --check gateway/src/api/routes.js
node --check gateway/src/api/http-utils.js
node --check public/app.js
npm run test:m2
```

Live Gateway (isolated data dir, worker off, killed after curl):

```bash
DATA_DIR=/tmp/vf-csv-export-test PORT=3011 HOST=127.0.0.1 WORKER_ENABLED=0 npm start
curl -sS http://127.0.0.1:3011/api/queue.csv
curl -sS http://127.0.0.1:3011/api/assets.csv
curl -sS http://127.0.0.1:3011/ | rg exportQueueCsv|exportAssetsCsv
```

Context:

```bash
python3 ../context-mapping/cli.py check-consistency .
```

## Pass / Fail Result

- Syntax checks: pass
- `npm run test:m2`: **57/57 pass**, 0 fail
- Live curl on `http://127.0.0.1:3011` (isolated `DATA_DIR`, `WORKER_ENABLED=0`, then killed):
  - `POST /api/queue` with `Xin chao, "CSV" test` → 201
  - `GET /api/queue.csv` → `text/csv`, BOM present, quoted `"Xin chao, ""CSV"" test"`
  - `GET /api/assets.csv` → header-only (no assets with worker off), BOM present
  - `GET /` contains both Export CSV buttons
- Context consistency: `OK  Context files consistent.`

## Cases Covered

- RFC 4180 escaping (comma, quote, newline)
- UTF-8 BOM and CRLF
- Header-only CSV when there are no rows
- Declared columns omit `file_path`
- `listJobsForExport` is not capped at 100
- `listAssetsForExport` hides `.tmp` and is not capped at 100
- `GET /api/queue.csv` content-type and Content-Disposition
- `GET /api/assets.csv` uses export list, not the UI list
- CSV routes still return 401 when auth is on and no Bearer token is sent

## Residual Risks

- Click-to-download in the browser was not run (no browser tool in this session).
- Excel open of the BOM file was not run on Windows.

## Next Action

If needed, manually click Export CSV on Queue and Assets while Gateway is in the foreground WSL terminal, then open the file in Excel to confirm Vietnamese text.
