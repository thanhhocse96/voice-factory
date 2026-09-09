# 08 - Usable Build and Distributed Deployment Plan

Phiên bản: 2026-07-12
Trạng thái: APPROVED PLAN — chưa thực thi
**Executor: agent Sonnet.** Tài liệu này được viết để một agent khác đọc vào và thực thi từng phase mà không cần context của phiên chat trước.

**Human-gated items (phải hỏi user trước khi làm):**
- Thao tác trên live Vbee session (trích JWT, xác định DOM selector) — cần user đăng nhập Brave thủ công.
- Mở port gateway ra Tailscale interface (Phase D).
- ~~Cài Playwright~~ → **ĐÃ ĐƯỢC APPROVE trước** cho Phase C (user xác nhận 2026-07-12). Không cần hỏi lại, nhưng chỉ cài trên máy backend.

---

## 0. Đánh giá PM (tại sao kế hoạch có hình dạng này)

Đánh giá dưới góc nhìn PM trước khi thực thi:

1. **Đúng MVP.** Bản 1-máy tạo voice chạy thật (Phase C) là cột mốc giá trị duy nhất. Mọi thứ khác (tách máy, OneDrive, editor) đều vô nghĩa nếu chưa có audio thật từ Vbee. Không được đảo thứ tự.
2. **Tách 2 máy là deployment config, không phải re-architecture.** Gateway đã là HTTP API, UI đã dùng relative fetch, adapter boundary đã tách. Chi phí thật của Phase D nằm ở 3 chỗ thiếu: auth token, CORS, và Tauri "remote mode".
3. **Rủi ro xếp hạng:**
   - **R1 — Vbee automation mong manh.** design/07 (mục "Chưa quyết định") ghi rõ: JWT extraction, DOM selector, network interception method đều là open question. Đây là phần duy nhất của kế hoạch KHÔNG thể hoàn thành offline — cần live session + user.
   - **R2 — Bảo mật khi mở remote.** Gateway hiện không có auth, không CORS, HOST mặc định 127.0.0.1. Tuyệt đối không đổi `HOST=0.0.0.0` trước khi có token auth (Phase D làm auth TRƯỚC, đổi host SAU).
   - **R3 — OneDrive hazard.** SQLite WAL + atomic rename trong thư mục OneDrive là lỗi kinh điển (file lock, sync file `.tmp` dở dang). Giải pháp hybrid: DB + tmp ở đĩa local, chỉ COPY file hoàn tất sang OneDrive.
   - **R4 — Test coverage ~0% trên core path.** Chấp nhận defer (doc 09 là kế hoạch cho test agent), NHƯNG Phase C phải chốt adapter contract theo design/06 ngay để test agent không phải refactor sau.
4. **Editor là extension point, không phải scope.** `audio_assets` đã tách khỏi `tts_queue` — chỉ cần giữ boundary này (Phase F là ghi chú, không code).

Thứ tự bắt buộc: **C → D → E** (F chỉ là ràng buộc chạy xuyên suốt). Mỗi phase xong phải chạy được độc lập và tạo milestone doc.

---

## 1. Kiến trúc đích

```text
MÁY UI (Windows)                          MÁY BACKEND (Windows, crawl Vbee)
┌──────────────────┐                      ┌────────────────────────────────┐
│ Tauri app        │   Tailscale (HTTP)   │ Gateway Node.js  HOST=<ts-ip>  │
│  (remote mode,   │ ───────────────────► │  ├─ token auth + CORS          │
│   không tự start │   Bearer token       │  ├─ SQLite WAL (đĩa local)     │
│   gateway local) │                      │  ├─ JobRunner → VbeeAdapter    │
│                  │ ◄─────────────────── │  │    └─ Playwright CDP        │
│ nghe audio qua   │   /api/audio/:file   │  │        └─ Brave headed 9222 │
│ HTTP hoặc mở từ  │                      │  │            └─ Vbee Studio   │
│ thư mục OneDrive │                      │  └─ FileService                │
└──────────────────┘                      │      ├─ data/audio (local)     │
        ▲                                 │      └─ copy → OneDrive dir ───┼──► OneDrive sync
        └───────────── OneDrive ◄─────────┴────────────────────────────────┘
```

