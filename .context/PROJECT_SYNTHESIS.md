# PROJECT SYNTHESIS — VoiceFactory Context Tổng Hợp

File này là bản tổng hợp một-chỗ của toàn bộ trạng thái dự án, gộp từ
`GLOBAL.md`, `MILESTONES.md`, `MILESTONE_ROADMAP.md`, `modules/*.md`,
`docs/README.md`, `package.json`, `src-tauri/`, và `.local/ENVIRONMENT.md`.

> Nguồn chi tiết (source of truth) vẫn là từng file gốc trong `.context/` và `docs/`.
> File này dùng để nắm nhanh bức tranh toàn cảnh trước khi đọc file chi tiết.
> Khi code, vẫn bắt buộc: startup protocol -> đọc file module liên quan.

---

## 1. Dự án là gì

**VoiceFactory** — app sản xuất TTS local-first (chạy trên máy, không cần cloud).

- Provider mục tiêu đầu tiên: **Vbee** (`studio.vbee.vn`).
- Kiến trúc mở: nhiều provider TTS trả phí khác có thể thêm sau qua **provider adapter contract**.
- ZeroClaw và Podman là **tùy chọn** — không bắt buộc cho MVP.

Chuỗi xử lý lõi (proven): `queue -> worker -> TTS adapter (fake/Vbee) -> audio asset -> HTTP playback`.

## 2. Tech Stack

| Lớp | Công nghệ |
|---|---|
| Gateway Core | Node.js >= 24 (`node:sqlite`), JS ESM (`type: module`) |
| Persistent store | SQLite WAL |
| UI hiện tại | Dev client tĩnh HTML/CSS/JS phục vụ qua chính Gateway (`public/`) |
| Desktop shell | Tauri v2 + Rust (`src-tauri/`) |
| Browser automation | Playwright (dev dependency); CDP endpoint `GET <CDP_URL>/json/version` |
| Python tooling | `../context-mapping` (CLI build/check-consistency) |

Không có worker riêng: `JobRunner` chạy bên trong Gateway khi boot (tắt bằng `WORKER_ENABLED=0`).

## 3. Kiến trúc (Active Architecture)

```text
Tauri/Vue UI later
  -> Gateway Core API
      -> Queue Service
      -> Job Runner
      -> TTS Provider Adapter  (fake | vbee-preview | vbee-official)
      -> Browser Service       (CDP health, mới M2)
      -> File Service          (.tmp first, publish finalized)
      -> SQLite WAL

ZeroClaw optional client later
Podman optional runtime later
```

Cấu trúc code (code reality — `gateway/src/`):

```text
api/          routes.js, http-utils.js (+ test)       # HTTP API: /health, /api/queue, /api/assets, /api/audio, export CSV
application/  job-runner.js, queue-service.js (+ tests)
infrastructure/cssv.js        # RFC 4180 CSV, UTF-8 BOM
infrastructure/browser/       # browser-service.js + adapters/playwright-cdp.js (CDP health)
infrastructure/db/sqlite.js   # node:sqlite
infrastructure/files/file-service.js  # .tmp -> finalize, atomic-ish rename, filenameFromResult
vbee/adapters/ fake-vbee.js, vbee-preview.js   # provider adapters
vbee/protocol/ preview-recorder.js            # Vbee preview protocol harness

src-tauri/    # Rust: runtime lifecycle (start_gateway/start_browser), remote mode, window creation
public/       # dev client (Queue/Assets/Edit tabs, light/dark)
scripts/      # gateway-lifecycle.mjs, smoke-gateway.sh, smoke-lifecycle.sh, browser-lifecycle.mjs, vbee-windows-direct-api.bat
```

## 4. Milestones

### Completed: M0 — Gateway Core Fake End-to-End
Chứng minh skeleton local chạy được: `GET /health`, `POST /api/queue`, fake worker -> asset,
`GET /api/assets`, `GET /api/audio/:filename`, dev client queue + play.
Docs: `docs/milestones/M0_001..003`.

### Completed: M1 — Tauri Gateway Lifecycle
Lệnh lifecycle CLI (`npm run gateway:start|status|stop`) đã test; Tauri shell gọi/port behavior đó.
Nguyên tắc: `start` = healthy thật, chỉ stop Gateway mình khởi động, không giết process lạ,
port chiếm chỗ nhưng `/health` không chạy => báo conflict. Có test report M1_002/M1_006.

### Completed (khi có doc tương ứng): M2 — Browser CDP Health And Vbee Preview Harness
Milestone hiện tại. Trạng thái từ docs (docs/README — bản đầy đủ nhất là các `docs/milestones/M2_*`):

