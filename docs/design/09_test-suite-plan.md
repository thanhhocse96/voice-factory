# 09 - Test Suite Plan (for a dedicated test agent)

Phiên bản: 2026-07-12
Trạng thái: PLAN — dành cho agent xây test suite độc lập, có thể chạy song song với việc implement doc 08 **sau khi mục C.3 (adapter contract) được chốt**.

## 0. Bối cảnh và nguyên tắc

Hiện trạng coverage: chỉ có 2 test files (`browser-service.test.js` — 3 tests, `preview-recorder.test.js` — 2 tests) + 3 Rust unit tests trong `gateway_lifecycle.rs`. **Core data path (routes, queue-service, job-runner, file-service, sqlite) chưa có test nào.**

Nguyên tắc:
- **Harness:** Node built-in test runner (`node --test`), ESM, không thêm framework/dependency test nào. Chạy qua `npm run test:m2` (hoặc thêm script `test:core`).
- **Pattern chuẩn để noi theo:** `gateway/src/infrastructure/browser/browser-service.test.js` — inject dependency qua constructor/param (`fetchImpl`), test file đặt cạnh source (`*.test.js`).
- **Không mock những gì rẻ để chạy thật:** SQLite dùng in-memory thật, FileService dùng temp dir thật. Chỉ mock ranh giới đắt/không kiểm soát được (network fetch, playwright, Vbee).
- **Không đặt coverage % target.** Thay bằng danh sách behavior bắt buộc dưới đây — xong hết là đạt.
- **Không browser E2E thật.** Live Brave/Vbee giữ nguyên manual protocol (`.local/M2_LIVE_VBEE_CDP_TEST.md`). Test suite phải chạy được trên CI/máy sạch không có Brave.

## 1. Seams và fixtures dùng chung

Tạo `gateway/src/test-helpers/` (hoặc đặt helper trong từng test file nếu nhỏ):

1. **In-memory DB:** `openDatabase(':memory:')` — `gateway/src/infrastructure/db/sqlite.js` dùng `node:sqlite` `DatabaseSync`, nhận path `:memory:` được. Mỗi test một DB mới → không cần cleanup, không flaky.
2. **Temp audio dir:** `fs.mkdtemp(path.join(os.tmpdir(), 'vf-test-'))` cho FileService, xóa trong `t.after`.
3. **Fake adapter theo contract design/06** (sau khi doc 08 C.3 chốt):
   ```js
   { provider, requestId, audioUrl, localAudioPath,
     metadata: { voiceCode, executionMode, format, protocolWarnings } }
   ```
   Helper `makeAdapter(overrides)` trả adapter với `synthesize` stub trả shape trên — dùng để test JobRunner với các biến thể (audioUrl có/không, throw, chậm).
4. **HTTP test:** khởi động server thật trên port 0 (ephemeral) với DB in-memory + temp dir, gọi bằng `fetch` — test toàn bộ contract HTTP không mock request/response object.
5. **WS protocol fixtures:** frames từ `VbeePreviewProtocolRecorder` (`gateway/src/vbee/protocol/preview-recorder.js`) — sequence chuẩn đã mô tả trong `preview-recorder.test.js`. Khi có phiên live thật (doc 08 C.4), frames ghi được sẽ thay/bổ sung fixture này.
6. **CDP mock:** `fetchImpl` inject vào `PlaywrightCdpAdapter` (pattern đã có).

## 2. Danh sách behavior bắt buộc (ưu tiên theo rủi ro)

### P1 — `gateway/src/application/job-runner.js` (rủi ro cao nhất: state machine + concurrency)

- [ ] Job đi đúng chuỗi state: `pending → typing_delay → submitting → downloading → done`.
- [ ] Adapter throw → job `failed`, runner không chết, tick sau vẫn xử lý job khác.
- [ ] **Single-claim atomicity:** 2 lần `pickPendingJob` liên tiếp (mô phỏng 2 tick) không claim cùng 1 job — verify UPDATE guard `WHERE status='pending'` + `changes===1`.
- [ ] Thứ tự claim: `priority ASC, created_at ASC`.
- [ ] **Consume adapter result** (sau doc 08 C.5): result có `audioUrl` → gọi `finalizeFromDownload`; result fake (null/null) → gọi `createFakeAsset`. Verify bằng adapter stub + FileService spy hoặc kiểm tra asset thật tạo ra.
- [ ] Worker disabled (`WORKER_ENABLED=0`) → không tick.

### P1 — `gateway/src/application/queue-service.js`

- [ ] `createJob` validate input (content rỗng → lỗi; voice_code/speed default đúng schema).
- [ ] `listJobs` trả job vừa tạo với status `pending`.
- [ ] `retryJob`: chỉ từ `failed` / `failed_file_lock` / `cancelled` → về `pending`; từ `done`/`pending` → từ chối.
- [ ] `cancelJob`: block khi `done` hoặc đã `cancelled`; hợp lệ từ `pending`.
- [ ] `getJob` id không tồn tại → null/404 path.

