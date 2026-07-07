# Migration Plan - From Current Architecture to Gateway-Core MVP

Phiên bản: 2026-05-25  
Mục tiêu: chuyển từ kiến trúc hiện tại `Tauri + ZeroClaw + Gateway + Podman + Browser` sang kiến trúc mới gọn hơn: `Tauri UI -> Gateway Core -> Adapters -> Vbee`, trong đó ZeroClaw và Podman là optional.

## 1. Đích đến

Kiến trúc mới:

```text
Tauri / Vue UI
  -> Gateway Core API
      -> Queue Service
      -> Job State Machine
      -> Delay Policy
      -> Vbee Service
          -> Official API Adapter
          -> Browser Session Adapter
      -> Browser Service
          -> Playwright CDP Adapter
          -> Camoufox Adapter later
          -> Patchright Adapter later
      -> File Service
          -> tmp download
          -> atomic rename
          -> audio_assets insert
      -> SQLite WAL

ZeroClaw -> Gateway API  # optional client
Podman   -> optional dev/advanced runtime
```

Nguyên tắc migration:

- Không phá MVP cũ nếu đã có phần chạy được.
- Gateway trở thành core duy nhất ghi DB.
- UI, ZeroClaw, worker không đọc/ghi SQLite trực tiếp.
- Browser và Vbee được tách thành adapter.
- Sound Editor làm việc với `audio_assets`, không phụ thuộc `tts_queue`.
- Podman không còn là đường chạy mặc định.

## 2. Snapshot kiến trúc hiện tại

Kiến trúc hiện tại trong docs:

```text
Tauri / Client View
  -> ZeroClaw skill
  -> HTTP localhost:3000/api/queue
  -> Gateway Node.js
  -> Playwright attach Brave/Chromium CDP
  -> Vbee
  -> download .tmp
  -> atomic rename .mp3
  -> SQLite download_complete=1
  -> Sound Editor
```

Vấn đề cần migrate:

| Vấn đề | Tác động |
|---|---|
| ZeroClaw nằm quá gần critical path | App khó chạy độc lập nếu chưa có ZeroClaw |
| Podman là runtime mặc định | Windows/WSL2/networking dễ lỗi |
| Worker trộn browser logic và Vbee logic | Khó đổi API/Brave/Camoufox |
| Queue table vừa là job vừa là audio asset | Sound Editor bị dính trạng thái job |
| Job status quá thô | Debug khó, UI không biết kẹt ở bước nào |
| Delay nằm trong worker | Khó chỉnh policy từ UI/config |

## 3. Migration strategy

Chuyển theo kiểu strangler pattern:

```text
Old flow vẫn chạy:
ZeroClaw/UI -> Gateway /api/queue -> worker cũ

New core được thêm dần:
UI -> Gateway Core services -> adapters -> audio_assets

Sau mỗi phase, route cũ vẫn có thể map sang service mới.
```

Không đổi toàn bộ một lần. Mỗi phase phải có acceptance test.

Sau review critique, plan này có 3 thay đổi bắt buộc:

- Tauri-Gateway lifecycle là phase nền tảng, không để đến cuối.
- DB migration phải có backup, dry-run và audit disk-vs-DB.
- Vbee WS protocol phải có test harness/recorder, không chỉ test happy path.

## 4. Phase 0 - Chuẩn hóa tài liệu và quyết định

Mục tiêu: chốt kiến trúc mới trước khi code.

Việc cần làm:

- Giữ `docs/design/01_zeroclaw-vbee-working-spec.md` làm tài liệu nền (source of truth synced from ZeroClaw VBEE TTS/docs/).
- Giữ `docs/design/02_mvp-architecture.md` làm sơ đồ MVP.
- Dùng file này làm migration plan.
- Chốt quyết định:
  - Gateway là core.
  - ZeroClaw optional.
  - Podman optional.
  - UI chỉ gọi Gateway API.
  - Gateway là writer duy nhất của SQLite.

Done khi:

- Team/dev đọc 3 docs và thống nhất.
- Không còn coi ZeroClaw là dependency bắt buộc của MVP.

Rollback:

- Không cần, đây là phase tài liệu.

## 5. Phase 1 - Tauri-Gateway lifecycle manager

Mục tiêu: thiết kế cách Tauri spawn, monitor, restart và shutdown Gateway Core trước khi đưa thêm logic vào Gateway.

Lý do: nếu Gateway là core process, nó là SPOF của app local. UI phải detect được Gateway crash và có hành vi phục hồi hoặc degraded mode rõ ràng.

Quyết định runtime:

```text
Dev: chạy gateway bằng npm run dev hoặc script local.
MVP: Tauri spawn local gateway process/script.
Packaged later: Tauri sidecar binary hoặc bundled Node runtime.
Advanced optional: Podman.
```

Lifecycle requirements:

- Tauri check port `3000` trước khi spawn.
- Nếu port bận bởi process khác, UI hiện lỗi actionable, không kill bừa.
- Nếu Tauri spawn Gateway, Tauri được phép restart khi process crash.
- Nếu Gateway do user tự chạy, Tauri chỉ healthcheck, không quản lý shutdown.
- UI poll `/health` mỗi 3-5 giây.
- App vẫn mở được khi Browser CDP chưa sẵn sàng.

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

Done khi:

- Tauri hoặc script local start được Gateway.
- Gateway crash được phát hiện.
- Browser chưa chạy thì `/health` không throw 500.
- UI/Gateway có trạng thái degraded rõ ràng.

Acceptance test:

```text
Gateway not running -> app/script starts it.
Port 3000 occupied -> app reports conflict.
Browser not running -> /health returns degraded, not 500.
Gateway process killed -> supervisor detects it.
```

Rollback:

- Chạy Gateway thủ công bằng `npm run dev` hoặc script cũ.

## 6. Phase 2 - Gateway Core skeleton

Mục tiêu: dựng Gateway Core như lõi app, chưa cần Vbee thật.

Thêm cấu trúc:

```text
gateway/
  src/
    app.js
    config.js
    db/
      index.js
      schema.sql
      migrations/
    queue/
      queue-service.js
      job-state.js
    delay/
      delay-policy.js
    files/
      file-service.js
    browser/
      browser-service.js
      adapters/
        playwright-cdp.js
    vbee/
      vbee-service.js
      adapters/
        fake-vbee.js
        official-api.js
        browser-session.js
```

API cần có:

```text
GET  /health
POST /api/queue
GET  /api/queue
GET  /api/jobs/:id
POST /api/jobs/:id/retry
POST /api/jobs/:id/cancel
GET  /api/assets
GET  /api/audio/:filename
```

Việc cần làm:

- Tạo `/health`.
- Tạo `config.js` đọc env/config file.
- Tạo DB service với WAL.
- Tạo queue service.
- Tạo fake worker hoặc fake Vbee adapter sinh file giả.

Done khi:

- `GET /health` trả `ok=true`.
- `POST /api/queue` tạo job.
- Worker fake chuyển job `pending -> done`.
- Có row trong `audio_assets`.
- UI/curl đọc được asset.

Acceptance test:

```bat
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/queue ^
  -H "Content-Type: application/json" ^
  -d "{\"content\":\"Xin chao\",\"voice_code\":\"test\",\"incognito\":1}"
curl http://localhost:3000/api/assets
```

Rollback:

- Tắt worker fake, giữ route cũ `/api/queue` nếu đã có.

## 7. Phase 3 - Database backup, migration and audit

Mục tiêu: tách job và audio asset.

Schema mới cần thêm:

```sql
CREATE TABLE IF NOT EXISTS audio_assets (
  id TEXT PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id),
  source_job_id TEXT REFERENCES tts_queue(id),
  filename TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  file_path TEXT NOT NULL,
  content TEXT,
  voice_code TEXT,
  speed REAL,
  duration_ms INTEGER,
  sample_rate INTEGER,
  channels INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

Nâng cấp `tts_queue.status`:

```text
pending
typing_delay
submitting
waiting_vbee
downloading
finalizing
done
retrying
failed
cancelled
```

Việc cần làm:

- Stop Gateway trước khi migration thật.
- Copy `tts.db`, `tts.db-wal`, `tts.db-shm` nếu có.
- Chạy dry-run trên DB copy.
- Sinh audit report trước khi migrate.
- Thêm migration tạo `audio_assets`.
- Giữ các cột cũ `download_complete`, `relative_path`, `file_path` để tương thích tạm.
- Khi job done, insert `audio_assets`.
- Sound Editor và UI audio chuyển sang đọc `/api/assets`.

Audit bắt buộc:

```text
Rows complete:
- download_complete=1 AND file_path IS NOT NULL

Rows suspicious:
- download_complete=0 AND file_path IS NOT NULL
- status='done' AND file_path IS NULL
- file_path IS NOT NULL but file does not exist

