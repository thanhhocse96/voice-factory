# 12. Voice Selection: API vs DOM — và Gap Analysis các tính năng còn thiếu

> Research study (2026-09-22). Không phải plan đã thực thi; đây là cơ sở để chọn
> hướng cho tính năng chọn giọng đọc ("khớp voice") và liệt kê thiếu sót tính năng.

## 1. TL;DR — Khuyến nghị

- **Chọn giọng đọc phải đi đường API, không DOM.** Lý do: Vbee có catalog giọng
  dạng API (`GET /api/public/v1/voices`, `GET /api/v1/voices` + Bearer), còn DOM
  studio không có mapping slug→row (đã chứng minh ở M2_014) và có bug click bị
  chặn bởi dialog chưa rõ nguyên nhân. Dùng API bỏ qua cả hai.
- **Có 2 lane giọng đọc khác nhau**, cần chọn rõ:
  - **Lane Studio session-token (có sẵn trong app)**: `vbee-preview` hiện tại
    (M2_019) gửi `{text, voice_code, speed}` qua WS SYNTHESIS trong page context.
    Catalog cũng đọc được qua cùng session bằng `page.evaluate` (token không rời
    page — giữ invariant M2_019).
  - **Lane Vbee API chính thức (cần app_id + access token, phải mua/quota)**: M4
    `vbee_official_download`; có `GET /api/v1/voices` + `POST /api/v1/tts`
    (param `voice_code`, `speed_rate` 0.1–1.9, sync/async).
- **Giá trị `voice_code` và `speed` hiện đã được gửi đi end-to-end** (UI → queue →
  adapter → WS), nhưng **chưa có catalog/picker để chọn giá trị hợp lệ**, mặc định
  có thể là `fake_voice` không tồn tại trong Vbee, và **chưa xác minh live** Vbee
  accept hay không.

## 2. Bằng chứng

### 2.1. Vbee công bố catalog giọng qua API (nguồn chính thức)

- Vbee TTS API docs (Postman/`vbee.vn`):
  - `GET https://vbee.vn/api/public/v1/voices` — liệt kê giọng, mỗi giọng có `code`.
  - `POST https://vbee.vn/api/v1/tts` — `app_id`, `input_text`, `voice_code`,
    `audio_type`, `speed_rate` (0.1–1.9, mặc định 1.0), `callback_url`. Có cả chế độ
    sync và async; `GET /api/v1/tts/{request_id}` để poll.
- Ví dụ voice_code chuẩn Vbee: `hn_female_ngochuyen_full_48k-fhg`,
  `n_hanoi_male_protrainer_education_vc` — đúng format slug mà project đang dùng
  (xác nhận từ live capture `voice-leaderboard-events`, M2_014:32).
- SDK chính thức `@redonvn/vbee-sdk` (TypeScript) có `voice.list/search/
  getByLanguage/getByGender` → chứng minh API có khả năng filter giọng theo
  ngôn ngữ/giới tính/tên, chính là nhu cầu "khớp voice" (lọc & chọn).

### 2.2. Test live endpoint public bị 401

`GET https://vbee.vn/api/public/v1/voices` trả `401` khi không có auth (kiểm tra
trực tiếp ngày 2026-09-22). Nên catalog qua API cần:
- thẻ API chính thức (app_id + token) — lane M4, HOẶC
- dùng session token của studio đã login (như M2_019/20) để gọi chính xác endpoint
  mà studio dùng (đang cần xác định = một lần capture fresh-page-load, M2_014:69).

### 2.3. Hiện trạng trong repo (code reality)

- UI: `public/index.html:82-90` chỉ có text input `#voiceCode` (default `fake_voice`)
  + `#speed` (default 1.05), **không có picker/catalog/validate**.
- Queue: `gateway/src/application/queue-service.js:7` default `voice_code =
  'fake_voice'` — sang lane vbee-preview sẽ gửi slug không tồn tại lên Vbee với 0
  validation (rủi ro).
- Adapter `vbee-preview`: gửi `{text, voice_code, speed}` trong frame SYNTHESIS
  (`vbee-preview.js:236-246,264-270`); test đã assert wiring nhưng **chưa xác minh
  live** (M2_019:84).
- DOM findings M2_014:40: không có `data-*` mapping giọng; speed field click bị
  `MuiDialog-container` chặn 3 lần. Kết luận M2_014:46: hoãn, "revisit via direct-API".

## 3. Hai lane giọng đọc — so sánh

| Tiêu chí | Lane Studio session (vbee-preview, CÓ sẵn) | Lane API chính thức (vbee_official, M4) |
|---|---|---|
| Auth | Session token trong page context (M2_019) | app_id + access token (mua/quota) |
| TTS call | WS SYNTHESIS `{text, voice_code, speed}` | `POST /api/v1/tts` `{voice_code, speed_rate}` |
| Catalog | Endpoint nội bộ studio (cần capture tìm endpoint) | `GET /api/v1/voices` (Bearer) |
| Param speed | `speed` | `speed_rate` (0.1–1.9) |
| Ràng buộc lưu trữ | Token KHÔNG rời page context (invariant) | Token là credential app — cần storage an toàn |
| Roadmap | Dùng ngay mọi job hiện tại | M4 (official download) |

## 4. Đề xuất triển khai "chọn giọng & khớp voice" — API-first

Thứ tự đề xuất (slice nhỏ, dưới milestone hiện tại hoặc M3):