- `BrowserService` + `PlaywrightCdpAdapter` healthcheck CDP URL; `/health` báo `browserCdp` mà không crash.
- JobRunner không import browser trực tiếp.
- `preview-recorder.js` mô hình hóa chuỗi frame preview Vbee kể cả `GET_REMAINING_PREVIEW`.
- **M2_007..M2_015 (Phase C)**: adapter `FakeVbeeAdapter` chuẩn hóa; `FileService.finalizeFromDownload`;
  sửa bug JobRunner (mất kết quả + thiếu path failed); `VbeePreviewAdapter` chạy real end-to-end
  lần đầu qua gateway: token cookie httpOnly, Draft.js selector, giữ audio trong chính frame SYNTHESIS SUCCESS,
  fix `Control+A` (selection-gated #try-listening), fix restore-dialog cho back-to-back jobs,
  xác nhận 2 job real liên tiếp không cần thao tác tay.
- **M2_019 (direct API)**: thay `pressSequentially` bằng `page.evaluate()` WebSocket SYNTHESIS
  (INIT/SYNTHESIS), token không rời khỏi Node; 47/47 tests.
- **M2_013 (Phase D)**: `GATEWAY_AUTH_TOKEN` bearer + `CORS_ORIGIN`; Connection-settings UI
  (gatewayBaseUrl/token); Tauri remote mode (`VOICEFACTORY_REMOTE_GATEWAY_URL` → `status_remote()`);
  46/46 tests + verify live 5 scenario auth/CORS.
- **M2_016/017/018**: packaging Windows installer cross-compile sang `x86_64-pc-windows-gnu` từ WSL,
  sửa 2 bug startup, sửa `public/` chưa bundle (404 toàn trang lâu nay), `start_gateway` xong mới tạo window.
- **M2_021**: CSV export (`/api/queue.csv`, `/api/assets.csv`), 57/57 tests.
- **M2_014**: điều tra chọn giọng/tốc độ — tìm được selector nhưng bị 2 blocker, **hoãn theo quyết định người dùng**.

Trạng thái test gần nhất: `npm run test:m2` = 57/57 (từ M2_021). Milestone M2 acceptance items đã check xong.
Còn 2 việc mở ngoài acceptance: kết nối CDP thật qua biên WSL↔Windows, và complete live Vbee job cho chạy bình thường.

### Backlog (roadmap — chưa bắt đầu)
- **M3**: Provider Registry + Execution Mode Routing (`provider`, `executionMode` trong payload, registry map mode -> adapter).
- **M4**: Vbee Dual Workflow MVP (`vbee_preview_download` / `vbee_official_download`) cùng normalized contract.
- **M5**: Human Pace Scheduler (policy `none`/`fixed`/human word-count pacing, account/session throttle).
- **M6**: File Service Hardening (`.tmp` first, atomic rename, retry EPERM/EBUSY, transaction, chống duplicate).
- **M7**: DB migration backup/dry-run/audit.
- **M8**: Desktop UI migration (Tauri UI, chỉ nói chuyện với Gateway API).
- **M9**: ZeroClaw optional client (chỉ qua Gateway API).
- **M10**: Packaging & runtime hardening (local sidecar, Podman optional).

## 5. Invariants & Ràng buộc toàn cục (bắt buộc giữ)

1. Gateway Core là **process duy nhất write SQLite**.
2. UI/ZeroClaw **không đọc/ghi SQLite**; chỉ gọi Gateway API.
3. Audio playback chỉ qua `GET /api/audio/:filename` (Gateway HTTP), không đi đường local path.
4. JobRunner **không import** browser automation, Playwright, filesystem write, SQLite raw.
5. Browser, Vbee, DB, File IO phải nằm sau service/adapter.
6. Vbee credential/session/JWT logic **không được rò ra** UI/DTO/JobRunner; giữ trong adapter.
7. Presigned/temp URL phải tải **ngay trong cùng chuỗi job** đó.
8. Presigned URL khi tải qua API download thì đầu ra đi `.tmp` rồi finalize; `.tmp` không bao giờ ra `/api/assets`.
9. Tokens/auth: `GATEWAY_AUTH_TOKEN` cho API; `?token=` chỉ cho `<audio src>` audio-only.
10. `VBEE_ADAPTER=fake` là mặc định; `vbee-preview` = real. Fake phải luôn còn cho dev/test.
11. CDP/browser failure phải degrade health, không crash Gateway.
12. Milestone hiện tại: **M2**. `AGENTS.md` + `.context/MILESTONES.md` là pointer.
13. Confirm trước khi code khi: cần credential live, cài browser/package, migration dữ liệu thật, scope mở rộng ngoài milestone, tài liệu nguồn mâu thuẫn.

## 6. Thông tin module (tóm tắt)

- **GATEWAY_CORE**: gateway quản queue, job, file finalize, asset, HTTP API. Test qua HTTP integration.
- **TTS_PROVIDER_ADAPTERS**: multi-provider; JobRunner chỉ phụ thuộc contract. FileService tự finalize.
  M3/M4 sẽ thêm registry + execution mode. Vbee có 2 mode: preview_download & official_download.
- **BROWSER_SERVICE**: M2 chi giới hạn CDP health qua `/json/version`, tránh cài Playwright ngay.
  Chưa có: connect page, evaluate, intercept network/WebSocket, session reuse. Camoufox/Patchright/Lightpanda là future option.
- **GATEWAY_LIFECYCLE**: lifecycle CLI trước, Tauri gọi/port lại. Không giết process không sở hữu.
- **TAURI_SHELL**: shell mỏng; setup() gọi start_gateway xong mới tạo window (fix race, M2_017).
- **DEV_CLIENT**: tạm thời, chỉ dùng Gateway API. 3 tab: Queue / Assets / Edit (Edit là placeholder timeline).
  Typography: Manrope (UI) + Geist Mono (timestamp/provider/duration).
- **DOCUMENTATION_WORKFLOW**: mọi slice hoàn thành phải có `docs/milestones/<milestone>_<seq>_<name>.md`
  (workflow/Mermaid đầu tiên, mô tả what/files/pattern/verify/limits) + test report + cập nhật `docs/README.md`.

## 7. Tensions

- `TENSIONS_OPEN.md`: **không có tension mở**.
- `TENSIONS_ACTIVE.md`: **không có** active tension đã resolve được ghi.

## 8. Những hạn chế / việc mở (đang biết)

- **WSL↔Windows CDP gap**: nghiệp vụ live end-to-end đang bị chặn bởi kết nối CDP qua biên WSL↔Windows.
  Worker production là Linux Gateway adapter (M2_019); Windows chỉ là probe (`vbee-windows-direct-api.bat`).
- **Live SYNTHESIS payload field set** của đường direct API chưa verify đầy đủ.
- **Voice/speed selection**: hoãn theo quyết định người dùng (M2_014); chọn giọng chưa có mapping code->row ổn định.
- **Mobile-redirect window hẹp** (narrow-window risk) còn mở (M2_010/011).
- **Filenames không còn DB-uniqueness** sau M2_015 (bỏ UNIQUE constraint) — chấp nhận, Vbee tự gắn UUID.
- **Windows-native Rust toolchain chưa có** để chạy Tauri GUI/test máy 2 thật (M2_013 limit).
- **M2_009 direct-API** phần lớn đã bị thay bởi hiểu đúng selection-gate (M2_010); payload field set vẫn là follow-up.

## 9. Commands quan trọng

```bash
# Chạy Gateway (fake worker mặc định) — giữ tab WSL foreground, không background ẩn
cd /mnt/d/Github/ZeroClaw-Vbee-Automate
source ~/.nvm/nvm.sh && nvm use 24
HOST=0.0.0.0 npm run dev
# Mở: http://127.0.0.1:3000/  (Windows không tới thì dùng `hostname -I` + IP WSL)

# Real Vbee preview (browser Linux đã login studio.vbee.vn, CDP 9222)
HOST=0.0.0.0 VBEE_ADAPTER=vbee-preview CDP_URL=http://127.0.0.1:9222 npm run dev

# Health & API smoke
curl http://127.0.0.1:3000/health

# Test
npm run test:m2                      # node --test toàn bộ gateway
npm run smoke                        # smoke gateway
npm run smoke:lifecycle              # smoke lifecycle CLI
cargo test --manifest-path src-tauri/Cargo.toml   # Rust tests

# Context consistency
python3 ../context-mapping/cli.py check-consistency .
python3 ../context-mapping/cli.py build . --quiet
python3 ../context-mapping/cli.py load gateway/src . --include-manual   # module context

# Lifecycle
npm run gateway:start|status|stop
npm run online / npm run offline
```

Env quan trọng: `WORKER_ENABLED` (1 default), `WORKER_POLL_MS` (1000), `VBEE_ADAPTER` (fake|vbee-preview),
`CDP_URL` (http://127.0.0.1:9222), `HOST` (0.0.0.0), `PORT` (3000), `GATEWAY_AUTH_TOKEN`,
`CORS_ORIGIN`, `VOICEFACTORY_REMOTE_GATEWAY_URL`.

## 10. Môi trường máy (tóm tắt `.local/ENVIRONMENT.md` — không commit)

- WSL Debian là môi trường chính. Windows root = `D:\Github\ZeroClaw-Vbee-Automate`, WSL = `/mnt/d/Github/ZeroClaw-Vbee-Automate`.
- Node: nvm default 24.16.0. Rust: rustup stable tại `/home/shinkuro/.cargo/env`.
- Cargo bị thiếu PATH → `source /home/shinkuro/.cargo/env`.
- Tauri build fail `pkg-config` → đã cài `libglib2.0-dev libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev`.
- `sudo` cần password → agent không tự chạy được, phải nhờ human.
- Build Windows installer: cross-compile từ WSL bằng mingw-w64 + NSIS; nếu gặp `Permission denied` viết `resource.lib`,
  build từ filesystem WSL native (`~/vf-build-tmp`) thay vì `/mnt/d/...`.

## 11. Cách dùng file này

1. Đọc file này để nắm bức tranh toàn cảnh.
2. Theo startup protocol, đọc `GLOBAL.md`, `MILESTONES.md`, `MILESTONE_ROADMAP.md` (chỉ milestone đang promote),
   `TENSIONS_OPEN/ACTIVE.md`, và module liên quan file đang sửa.
3. Nếu cần chi tiết thực thi/evidence, đọc `docs/milestones/M2_*.md` và `docs/design/*.md`.