Disk suspicious:
- .mp3 exists but no queue/log/asset row
- .tmp older than threshold
```

Done khi:

- Job done luôn tạo `audio_assets`.
- UI không cần query `tts_queue.download_complete` để phát audio.
- `tts_queue` chỉ còn là job tracking.

Migration data cũ:

```sql
INSERT INTO audio_assets (
  id, project_id, source_job_id, filename, relative_path, file_path,
  content, voice_code, speed, created_at
)
SELECT
  lower(hex(randomblob(16))),
  project_id,
  id,
  COALESCE(relative_path, filename),
  COALESCE(relative_path, filename),
  file_path,
  content,
  voice_code,
  speed,
  COALESCE(processed_at, created_at)
FROM tts_queue
WHERE download_complete = 1
  AND file_path IS NOT NULL;
```

Rollback:

- UI có thể tạm đọc lại `tts_queue` nếu `/api/assets` fail.
- Nếu migration làm hỏng dữ liệu, restore DB backup gồm cả WAL/SHM snapshot.

## 8. Phase 4A - Fake and Official Vbee adapters

Mục tiêu: tách phần Vbee adapter không phụ thuộc BrowserService để làm song song với BrowserService.

Adapters:

```text
FakeVbeeAdapter       # test nhanh, không gọi Vbee thật
OfficialApiAdapter    # dùng API chính thức nếu token/app id hoạt động
```

Việc cần làm:

- Tạo `vbee-service.js`.
- Tạo interface `preview(job)` và `convert(job)`.
- Tạo `FakeVbeeAdapter` trả file/audio URL giả hoặc sample local.
- Tạo skeleton `OfficialApiAdapter`.

Done khi:

- Worker có thể xử lý job bằng `VBEE_ADAPTER=fake`.
- UI có thể phát triển độc lập với browser/Vbee thật.
- Official adapter có contract rõ dù chưa hoàn thiện.

Rollback:

- Dùng fake adapter.

## 9. Phase 4B - Browser Service và Playwright CDP Adapter

Mục tiêu: tách browser control khỏi Vbee logic.

Interface:

```js
class BrowserAdapter {
  async healthcheck() {}
  async connect() {}
  async withPage(fn) {}
  async evaluateInBrowser(fn, args) {}
}
```

Adapter MVP:

```text
PlaywrightCdpAdapter
  CDP_URL=http://127.0.0.1:9222
