# Design Review Response - Claude Critique

Nguồn critique: [artifacts/claude-critique-of-migration-plan.md](artifacts/claude-critique-of-migration-plan.md) (from new critique tool) 
Ngày phản hồi: 2026-05-25  
Mục tiêu: chuyển các câu hỏi phản biện thành quyết định thiết kế và sửa đổi migration plan.

## 1. Kết luận tổng

Critique của Claude đúng ở phần quan trọng nhất: migration plan cũ mới mô tả "tách folder/module", nhưng chưa đủ cơ chế để ép boundary, chưa thiết kế lifecycle Tauri-Gateway, chưa có audit DB, và chưa có test harness cho Vbee WS protocol.

Vì vậy migration plan cần sửa theo 5 hướng:

1. Thêm phase nền tảng cho Tauri-Gateway lifecycle trước Gateway Core.
2. Thêm boundary enforcement bằng dependency direction, interfaces và lint/import rules.
3. Thêm DB backup/audit/reconciliation trước và sau migration.
4. Thêm Vbee protocol test harness, đặc biệt frame `GET_REMAINING_PREVIEW`.
5. Tách phase có thể chạy song song: UI migration, Fake/Official Vbee adapter, BrowserService.

## 2. Architecture critique

### 2.1 Gateway Core có chỉ relocate complexity không?

Đánh giá: critique đúng.

Folder structure không đủ. Gateway Core phải có boundary enforcement.

Quyết định sửa:

- Gateway chia thành layer có dependency direction rõ:

```text
api -> application -> domain -> ports
infrastructure -> ports
```

- Domain/application không import trực tiếp Playwright, fs, SQLite raw, hoặc Vbee endpoint.
- Browser/Vbee/File/DB là adapters được inject qua ports.
- Thêm rule: worker chỉ gọi service interface, không import adapter cụ thể.

Boundary tối thiểu cho MVP:

```text
queue-service       -> db-port
job-runner          -> vbee-port, file-port, delay-port, db-port
vbee-service        -> browser-port optional
browser-adapter     -> playwright
file-service        -> fs
sqlite-repository   -> better-sqlite3
```

Anti-pattern bị cấm:

```js
// Forbidden inside job-runner:
const { chromium } = require('playwright');
const Database = require('better-sqlite3');
const fs = require('fs');
```

### 2.2 Gateway Core là SPOF lớn hơn?

Đánh giá: đúng, nhưng chấp nhận được cho local single-user nếu có lifecycle manager.

Quyết định sửa:

- Tauri phải quản lý Gateway như supervised local service.
- `/health` không được crash nếu CDP hoặc Vbee unavailable.
- UI phải có degraded mode: app mở được, queue button disabled nếu Gateway/browser chưa ready.
- Gateway phải recover job `processing` khi restart.

Health response chuẩn:

```json
{
  "ok": true,
  "gateway": "running",
  "db": "ok",
  "browserCdp": "unavailable",
  "worker": "running",
  "degraded": true
}
```

## 3. Risk critique

### 3.1 Tauri-Gateway lifecycle là prerequisite

Đánh giá: đúng tuyệt đối. Đây phải là Phase 1, không phải Phase 9.

Quyết định sửa:

Runtime order mới:

```text
Phase 1: Lifecycle manager
Phase 2: Gateway Core skeleton
Phase 3: DB migration/audit
```

Cơ chế MVP:

- Dev: Tauri gọi `scripts/start-gateway-local.bat`.
- MVP packaged: Tauri sidecar binary hoặc bundled Node runtime sau khi prototype ổn.
- Không dùng Podman làm default.

Lifecycle requirement:

- Detect port conflict.
- Start Gateway nếu chưa chạy.
- Poll `/health` mỗi 3-5 giây.
- Restart Gateway nếu process do Tauri spawn bị crash.
- Không kill Gateway nếu process không phải do app spawn.
- Shutdown Gateway on app close chỉ khi do app spawn.

### 3.2 Windows file lock

Đánh giá: đúng, cần đưa vào acceptance test.

Quyết định sửa:

- File Service phải retry rename/download cleanup khi gặp `EPERM`, `EBUSY`.
- Audio preview không giữ file handle lâu; browser stream phải release object URL khi đổi file.
- Test Windows-specific:
  - giữ file handle đọc `.mp3`, thử replace/rename.
  - antivirus/WAL lock simulation bằng retry policy.

Retry policy đề xuất:

```text
rename retry: 5 lần
backoff: 200ms, 500ms, 1s, 2s, 5s
fail -> status=failed_file_lock
```

## 4. DB critique

### 4.1 Migration bỏ sót file tồn tại nhưng download_complete=0

Đánh giá: đúng.

Quyết định sửa:

Thêm audit trước migration:

```text
DB rows:
- done candidates: download_complete=1 AND file_path IS NOT NULL
- suspicious: download_complete=0 AND file_path IS NOT NULL
- missing file: file_path IS NOT NULL but file does not exist

Disk files:
- audio file exists but no queue/log/asset row
- .tmp older than threshold
```

Suspicious rows không tự động bỏ qua. Chuyển thành report và cho phép reconcile.

### 4.2 `insert audio_assets` và `update queue done` phải cùng transaction

Đánh giá: đúng.

Quyết định sửa:

Sau khi `fs.rename()` thành công, các write DB sau phải nằm trong một SQLite transaction:

```js
db.transaction(() => {
  insertAudioAsset.run(asset);
  updateQueueDone.run(job.id);
  insertTtsLog.run(log);
})();
```

Idempotency:

- `audio_assets.source_job_id` nên unique.
- Retry ở trạng thái `finalizing` phải check asset existing trước.

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_assets_source_job
ON audio_assets(source_job_id);
```

## 5. Phase critique

### 5.1 Phase 4 và 5 nên tách song song

Đánh giá: đúng.

Quyết định sửa:

Tách Phase 5 cũ thành:

- Phase 4A: `FakeVbeeAdapter` và `OfficialApiAdapter` skeleton, không cần BrowserService.
- Phase 4B: BrowserService + Playwright CDP.
- Phase 4C: `BrowserSessionAdapter`, phụ thuộc 4B.

### 5.2 UI migration có thể bắt đầu từ Phase 1

Đánh giá: đúng.

Quyết định sửa:

UI migration bắt đầu ngay khi có:

```text
GET /health
POST /api/queue
GET /api/queue
GET /api/assets
```

Dùng feature flag:

```text
USE_GATEWAY_CORE=true
```

UI không đợi worker thật. Fake worker đủ để phát triển UI sớm.

## 6. Rollback critique

### 6.1 Migration phải chạy trên DB copy trước

Đánh giá: đúng.

Quyết định sửa:

Trước mọi migration:

```text
1. Stop Gateway.
2. Copy tts.db, tts.db-wal, tts.db-shm nếu tồn tại.
3. Run migration dry-run trên copy.
4. Run audit report.
5. Chỉ chạy thật nếu report không có blocker.
```

### 6.2 File naming rollback không thực tế

Đánh giá: đúng.

Quyết định sửa:

Không migrate/rename file cũ trong MVP. File Service mới chỉ áp dụng naming convention mới cho file mới.

Để code cũ tìm file:

- Không đổi `relative_path` của file cũ.
- `audio_assets.relative_path` trỏ chính xác file hiện có.
- Sound Editor dùng `audio_assets.relative_path`, không suy đoán naming convention.

## 7. Vbee critique

### 7.1 `GET_REMAINING_PREVIEW` cần test

Đánh giá: đúng.

Quyết định sửa:

Tạo Vbee WS protocol recorder/test harness:

- Capture frames sent/received.
- Assert sequence tối thiểu:

```text
server INIT
client INIT status=1
client SYNTHESIS
server SYNTHESIS IN_PROGRESS
server SYNTHESIS SUCCESS
client GET_REMAINING_PREVIEW
server GET_REMAINING_PREVIEW
```

Nếu frame cuối không gửi được, job không được coi là preview success hoàn chỉnh; trạng thái nên là:

```text
done_with_protocol_warning
```

### 7.2 Presigned URL TTL phải download trong cùng async chain

Đánh giá: đúng.

Quyết định sửa:

`VbeeService.convert()` không được enqueue `audioUrl` cho worker khác. Nó phải gọi File Service trực tiếp trong cùng job execution chain:

```text
JobRunner
  -> VbeeService.convert()
  -> returns audioUrl
  -> immediately FileService.downloadAndFinalize()