- **DB, file `.tmp`, WAL: luôn ở đĩa local máy backend.** Không bao giờ nằm trong thư mục OneDrive.
- **Audio hoàn tất: 2 kênh** — kênh chính là HTTP (`/api/audio/:filename` qua Tailscale), kênh phụ là copy sang thư mục OneDrive.
- Brave headed + profile thật chạy trên máy backend, user login Vbee thủ công 1 lần.

---

## 2. Phase C — Voice creation thật trên 1 máy

**Mục tiêu:** từ UI nhập text → job chạy qua Brave/CDP → file audio thật của Vbee nằm trong Assets tab và phát được. Tất cả trên 1 máy backend.

### C.1 Cài Playwright (đã approve)

```bash
# Trên máy backend, tại repo root:
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright
# PowerShell: $env:PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD='1'; npm install playwright
```

Chỉ cần `connectOverCDP` vào Brave đang chạy — KHÔNG tải browser bundle của Playwright (tiết kiệm ~400MB và tránh dùng nhầm browser không có session).

**Debug checklist sau khi cài:**
1. `node -e "import('playwright').then(m => console.log('ok', !!m.chromium))"` → phải in `ok true`.
2. Start Brave với CDP: `node scripts/browser-lifecycle.mjs start` (hoặc user start thủ công theo `.local/M2_LIVE_VBEE_CDP_TEST.md`).
3. `curl http://127.0.0.1:9222/json/version` → phải trả JSON có `webSocketDebuggerUrl`.
4. Smoke connect: `node -e "import('playwright').then(async ({chromium}) => { const b = await chromium.connectOverCDP('http://127.0.0.1:9222'); console.log('contexts:', b.contexts().length); await b.close(); })"`.

**Lỗi thường gặp:**
| Triệu chứng | Nguyên nhân | Xử lý |
|---|---|---|
| `ERR_CONNECTION_REFUSED` ở bước 3 | Brave không chạy hoặc thiếu `--remote-debugging-port=9222` | Restart Brave qua script; check `netstat -ano \| findstr :9222` |
| Bước 3 OK từ Windows nhưng fail từ WSL | WSL2 không forward localhost | Dùng IP Windows từ `/etc/resolv.conf`, set `CDP_URL` |
| `connectOverCDP` timeout nhưng curl OK | CDP chỉ bind 127.0.0.1, gọi từ máy/context khác | Chạy gateway cùng máy với Brave (đúng thiết kế) |
| `Cannot find module 'playwright'` | Cài ở thư mục khác | Cài tại repo root, check `node_modules/playwright` |

### C.2 Hoàn thiện PlaywrightCdpAdapter

File: `gateway/src/infrastructure/browser/adapters/playwright-cdp.js`

`connect()` và `withPage()` đã được viết sẵn (dynamic import playwright + `connectOverCDP`, lấy context/page có sẵn, cố ý KHÔNG đóng page để reuse session). Việc cần làm:
- Bỏ guard/TODO "M2 health-only", verify hoạt động với playwright đã cài.
- Thêm xử lý: nếu không có context/page nào (Brave vừa mở tab trống) → tạo page mới và `goto('https://studio.vbee.vn')`.
- Giữ nguyên `healthcheck()` (fetch `/json/version`, injectable `fetchImpl`) — không đụng.

### C.3 Chuẩn hóa adapter contract theo design/06

**Vấn đề:** `FakeVbeeAdapter.synthesize()` hiện trả `{adapter, requestId, metadata}` nhưng design/06 (mục normalized result) định nghĩa:

```js
{
  provider: 'vbee' | 'fake',
  requestId: string,
  audioUrl: string | null,        // URL tạm để FileService download
  localAudioPath: string | null,  // hoặc path nếu adapter tự download
  metadata: {
    voiceCode, executionMode, format,
    protocolWarnings: []
  }
}
```