```

Sau này:

```text
CamoufoxAdapter
PatchrightAdapter
```

Việc cần làm:

- Tạo `browser-service.js`.
- Tạo `playwright-cdp.js`.
- `/health` check CDP nhưng không crash khi CDP unavailable.
- Worker không import Playwright trực tiếp nữa; chỉ gọi `browserService`.

Done khi:

- Worker không biết Brave/Chromium cụ thể.
- Đổi `BROWSER_ADAPTER=playwright-cdp` bằng config.
- CDP health fail không làm Gateway crash.

Rollback:

- Worker tạm import Playwright trực tiếp như cũ.

## 10. Phase 4C - BrowserSessionAdapter and Vbee WS protocol recorder

Mục tiêu: triển khai Vbee adapter phụ thuộc browser context, kèm test harness cho WebSocket protocol.

Protocol sequence cần verify:

```text
server INIT
client INIT status=1
client SYNTHESIS
server SYNTHESIS IN_PROGRESS
server SYNTHESIS SUCCESS
client GET_REMAINING_PREVIEW
server GET_REMAINING_PREVIEW
```

Việc cần làm:

- Tạo `BrowserSessionAdapter`.
- Capture sent/received WS frames trong test/debug mode.
- Assert có gửi `GET_REMAINING_PREVIEW` sau `SYNTHESIS SUCCESS`.
- Nếu không xác nhận được frame cuối, mark `done_with_protocol_warning` hoặc retry nhẹ.

Done khi:

- Preview worker không chỉ test "có audio_link", mà verify protocol sequence.
- Có log/debug artifact cho WS frames.

Rollback:

- Dùng `FakeVbeeAdapter` hoặc `OfficialApiAdapter`.

## 11. Phase 5 - Delay Policy service

Mục tiêu: đưa delay ra khỏi worker, thành policy cấu hình được.

Interface:

```js
function estimateDelayMs(job, policyConfig) {
  // returns integer ms
}
```

Policies:

```text
none
fixed
word_count_wpm
adaptive later
```

Config MVP:

```json
{
  "delayPolicy": {
    "type": "word_count_wpm",
    "wpm": 180,
    "minSeconds": 2,
    "maxSeconds": 90,
    "jitterMin": 0.85,
    "jitterMax": 1.15
  }
}
```

Việc cần làm:

- Tạo `delay-policy.js`.
- Worker gọi service trước khi submit Vbee.
- Cập nhật status `typing_delay`.
- Ghi delay vào `tts_queue.notes` hoặc `job_events` nếu có.

Done khi:

- Delay thay đổi theo số từ.
- Log thấy `word_count`, `wpm`, `delay_ms`.
- Có thể tắt delay bằng config.

Rollback:

- Set policy `none` hoặc `fixed`.

## 12. Phase 6 - Vbee Service orchestration

Mục tiêu: thống nhất cách JobRunner gọi Vbee adapters và đảm bảo `audioUrl` được download ngay trong cùng async chain.

Interface:

```js
class VbeeAdapter {
  async preview(job, context) {}
  async convert(job, context) {}
}
```

Adapters:

```text
FakeVbeeAdapter       # test nhanh
OfficialApiAdapter    # dùng API chính thức nếu có token/app id
BrowserSessionAdapter # gọi từ browser context/page.evaluate
StudioUiAdapter later # click UI nếu bắt buộc
```

Việc cần làm:

- Tạo `vbee-service.js`.
- `preview(job)` route theo `job.incognito=1`.
- `convert(job)` route theo `job.incognito=0`.
- Adapter trả object chuẩn:

```js
{
  audioUrl,
  requestId,
  metadata
}
```
- Không có queue buffer giữa `VbeeService.convert()` và `FileService.downloadAndFinalize()`, vì presigned URL có TTL ngắn.

Done khi:

- Worker không biết endpoint Vbee cụ thể.
- Có thể chuyển `VBEE_ADAPTER=fake|official-api|browser-session`.
- Preview và convert dùng cùng File Service sau khi có `audioUrl`.
- Presigned URL được download ngay trong cùng job execution.

Rollback:

- Giữ worker cũ cho preview/convert trong route legacy.

## 13. Phase 7 - File Service chuẩn hóa

Mục tiêu: mọi file audio đi qua cùng một pipeline.

Interface:

```js
async function downloadAndFinalize({ job, audioUrl }) {
  // download .tmp
  // atomic rename
  // probe duration later
  // insert audio_assets
}
```

Rules:

- Không ghi trực tiếp `.mp3`.
- `.tmp` không hiển thị.
- Rename xong mới insert `audio_assets`.
- Job done sau khi asset insert thành công.
- Sau rename, `insert audio_assets`, `update tts_queue`, và `insert tts_log` phải nằm trong một SQLite transaction.
- `audio_assets.source_job_id` unique để retry finalizing không tạo duplicate asset.
- Windows `EPERM`/`EBUSY` khi rename phải retry với backoff.

Việc cần làm:

- Tạo `file-service.js`.
- Dùng `project_sequence` để đặt tên `001_name.mp3`.
- Tạo maintenance cleanup `.tmp`.
- Insert `audio_assets`.
- Thêm retry policy cho Windows file lock.
- Không rename/migrate file cũ trong MVP; asset cũ trỏ đúng `relative_path` hiện có.

Done khi:

- Không còn code download rải trong worker.
- File fail thì không có asset.
- Job done thì chắc chắn có asset.

Rollback:

- Tạm giữ finalize cũ với `tts_queue.file_path`.

## 14. Phase 8 - UI migration

Mục tiêu: UI nói chuyện với Gateway Core, không phụ thuộc ZeroClaw/DB.

Việc cần làm:

- Bắt đầu song song từ Phase 2 sau khi có `/health`, `/api/queue`, `/api/assets`.
- Dùng feature flag `USE_GATEWAY_CORE=true`.
- UI start bằng `/health`.
- Text input gọi `/api/queue`.
- Queue table gọi `/api/queue`.
- Audio list/Sound Editor gọi `/api/assets`.
- Audio preview gọi `/api/audio/:filename`.
- Thêm status detail vào queue row.

Done khi:

- App chạy được dù ZeroClaw không mở.
- App chạy được với Gateway local sidecar.
- Queue và asset hiển thị tách nhau.

Rollback:

- Tạm hiển thị audio từ queue nếu `/api/assets` chưa xong.

## 15. Phase 9 - ZeroClaw optional client

Mục tiêu: đưa ZeroClaw ra khỏi critical path, nhưng vẫn dùng được để trigger workflow.

Việc cần làm:

- Skill giữ nguyên gọi `/api/queue`.
- Không cho ZeroClaw ghi DB.
- Không cho ZeroClaw điều khiển browser trực tiếp trong MVP.
- Thêm docs: "ZeroClaw optional automation client".

Done khi:

- UI chạy end-to-end không cần ZeroClaw.
- ZeroClaw skill thêm job thành công khi Gateway đang chạy.
- Nếu ZeroClaw tắt, app không mất chức năng chính.

Rollback:

- Không cần, vì đây là giảm phụ thuộc.

## 16. Phase 10 - Runtime migration: Podman optional

Mục tiêu: chuyển runtime mặc định từ Podman sang local sidecar.

Lựa chọn:

```text
Dev: npm run dev trong gateway
MVP local: Tauri spawn Node gateway hoặc packaged gateway binary
Advanced: Podman container
```

Việc cần làm:

- Tạo `scripts/start-gateway-local.bat`.
- Tauri Rust start/check local Gateway.
- Podman script giữ trong `scripts/start-gateway-podman.bat`.
- Config runtime:

```json
{
  "gatewayRuntime": "local",
  "gatewayUrl": "http://127.0.0.1:3000"
}
```

Done khi:

- MVP không cần Podman để chạy.
- Podman vẫn dùng được cho dev/advanced.
- Không còn bắt buộc `host.containers.internal` trong đường chạy mặc định.

Rollback:

- Chạy lại Podman mode nếu local sidecar lỗi.

## 17. Phase 11 - Cleanup legacy

Chỉ làm sau khi MVP mới chạy ổn.

Việc cần làm:

- Xóa worker cũ trộn Playwright/Vbee.
- Xóa UI đọc trực tiếp queue asset.
- Deprecate `download_complete` trên `tts_queue`, nhưng chưa cần xóa ngay.
- Chuyển docs cũ thành archive/reference.

Done khi:

- Không còn route nào ghi file audio ngoài File Service.
- Không còn code browser ngoài Browser Adapter.
- Không còn code Vbee endpoint ngoài Vbee Adapter.

Rollback:

- Giữ branch/archive trước cleanup.

## 18. Migration checklist tổng

```text
[ ] Phase 0 docs approved
[ ] Phase 1 Tauri-Gateway lifecycle manager
[ ] Phase 2 Gateway Core skeleton
[ ] Phase 3 DB backup, migration and audit
[ ] Phase 4A Fake/Official Vbee adapters
[ ] Phase 4B Browser Service + Playwright CDP Adapter
[ ] Phase 4C BrowserSessionAdapter + WS protocol recorder
[ ] Phase 5 Delay Policy service
[ ] Phase 6 Vbee Service orchestration
[ ] Phase 7 File Service with transaction + Windows lock retry
[ ] Phase 8 UI migrated to assets API
[ ] Phase 9 ZeroClaw optional
[ ] Phase 10 Podman optional / local sidecar default
[ ] Phase 11 cleanup legacy
```

## 19. MVP cut line

Có thể gọi là MVP mới hoàn tất khi:

```text
Tauri UI mở được
Gateway local chạy được
Browser CDP health ok
POST /api/queue tạo job
Worker xử lý ít nhất preview/incognito
File .mp3 xuất hiện trong data/audio
audio_assets có row
UI phát được audio
ZeroClaw skill có thể thêm job, nhưng không bắt buộc
Podman không bắt buộc
Browser chưa chạy thì app không crash, chỉ degraded
```

## 20. Rủi ro migration

| Rủi ro | Giảm thiểu |
|---|---|
| Refactor quá rộng | Làm từng phase, giữ route cũ |
| Adapter abstraction quá sớm | Chỉ abstract browser/vbee/file, không abstract mọi thứ |
| DB migration lỗi | Giữ cột cũ, thêm bảng mới trước |
| UI bị chậm do đổi API | Giữ `/api/queue` response tương thích |
| Local sidecar khó package | Dev trước bằng `npm run gateway`, package sau |
| Vbee API chưa ổn | Dùng `FakeVbeeAdapter` và `BrowserSessionAdapter` song song |
| Gateway crash làm app unusable | Tauri lifecycle manager, health polling, restart |
| Windows file lock | Retry `EPERM`/`EBUSY`, test riêng trên Windows |
| DB migration bỏ sót file | Backup, dry-run, audit disk-vs-DB |

## 21. Quy tắc dừng

Dừng migration và quay lại stabilize nếu gặp một trong các điểm:

- Gateway không còn xử lý được fake job.
- DB migration làm mất khả năng đọc queue cũ.
- Browser CDP health làm Gateway crash.
- UI không thể thêm queue.
- File Service tạo asset nhưng file không tồn tại.
- Migration audit phát hiện suspicious rows chưa xử lý.
- WS recorder không xác nhận được `GET_REMAINING_PREVIEW`.

Khi dừng, ưu tiên sửa acceptance test của phase hiện tại trước khi sang phase tiếp theo.
