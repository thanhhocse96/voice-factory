# M2_023 Voice Catalog Hybrid Picker — Test Report

> Test report theo Module Test And Report Protocol cho slice
> "hybrid voice catalog + picker" (M2_023).

## Command & result

### WSL (Debian, node 24)

```bash
node --test 'gateway/src/**/*.test.js'
```

```text
ℹ pass 77
ℹ fail 0
```

Kèm syntax check:

```bash
node --check gateway/src/config.js && node --check gateway/src/server.js && \
node --check gateway/src/api/routes.js && \
node --check gateway/src/vbee/catalog/voice-catalog.js && \
node --check gateway/src/vbee/adapters/fake-vbee.js && \
node --check gateway/src/vbee/adapters/vbee-preview.js && \
node --check public/app.js && --check cho 4 file test
# ALL_SYNTAX_OK
```

Context consistency (WSL):

```bash
PYTHONUNBUFFERED=1 /home/shinkuro/.venvs/context-mapping/bin/python -u \
  ../context-mapping/cli.py check-consistency .
# OK  Context files consistent.
```

## Covered cases

- `voice-catalog.test.js` (10): normalize list phẳng kiểu official; bỏ entry
  không có code; fallback tên = code; field mapping tùy biến; gender vi/tiếng
  Anh; classifyOwnership từ vựng provider (`vbee`, `Cá nhân`, `Cộng đồng`,
  empty→unknown, boolean); extractVoicesArray theo path + auto-detect top-level +
  nested + shape lạ; `is_personal:false` → `vbee`; merge union + upgrade
  `unknown` khi catalog sau rõ hơn.
- `fake-vbee.test.js` (+1): `listVoices()` seed catalog — có `fake_voice`,
  có `personal`, có `vbee`, mọi voice có code/name.
- `vbee-preview.test.js` (+5): unconfigured → warning không throw, không gọi
  browser; fetch catalog trong `page.evaluate` → normalize + token không xuất
  hiện trong arg; cache TTL (2 lần gọi → 1 evaluate); session fail → warning
  (không throw); HTTP 500 → warning `http-500`.
- `routes.test.js` (+3): `/api/voices` 401 khi authToken cấu hình (không
  auth-exempt); 200 trả catalog từ adapter; 200 catalog rỗng khi chưa wire
  adapter.
- Toàn bộ suite cũ chạy lại: **77/77 pass** (trước slice là 57/57 → thêm
  20 tests cho slice này).

## Residual risk

- Studio catalog endpoint thật chưa capture live → phần auto-detect/shape
  mapping chưa được chạy trên data thật (chỉ env-override + test giả lập).
- Live accept `voice_code`/`speed` qua WS SYNTHESIS với code chọn từ picker
  chưa verify (human-gated, homelab).
- UI picker chỉ test bằng code review; chưa smoke-gateway trên browser thật
  (gateway port 3000 đang chạy, không được đụng).

## Next action

- Xác nhận với human để capture live catalog studio → set
  `VBEE_VOICES_URL`/`VBEE_VOICES_ARRAY_FIELD` → smoke
  `GET /api/voices` trên gateway thật.
- Test một job voice thật qua picker trên homelab khi session Vbee sống.