```

Không có queue buffer giữa `audioUrl` và download.

## 8. MVP critique

### 8.1 App không được crash khi Brave chưa chạy

Đánh giá: đúng.

Quyết định sửa:

- Gateway start được dù CDP unavailable.
- `/health` trả degraded state, không throw 500.
- UI hiển thị trạng thái:
  - Gateway ready.
  - Browser not connected.
  - Button "Start Browser" hoặc hướng dẫn start.
- Queue button có thể disabled nếu workflow cần browser.

### 8.2 Acceptance test không chờ delay thật

Đánh giá: đúng.

Quyết định sửa:

Test mode:

```text
DELAY_POLICY=none
VBEE_ADAPTER=fake
```

Delay logic test riêng bằng unit test:

```text
text 180 words, wpm 180 -> around 59s before jitter/clamp
empty text -> min delay
huge text -> max delay
```

Integration test không chờ 3 phút.

## 9. Ba blocker cần sửa vào migration plan

### Blocker 1: Tauri-Gateway lifecycle

Action:

- Thêm phase riêng trước Gateway Core.
- Thiết kế spawn, health polling, restart, port conflict, shutdown.

### Blocker 2: Vbee WS protocol test

Action:

- Thêm protocol recorder.
- Test sequence frame.
- Không chỉ test "có audio_link".

### Blocker 3: DB migration audit

Action:

- Backup DB trước migration.
- Dry-run trên copy.
- Audit disk vs DB.
- Transaction khi insert asset + update queue.

## 10. Migration plan revised order

Thứ tự mới:

```text
Phase 0  Docs and decisions
Phase 1  Tauri-Gateway lifecycle manager
Phase 2  Gateway Core skeleton + fake worker
Phase 3  DB backup, migration, audit, audio_assets
Phase 4A Fake/Official Vbee adapter skeleton
Phase 4B BrowserService + Playwright CDP adapter
Phase 4C BrowserSessionAdapter + WS protocol recorder
Phase 5  DelayPolicy service
Phase 6  FileService with transaction + Windows lock retry
Phase 7  UI migration behind USE_GATEWAY_CORE flag
Phase 8  ZeroClaw optional client
Phase 9  Podman optional runtime
Phase 10 Cleanup legacy
```

UI work can start in parallel from Phase 2 once `/health`, `/api/queue`, and `/api/assets` exist.

## 11. New acceptance tests

### Lifecycle

- Gateway not running -> Tauri starts it.
- Gateway crashes -> Tauri detects and restarts if app spawned it.
- Port 3000 occupied -> UI shows actionable error.
- Browser not running -> app opens, `/health.degraded=true`.

### DB migration

- Dry-run migration on copied DB.
- Audit suspicious rows.
- Disk file exists but missing DB row -> report.
- `insert audio_assets + update queue done` transaction rollback test.

### File Service

- `.tmp` never appears in assets.
- Retry on Windows `EPERM`/`EBUSY`.
- Existing old filename remains playable through `audio_assets.relative_path`.

### Vbee WS

- Verify `GET_REMAINING_PREVIEW` is sent after success.
- Verify TTL-sensitive download starts immediately after `audioUrl`.
- Test mode uses fake adapter, not live Vbee.

### Delay

- Unit test word-count formula.
- Integration uses `DELAY_POLICY=none`.

## 12. Final design decision

The migration is still valid, but only after these amendments. Without them, Claude's critique is correct: Gateway Core could become a nicer folder layout around the same complexity.

The key improvement is not "move logic into Gateway". The key improvement is:

```text
Gateway Core owns orchestration,
domain logic depends on ports,
adapters own unstable external details,
Tauri supervises Gateway lifecycle,
DB migration is auditable,
Vbee protocol is testable.
```