1. **Xác định endpoint catalog của studio** — 1 lần human-gated: mở studio, mở
   dialog giọng với fresh page load, capture request tải catalog → lấy URL + shape.
   Đây là khoảnh khắc duy nhất cần live session.
2. **`getVoices()` trong page context** — trong adapter `vbee-preview`, đọc catalog
   bằng `page.evaluate(fetch(endpoint, {headers: auth}))`; token không rời page.
   Cache kết quả (vd 24h). Trả về `[{code, name, ...}]`.
3. **Gateway: endpoint danh bạ giọng** — `GET /api/voices` được adapter cung cấp
   (fake trả `fake_voice` + vài mẫu; vbee-preview trả catalog cache). UI gọi qua
   Gateway HTTP (keep invariant: UI không đọc SQLite/credential).
4. **UI: voice picker thật** — dropdown hoặc ô tìm kiếm dựa trên `/api/voices`
   (name, gender, language), có thể kèm audio preview nếu catalog có sampleUrl.
   Bỏ default `fake_voice` khi lane vbee-preview: nếu chưa có catalog → job bị chặn
   với thông báo "chưa có danh sách giọng" thay vì gửi slug rác.
5. **Validate `voice_code` khi queue** — nếu catalog có sẵn, reject job có code
   không nằm trong catalog (lỗi 400) trước khi đụng Vbee.
6. **(M4, tách milestone) Lane official** — dùng cùng catalog cho `POST /api/v1/tts`
   với `speed_rate`; design credential storage an toàn.

Vì sao phần lọc/khớp giọng nên dựa trên metadata catalog (name/gender/language)
thay vì "khớp âm thanh": Vbee SDK & API chỉ expose metadata + preview; không có
service "tìm giọng giống audio mẫu" công khai. "Khớp voice" thực dụng = lọc theo
tiêu chí + nghe preview để chọn, đều làm được từ catalog API.

## 5. Gap Analysis — tính năng còn thiếu

Map theo roadmap (`.context/MILESTONE_ROADMAP.md`) + nguồn `DEV_CLIENT.md`,
`TTS_PROVIDER_ADAPTERS.md`. Cột "Tình trạng" = code reality hiện tại.

| # | Tính năng | Đã có | Còn thiếu / ghi chú | Milestone |
|---|---|---|---|---|
| 1 | Queue → worker → audio → HTTP playback | ✅ | — | M0 |
| 2 | Health + degraded | ✅ | — | M0/M1 |
| 3 | Auth/CORS/remote mode | ✅ | — | M2_013 |
| 4 | Browser lifecycle graceful + session persist Tier2 | ✅ | Tier3/4 = plan (M2_022) | M2 |
| 5 | **Chọn giọng & speed (khớp voice)** | ⚠️ plumbing có, UX chưa | no picker/catalog/validate; live unverified | M2 phần còn thiếu → M3 |
| 6 | Provider/executionMode routing + registry | ❌ | no `provider`/`execution_mode` in DB; server.js if/else | M3 |
| 7 | Vbee dual workflow (official) | ⚠️ preview direct API; ❌ official | no `vbee_official_download` handler | M4 |
| 8 | Human-pace scheduler/delay | ❌ | `DELAY_POLICY` có env nhưng chưa có consumer | M5 |
| 9 | FileService hardening (rename retry…) | ⚠️ | EPERM/EBUSY retry + duplicate-block chưa | M6 |
| 10 | DB migration backup/audit | ❌ | dry-run/backup WAL/audit chưa | M7 |
| 11 | Desktop UI product (tab Queue/Assets/Edit) | ⚠️ dev client, Edit placeholder | M8 |
| 12 | ZeroClaw optional client | ❌ | | M9 |
| 13 | Packaging startup (splash proper) | ⚠️ quick-fix M2_017 | design/11 plan | M10 |
| 14 | Chunk-split dài văn bản | ❌ | DEV_CLIENT.md:59-64 | ngoài roadmap (mới) |
| 15 | Voice catalog endpoint + picker | ❌ | chính là #5 | mới |

Khác: chưa có credential storage cho provider (out-of-scope M2/M3, cần cho M4);
M9 chỉ có trên giấy; `docs/M2_COMPLETION_CHECKLIST.md` stale (đừng dùng làm truth).

Handy: toàn bộ M3–M10 maturity items đều chưa check trong roadmap — định hình lộ
trình: **sau M2 → M3 (mở đường provider/mode + voice catalog như slice sớm) → M4
(official) khi có API account → M5 pacing nếu cần vận hành thực >1 job liên tục.**

## 6. Rủi ro & điều chưa biết

- Endpoint catalog của studio chưa xác định được (cần 1 capture live, human-gated).
- Live accept của `{voice_code, speed}` qua WS SYNTHESIS chưa verify (M2_019:84).
- `GET /api/public/v1/voices` 401 khi chưa auth — có thể không có catalog public
  miễn phí; lane studio là đường khả thi nhất mà không cần mua API.
- Speed: lane official dùng `speed_rate` (đã doc), lane preview dùng `speed`
  (chưa doc) — cần giữ 2 mapping khác nhau.

## 7. Khuyến nghị hành động tiếp

1. (Human-gated, nhỏ) Capture catalog endpoint studio + verify 1 `voice_code` live
   qua WS SYNTHESIS — chốt 2 điều chưa biết lớn nhất.
2. (Code) Slice M3 mở đầu: `GET /api/voices` + catalog cache + UI picker + validate
   `voice_code` khi queue; giữ fake adapter default.
3. (Quyết định M4) Mua/tạo app Vbee API nếu muốn lane official + lo code `speed_rate`.