### P1 — `gateway/src/infrastructure/files/file-service.js`

- [ ] `createFakeAsset`: tạo file `.tmp` rồi rename — kết quả cuối không còn `.tmp`, file tồn tại, row `audio_assets` + update `tts_queue` + row `tts_log` cùng xuất hiện (transaction).
- [ ] Transaction rollback: ép lỗi giữa chừng (vd. duplicate `source_job_id` UNIQUE) → không có row nửa vời, không có file mồ côi.
- [ ] `listAssets` loại trừ `%.tmp`.
- [ ] `safeName` khử ký tự nguy hiểm (`../`, `\`, ký tự cấm Windows).
- [ ] `resolveAudioPath` chặn path traversal: `../../etc/passwd`, absolute path, encoded `..%2F` → reject.
- [ ] (Sau doc 08 C.6) `finalizeFromDownload`: audioUrl fetch OK (mock fetch trả stream bytes) → file cuối đúng nội dung + rows đúng; fetch fail → job fail-able, không để lại `.tmp` rác hoặc `.tmp` được dọn.
- [ ] (Sau doc 08 Phase E) export copy: config `ONEDRIVE_EXPORT_DIR` temp → file copy xuất hiện; export dir không ghi được → job vẫn done + warning.

### P2 — `gateway/src/api/routes.js` (HTTP contract, chạy server thật port 0)

- [ ] `GET /health`: 200, có `ok/gateway/db/browserCdp/worker/degraded/runtime`; browser adapter unavailable → `degraded:true` nhưng vẫn 200.
- [ ] `POST /api/queue`: body hợp lệ → 201 + job id; body rác/thiếu content → 4xx không crash.
- [ ] `GET /api/queue`, `GET /api/jobs/:id` (200 + 404), `POST /api/jobs/:id/retry`, `POST /api/jobs/:id/cancel` (đúng rule như queue-service).
- [ ] `GET /api/assets`: chỉ asset hoàn tất.
- [ ] `GET /api/audio/:filename`: file tồn tại → 200 đúng bytes; traversal filename → 4xx; không tồn tại → 404.
- [ ] (Sau doc 08 D.1) auth: token config + thiếu/sai header → 401; đúng → 200; `/health` miễn trừ; **không config token → mọi thứ như cũ** (regression guard cho bản 1-máy).
- [ ] (Sau doc 08 D.2) CORS: có `CORS_ORIGIN` → headers đúng + `OPTIONS` → 204; không config → không có header CORS.

### P3 — `gateway/src/infrastructure/db/sqlite.js`

- [ ] Schema tạo đủ 4 bảng (`projects`, `tts_queue`, `tts_log`, `audio_assets`) + index `idx_tts_queue_status_priority`.
- [ ] `journal_mode=WAL` được set (file DB; in-memory sẽ trả `memory` — test này dùng temp file).
- [ ] Mở DB lần 2 trên cùng file không lỗi (schema idempotent).
- [ ] Constraint: `audio_assets.source_job_id` UNIQUE hoạt động.

### P3 — Vbee adapters

- [ ] `FakeVbeeAdapter.synthesize` trả đúng normalized shape design/06 (contract test — khóa chống drift).
- [ ] `VbeePreviewAdapter` (sau doc 08 C.4): test với `browserService` mock — verify gọi `withPage`, map kết quả page-flow sang normalized shape, page throw → error propagate để JobRunner đánh fail. KHÔNG test DOM selector thật (thuộc manual protocol).
- [ ] Recorder fixtures: sequence thiếu `GET_REMAINING_PREVIEW` → `verifyExpectedPreviewSequence().ok === false` (đã có, mở rộng khi có frames live).

## 3. Cấu trúc và lệnh

- Test files đặt cạnh source: `gateway/src/application/job-runner.test.js`, `queue-service.test.js`, `gateway/src/infrastructure/files/file-service.test.js`, `db/sqlite.test.js`, `gateway/src/api/routes.test.js`, `gateway/src/vbee/adapters/fake-vbee.test.js`…
- `package.json`: script hiện tại `test:m2` glob `gateway/src/**/*.test.js` đã bắt hết file mới — không cần đổi; có thể thêm alias `"test": "node --test gateway/src/**/*.test.js"`.
- Yêu cầu môi trường: Node >= 24 (`node:sqlite`), không cần Brave/Playwright/network.

## 4. Definition of done cho test agent

- [ ] Tất cả checkbox P1 xong (P2/P3 theo sau, các mục "(Sau doc 08 …)" chỉ làm khi phase tương ứng đã merge).
- [ ] `npm run test:m2` pass toàn bộ, chạy < 30s, không flaky (chạy 3 lần liên tiếp).
- [ ] Không sửa production code trừ khi phát hiện bug — bug thì báo lại kèm test reproduce, không tự ý đổi behavior.
- [ ] Tạo milestone doc test report (`docs/milestones/`) theo format DOCUMENTATION_WORKFLOW + cập nhật `docs/README.md`.