Việc cần làm:
- Sửa `gateway/src/vbee/adapters/fake-vbee.js` trả đúng shape trên (`provider: 'fake'`, `audioUrl: null`, `localAudioPath: null` → JobRunner hiểu là "fake, dùng createFakeAsset").
- Adapter thật (C.4) trả `audioUrl` hoặc `localAudioPath` có giá trị.
- Đây là contract mà doc 09 (test plan) sẽ test — không được lệch.

### C.4 Tạo VbeePreviewAdapter (lõi Phase C)

File mới: `gateway/src/vbee/adapters/vbee-preview.js`

Class `VbeePreviewAdapter` với `synthesize(job)`, nhận `browserService` qua constructor (giữ invariant: JobRunner không import browser trực tiếp). Flow theo design/07 `vbee_preview_download`:

1. `browserService.withPage(async (page) => {...})`:
2. Điều hướng/verify đang ở `studio.vbee.vn` với session đã login.
3. Inject text của job vào editor preview.
4. Trigger preview (nút nghe thử).
5. Bắt URL audio tạm — qua network interception (`page.on('response')` lọc response audio/mpeg hoặc WS frame `GET_REMAINING_PREVIEW`).
6. Trả normalized result với `audioUrl` + `metadata.executionMode: 'vbee_preview_download'`.

**⚠️ HUMAN-GATED — open questions phải resolve với live session (design/07 ghi rõ chưa quyết):**
- Cách trích JWT/accessToken (từ localStorage? cookie? network header?).
- DOM selector chính xác của editor + nút preview.
- Audio URL xuất hiện ở HTTP response hay WS frame.

**Cách làm đúng:** viết skeleton adapter với các bước trên là function riêng, đánh dấu `// HUMAN-GATED: resolve with live session`. Sau đó cùng user chạy 1 phiên khám phá: user login Brave, agent dùng `scripts/live-cdp-vbee-check.mjs` + CDP để quan sát network/DOM thật, rồi điền selector/method vào. Dùng `VbeePreviewProtocolRecorder` (`gateway/src/vbee/protocol/preview-recorder.js`) ghi lại frames thật làm fixture cho test.

**Timing:** thao tác phải human-paced theo design/07 (action 4-10s random). Phase C có thể hardcode delay đơn giản; policy đầy đủ là M5 — không build scheduler bây giờ.

### C.5 JobRunner tiêu thụ kết quả adapter

File: `gateway/src/application/job-runner.js`

**Bug hiện tại:** `tick()` gọi `await vbeeAdapter.synthesize(job)` nhưng **vứt bỏ kết quả** và luôn gọi `fileService.createFakeAsset(job)`. Sửa:

```js
const result = await this.vbeeAdapter.synthesize(job);
this.markStatus(job.id, 'downloading');
if (result.audioUrl || result.localAudioPath) {
  await this.fileService.finalizeFromDownload(job, result);
} else {
  await this.fileService.createFakeAsset(job); // fake path giữ nguyên
}
```

Không thêm branch theo provider — chỉ branch theo shape của normalized result (giữ invariant "JobRunner không có Vbee logic", đúng hướng M3).

### C.6 FileService.finalizeFromDownload

File: `gateway/src/infrastructure/files/file-service.js`

Thêm method `finalizeFromDownload(job, result)` bên cạnh `createFakeAsset`, tái dùng toàn bộ pattern có sẵn:
- Nếu `result.audioUrl`: fetch → stream vào `<safeName>.tmp` → `fs.rename` sang `.mp3` (pattern `.tmp`→final đã có).
- Nếu `result.localAudioPath`: rename/copy vào `audioDir` theo cùng pattern.
- Insert `audio_assets` + update `tts_queue` + insert `tts_log` trong cùng transaction `BEGIN IMMEDIATE` (copy pattern từ `createFakeAsset`).
- Lỗi download → job `failed` (retry được qua `/api/jobs/:id/retry` có sẵn).

### C.7 Wiring + config

- `gateway/src/server.js`: chọn adapter theo `config.runtime.vbeeAdapter` — `'fake'` → FakeVbeeAdapter (mặc định, không đổi), `'vbee-preview'` → VbeePreviewAdapter(browserService).
- `gateway/src/config.js`: `VBEE_ADAPTER` env đã tồn tại — không cần thêm gì, chỉ document giá trị mới.
- `/health`: khi adapter là vbee-preview, `vbeeSession` báo `'browser-session'` thay vì `'fake'`.

### C.8 Acceptance Phase C

- [ ] `VBEE_ADAPTER=fake npm run dev` → hành vi cũ y nguyên (fake asset, tests pass).
- [ ] Brave chạy + user đã login Vbee + `VBEE_ADAPTER=vbee-preview npm run dev` → POST text vào `/api/queue` → job đi `pending→…→done` → file `.mp3` thật trong `data/audio/` → Assets tab phát được.
- [ ] Job fail (Brave tắt giữa chừng) → status `failed`, gateway không crash, retry được.
- [ ] `npm run test:m2` pass (fake contract mới có test cập nhật).
- [ ] Tạo `docs/milestones/M2_006_*.md` (hoặc M4_001 nếu MILESTONES đã promote) ghi evidence.

---

## 3. Phase D — Tách 2 máy qua Tailscale

**Mục tiêu:** Tauri app trên máy UI điều khiển gateway trên máy backend qua Tailscale, có token auth.

**Thứ tự bắt buộc trong phase: D.1 (auth) TRƯỚC → D.4 (mở host) SAU.** Không bao giờ bind `0.0.0.0` khi chưa có token.

### D.1 Token auth

- `gateway/src/config.js`: thêm `GATEWAY_AUTH_TOKEN` (env, default rỗng = auth tắt, giữ tương thích bản 1-máy).
- `gateway/src/api/routes.js`: đầu `route()` — nếu token được config và request không có `Authorization: Bearer <token>` đúng → 401. Miễn trừ: `GET /health` (để monitor) và static UI (`GET /`, `/dev/*` — UI sẽ tự gắn token vào API call).

### D.2 CORS

Trong `routes.js`: khi có config `CORS_ORIGIN` (env, ví dụ `tauri://localhost` hoặc `http://localhost:1420`), trả `Access-Control-Allow-Origin`, `-Headers: Authorization, Content-Type`, `-Methods`, và xử lý `OPTIONS` preflight trả 204. Mặc định không set (same-origin như hiện tại).

### D.3 UI base-URL + token

`public/app.js`:
- Thêm `gatewayBaseUrl` + `gatewayToken` đọc từ `localStorage` (key `vf.gatewayBaseUrl`, `vf.gatewayToken`), mặc định `''` = same-origin (bản 1-máy không đổi hành vi).
- Wrap fetch: helper `apiFetch(path, opts)` tự prepend baseUrl + gắn header Bearer. Audio element src cũng phải qua baseUrl (token cho audio: dùng query param `?token=` hoặc chấp nhận miễn trừ `/api/audio` đọc-only — quyết định khi implement, ghi lại vào milestone doc).
- Thêm UI settings nhỏ (input URL + token, nút Save) trong tab hiện có.

### D.4 Tauri remote mode

`src-tauri/src/lib.rs` + `gateway_lifecycle.rs`:
- Hiện `setup()` LUÔN auto-start gateway + browser local. Thêm remote mode: nếu env `VOICEFACTORY_REMOTE_GATEWAY_URL` được set (hoặc config file), **bỏ qua** auto-start, chỉ poll `GET <url>/health` cho status pill.
- `gateway_runtime_status` trả snapshot từ remote health thay vì chạy script local.
- Máy backend không cần Tauri — chạy `npm run dev` trực tiếp (đơn giản hơn) hoặc Tauri như cũ.

### D.5 Hướng dẫn Tailscale (đưa vào doc, user thao tác)

1. Cài Tailscale trên cả 2 máy, cùng tailnet, `tailscale ip -4` lấy IP backend (dạng `100.x.y.z`).
2. Máy backend: `GATEWAY_AUTH_TOKEN=<random-32-chars> HOST=<tailscale-ip> npm run dev` (bind đích danh Tailscale IP, KHÔNG dùng `0.0.0.0` để không lộ ra LAN).
3. Windows Firewall: mở inbound port 3000 chỉ trên interface Tailscale (hoặc scope remote IP = 100.64.0.0/10).
4. Test từ máy UI: `curl http://100.x.y.z:3000/health`.

### D.6 Acceptance Phase D

- [ ] Không set token/CORS/remote env → hành vi bản 1-máy y nguyên.
- [ ] Có token: request thiếu/sai token → 401; đúng token → 200.
- [ ] Từ máy UI: Tauri app (remote mode) tạo job, xem queue, phát audio qua Tailscale.
- [ ] Tauri remote mode không spawn gateway/browser local.
- [ ] Milestone doc mới với evidence (curl outputs, screenshot).

---

## 4. Phase E — OneDrive hybrid export

**Mục tiêu:** file audio hoàn tất tự xuất hiện trong OneDrive; DB/tmp không bao giờ đụng OneDrive.

- `gateway/src/config.js`: thêm `ONEDRIVE_EXPORT_DIR` (env, default rỗng = tắt).
- `gateway/src/infrastructure/files/file-service.js`: sau khi finalize (SAU `fs.rename` sang tên cuối), nếu export dir được config → `fs.copyFile` sang `<exportDir>/<project-folder>/<filename>`. **Copy, không move** — nguồn local vẫn là source of truth cho `/api/audio`.
- **Copy fail KHÔNG làm job fail:** log warning + ghi cột/flag `export_pending` (hoặc note trong `tts_log`), job vẫn `done`. OneDrive là kênh phụ.
- (Tùy chọn, nếu rẻ) lệnh/endpoint re-export cho các file `export_pending`.
- **Ghi rõ trong doc + config comment:** `DATA_DIR`, `DATABASE_PATH`, `AUDIO_DIR` tuyệt đối không đặt trong thư mục OneDrive — WAL lock + sync `.tmp` dở dang sẽ corrupt data.

**Acceptance:**
- [ ] Job done → file xuất hiện trong OneDrive dir (và sync lên cloud).
- [ ] OneDrive dir không tồn tại/không ghi được → job vẫn done, có warning.
- [ ] Không có file `.tmp` hay `.db`/`.db-wal` nào trong OneDrive dir.

---

## 5. Phase F — Extension point cho Sound Editor (KHÔNG build bây giờ)

Ràng buộc giữ xuyên suốt C/D/E để editor sau này build được mà không refactor:

1. Editor chỉ đọc/ghi qua `audio_assets` (đã tách khỏi `tts_queue`) — không thêm cột editor vào `tts_queue`.
2. Endpoint tương lai: `GET /api/assets/:id` (detail + metadata), `PATCH /api/assets/:id` (metadata). Không implement trước.
3. File audio truy cập qua `/api/audio/:filename` — editor không đọc filesystem trực tiếp (để hoạt động cả remote).
4. Bản sao OneDrive là read-only export — editor làm việc trên nguồn local qua API, không edit file trong OneDrive.

---

## 6. Tổng hợp env vars (sau khi hoàn thành)

| Env | Default | Phase | Ý nghĩa |
|---|---|---|---|
| `VBEE_ADAPTER` | `fake` | C | `fake` \| `vbee-preview` |
| `CDP_URL` | `http://127.0.0.1:9222` | có sẵn | CDP endpoint của Brave |
| `GATEWAY_AUTH_TOKEN` | (rỗng = tắt) | D | Bearer token cho API |
| `CORS_ORIGIN` | (rỗng = tắt) | D | Origin được phép (Tauri UI) |
| `HOST` | `127.0.0.1` | D | Bind Tailscale IP khi remote |
| `VOICEFACTORY_REMOTE_GATEWAY_URL` | (rỗng = local) | D | Tauri remote mode |
| `ONEDRIVE_EXPORT_DIR` | (rỗng = tắt) | E | Thư mục OneDrive nhận bản copy |

## 7. Quy trình cho executor

Mỗi phase: implement → chạy acceptance → tạo milestone doc (`docs/milestones/`, format theo DOCUMENTATION_WORKFLOW: mermaid workflow, what/files/patterns/verification/limits) → cập nhật `docs/README.md` → commit. Test suite chi tiết cho từng phần: xem [09_test-suite-plan.md](09_test-suite-plan.md) — test agent có thể chạy song song sau khi C.3 (contract) chốt.
