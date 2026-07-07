# ZEROCLAW x VBEE TTS - Working Spec

Phiên bản làm việc: 2026-05-25  
Mục tiêu: gom các quyết định quan trọng để hiện thực app ZeroClaw điều khiển Vbee TTS qua client view/browser, có queue, nghe thử, đổi sound, tải file và Sound Editor.

## 1. Kết luận kiến trúc

Không nên để ZeroClaw trực tiếp click/type trên Vbee bằng BrowserTool/WebDriver.

Hướng nên chốt:

```text
Tauri / Client View
  -> ZeroClaw skill
  -> HTTP localhost:3000/api/queue
  -> Gateway Node.js
  -> Playwright attach Brave/Chromium CDP
  -> Vbee TTS / Vbee client view
  -> download .tmp
  -> atomic rename .mp3
  -> SQLite download_complete=1
  -> Sound Editor hiển thị
```

Vai trò:

- Tauri / Vue UI: nhập text, tách đoạn, chọn voice, speed, project, incognito, xem queue, Sound Editor.
- ZeroClaw: task runner. Nhận lệnh workflow và gọi HTTP vào Gateway. Có thể chạy skill-only, không cần LLM.
- Gateway Node.js: queue, SQLite WAL, Playwright worker, download, atomic rename, ffmpeg export.
- Brave/Chromium headed: browser thật, profile thật, session Vbee thật, mở CDP port 9222.
- Playwright: attach vào browser đang chạy bằng `connectOverCDP`.
- ffmpeg: chỉ dùng khi export final, không dùng để preview realtime.

## 2. Quyết định browser-control

### 2.1 Hướng chính cho MVP

Dùng Playwright attach vào Brave hoặc Chromium headed qua CDP.

Lý do:

- Giữ được session/cookie/profile thật.
- Không cần launch browser mới mỗi job.
- Các request gọi từ trong browser context nên giống hành vi client hơn HTTP thuần từ Node.js.
- Dễ thay backend browser sau này mà không đổi ZeroClaw skill.

Khởi động browser:

```bat
@echo off
setlocal
set ROOT=%~dp0..
set PROFILE=%ROOT%\data\brave-profile

if not exist "%PROFILE%" mkdir "%PROFILE%"

netstat -ano | findstr ":9222" >nul 2>&1
if %errorlevel%==0 (
  echo [OK] Browser da chay tren port 9222
  goto :end
)

start "ZeroClaw-Brave" ^
  "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe" ^
  --remote-debugging-port=9222 ^
  --user-data-dir="%PROFILE%" ^
  --disable-blink-features=AutomationControlled ^
  --disable-features=AutomationControlled ^
  --no-first-run ^
  --no-default-browser-check ^
  --password-store=basic ^
  https://studio.vbee.vn

timeout /t 3 /nobreak >nul

:end
curl -s http://localhost:9222/json/version
endlocal
```

Trong Gateway nếu chạy trong Podman/container, CDP URL không phải `localhost:9222`, mà là:

```text
http://host.containers.internal:9222
```

### 2.2 Brave hay Chromium?

Brave tốt cho máy cá nhân vì có sẵn session thật, nhưng nên để Shields ở Standard. Strict mode có thể tạo fingerprint lạ.

Chromium vanilla profile riêng là lựa chọn sạch hơn nếu sau này bán workflow cho người khác.

Khuyến nghị:

- MVP cá nhân: Brave headed + profile riêng.
- Đóng gói cho người khác: Chromium/Chrome profile riêng + cùng logic CDP.
- Không hard-code đường dẫn profile; dùng đường dẫn app data hoặc root project.

### 2.3 Camoufox / Patchright / Chromium alternatives

Các hướng thay thế nên được thiết kế như adapter trong Gateway, không thay kiến trúc chính.

| Hướng | Vị trí trong hệ | Khi nào dùng |
|---|---|---|
| Playwright + Brave CDP | baseline MVP | Test nhanh, dùng profile thật |
| Playwright + Chromium CDP | baseline production nhẹ | Dễ đóng gói, ít biến số Brave |
| Lightpanda (CDP headless) | experimental adapter | Headless, ~9x less memory / faster than Chrome; good for CI, low-resource desktop, or pure automation. Drop-in via connectOverCDP. **Validate stealth/fingerprint on Vbee** (not a "real" user browser). |
| Camoufox | adapter thử nghiệm | Khi Chromium/Brave bị flag hoặc cần fingerprint Firefox |
| Patchright | adapter thử nghiệm | Khi cần Playwright-like stealth mạnh hơn |
| Vbee API chính thức | ưu tiên nếu dùng được | Ổn định, đúng hướng sản phẩm, ít phụ thuộc UI |

Không nên bắt đầu bằng Camoufox/Patchright. Hãy làm Gateway interface ổn trước, sau đó đổi browser adapter nếu cần.

**Ghi chú cho Lightpanda (và headless nói chung):** Thiết kế gốc ưu tiên "Brave/Chromium headed + profile thật" để có session/cookie/fingerprint giống user thật khi tương tác Vbee (tránh bị coi là bot, rate limit, hoặc yêu cầu GET_REMAINING_PREVIEW bị lỗi). Lightpanda phù hợp làm option phụ (nhẹ, headless), nhưng cần test kỹ trên flow preview/official trước khi coi là baseline. Architecture hỗ trợ tốt vì mọi browser logic nằm sau BrowserService + adapter (hiện tại M2 chỉ health CDP, tương lai sẽ attach page/WS).

## 3. Hai workflow cốt lõi

### 3.1 Workflow 1: Nghe thử / Incognito

Mục tiêu: tạo audio preview nhanh, hạn chế ghi history convert chính thức.

Luồng:

```text
Client View
  -> add queue incognito=1
  -> Gateway worker pick job
  -> attach browser CDP
  -> page.evaluate() gọi WS demo hoặc client-side call
  -> nhận audio_link
  -> download job_id.tmp
  -> rename job_id.mp3
  -> update download_complete=1
```

Ghi chú:

- Delay nên theo số từ/phút, không random cứng.
- Context/page nên đóng sau job.
- Nếu download fail, xóa `.tmp` và tăng `retry_count`.

### 3.2 Workflow 2: Đổi sound / Convert chính thức

Mục tiêu: tạo audio bằng luồng Vbee chính thức, dùng JWT/session hợp lệ.

Luồng:

```text
Client View
  -> add queue incognito=0
  -> Gateway worker pick job
  -> attach browser CDP
  -> page.evaluate() gọi Vbee API hoặc thao tác client view
  -> nhận request_id
  -> poll trạng thái
  -> lấy audio/presigned URL
  -> download ngay
  -> atomic rename
  -> update DB
```

Ghi chú:

- Nếu dùng API chính thức được thì ưu tiên API.
- Nếu phải điều khiển UI, ưu tiên `page.evaluate()` hoặc request trong browser context thay vì click selector mong manh.
- Presigned URL thường có TTL ngắn, có link là tải ngay.

## 4. Delay giả nhập liệu theo số từ/phút

Ý tưởng mới: tính thời gian "giống đang nhập liệu" bằng số từ chia tốc độ gõ/đọc theo phút, rồi trừ 1 giây.

Công thức:

```text
typing_seconds = (word_count / words_per_minute) * 60 - 1
```

Nên clamp để tránh delay quá ngắn hoặc quá dài:

```text
typing_seconds = clamp((word_count / wpm) * 60 - 1, min=2, max=90)
```

Gợi ý:

- `wpm = 160..220`
- `min = 2s`
- `max = 90s` cho MVP cá nhân
- Thêm jitter 85% đến 115%

Code Gateway:

```js
function countWords(text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean).length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function estimateTypingDelayMs(text, wpm = 180, minSeconds = 2, maxSeconds = 90) {
  const wordCount = countWords(text);
  const seconds = (wordCount / wpm) * 60 - 1;
  const clamped = clamp(seconds, minSeconds, maxSeconds);
  const jitter = 0.85 + Math.random() * 0.3;
  return Math.round(clamped * jitter * 1000);
}

// Trong worker:
await page.waitForTimeout(estimateTypingDelayMs(job.content, 180));
```

So với random delay `10s-3min`, cách này tốt hơn vì delay tăng/giảm theo độ dài chunk.

## 5. Text Pre-processor

Mục tiêu: cắt văn bản dài thành chunk an toàn trước khi đưa vào queue.

Nguyên tắc:

- Mỗi chunk nên dưới 500 ký tự.
- Ưu tiên cắt theo câu, xuống dòng, dấu `.`, `!`, `?`.
- Cho phép user sửa/reorder trước khi queue.
- Lưu `group_id` để biết các chunk thuộc cùng một bài.

Code tham khảo:

```js
function splitText(rawText, maxChars = 500) {
  const clean = String(rawText || '')
    .replace(/[\u{1F600}-\u{1F6FF}]/gu, '')
    .replace(/[#@$%^*]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const sentences = clean.match(/[^.!?\n]+[.!?\n]?/g) || [clean];
  const chunks = [];
  let current = '';

  for (const sentence of sentences) {
    const next = `${current}${sentence}`.trim();
    if (next.length <= maxChars) {
      current = next + ' ';
      continue;
    }

    if (current.trim()) chunks.push(current.trim());

    if (sentence.length > maxChars) {
      for (let i = 0; i < sentence.length; i += maxChars) {
        chunks.push(sentence.slice(i, i + maxChars).trim());
      }
      current = '';
    } else {
      current = sentence.trim() + ' ';
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}
```

## 6. SQLite schema tối thiểu

Bật WAL:

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
```

Schema MVP:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  folder TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS project_sequence (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id),
  last_seq INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tts_queue (
  id TEXT PRIMARY KEY,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  content TEXT NOT NULL,
  voice_code TEXT NOT NULL,
  speed REAL DEFAULT 1.05,
  incognito INTEGER DEFAULT 0,
  project_id INTEGER REFERENCES projects(id),
  group_id TEXT,
  status TEXT DEFAULT 'pending',
  priority INTEGER DEFAULT 5,
  retry_count INTEGER DEFAULT 0,
  request_id TEXT,
  download_complete INTEGER DEFAULT 0,
  processed_at DATETIME,
  relative_path TEXT,
  file_path TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS tts_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  filename TEXT NOT NULL,
  content TEXT NOT NULL,
  voice_code TEXT NOT NULL,
  speed REAL,
  incognito INTEGER DEFAULT 0,
  project_id INTEGER REFERENCES projects(id),
  group_id TEXT,
  seq_number INTEGER,
  download_complete INTEGER DEFAULT 0,
  file_path TEXT,
  duration_ms INTEGER,
  status TEXT DEFAULT 'ok'
);

CREATE TABLE IF NOT EXISTS text_chunks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  seq INTEGER NOT NULL,
  content TEXT NOT NULL,
  char_count INTEGER,
  status TEXT DEFAULT 'draft',
  voice_code TEXT,
  speed REAL DEFAULT 1.05,
  incognito INTEGER DEFAULT 0,
  group_id TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sound_timeline (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  name TEXT NOT NULL,
  tracks TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME
);
```

## 7. Atomic file workflow

Không ghi trực tiếp ra `.mp3`.

Luồng chuẩn:

```text
1. Worker nhận job.
2. DB transaction: status='processing', lấy seq tiếp theo.
3. Download vào file .tmp.
4. fs.rename(.tmp -> final .mp3).
5. DB update: status='done', download_complete=1.
6. Insert tts_log.
```

Code ý tưởng:

```js
async function finalizeDownload(db, job, tmpPath, finalPath, filename) {
  await fs.rename(tmpPath, finalPath);

  const update = db.prepare(`
    UPDATE tts_queue
    SET status='done',
        download_complete=1,
        relative_path=?,
        file_path=?,
        processed_at=CURRENT_TIMESTAMP
    WHERE id=?
  `);

  update.run(filename, finalPath, job.id);
}
```

Maintenance:

- Reset job `processing` quá 30 phút về `pending`.
- Xóa `.tmp` cũ hơn 2 giờ.
- Giới hạn retry, ví dụ `retry_count <= 3`.

## 8. Gateway API tối thiểu

Endpoint:

```text
POST /api/queue
GET  /api/queue
GET  /api/queue/:id
POST /api/jobs/:id/retry
POST /api/jobs/:id/cancel
GET  /api/audio/:filename
```

Payload thêm queue:

```json
{
  "content": "Xin chào",
  "voice_code": "sg_female_tuongvy_call_44k-fhg",
  "speed": 1.05,
  "incognito": 1,
  "project_id": 1,
  "group_id": "uuid"
}
```

ZeroClaw skill chỉ cần gọi `POST /api/queue`.

## 9. ZeroClaw skill-only config

ZeroClaw không cần tự điều khiển browser.

`zeroclaw/config.toml`:

```toml
[agent]
name = "VbeeTTSRunner"

[workspace]
dir = "C:\\ZeroClaw-Vbee-TTS\\zeroclaw\\workspace"

[channels.cli]
enabled = true

[tools.http]
enabled = true
allowed_domains = ["127.0.0.1", "localhost"]

[tools.browser]
enabled = false

[tools.shell]
enabled = false

[tools.file]
enabled = true

[security]
workspace_scoped = true
deny_by_default = true
```

Skill nghe thử:

```toml
name = "vbee-hear-test"
version = "1.0.0"
description = "Gửi chunk text vào queue incognito - WS Demo / preview"

[[tools]]
name = "add_to_incognito_queue"
kind = "http"
description = "Thêm job vào hàng đợi incognito"
allowed_domains = ["127.0.0.1", "localhost"]

[tools.request]
method = "POST"
url = "http://127.0.0.1:3000/api/queue"
content_type = "application/json"

[tools.input_schema]
type = "object"
required = ["content", "voice_code"]

[tools.input_schema.properties.content]
type = "string"

[tools.input_schema.properties.voice_code]
type = "string"

[tools.input_schema.properties.speed]
type = "number"
default = 1.05

[tools.input_schema.properties.project_id]
type = "integer"
default = 1

[tools.body_template]
content = "{{content}}"
voice_code = "{{voice_code}}"
speed = "{{speed}}"
incognito = 1
project_id = "{{project_id}}"
```

Skill đổi sound:

```toml
name = "vbee-change-sound"
version = "1.0.0"
description = "Gửi chunk text vào queue convert chính thức"

[[tools]]
name = "add_to_convert_queue"
kind = "http"
description = "Thêm job vào hàng đợi convert"
allowed_domains = ["127.0.0.1", "localhost"]

[tools.request]
method = "POST"
url = "http://127.0.0.1:3000/api/queue"
content_type = "application/json"

[tools.input_schema]
type = "object"
required = ["content", "voice_code"]

[tools.input_schema.properties.content]
type = "string"

[tools.input_schema.properties.voice_code]
type = "string"

[tools.input_schema.properties.speed]
type = "number"
default = 1.05

[tools.input_schema.properties.project_id]
type = "integer"
default = 1

[tools.body_template]
content = "{{content}}"
voice_code = "{{voice_code}}"
speed = "{{speed}}"
incognito = 0
project_id = "{{project_id}}"
```

## 10. Podman / Gateway network

Nếu Gateway chạy trong Podman:

```bat
podman run -d ^
  --name tts-gateway ^
  -v "%APPDATA%\zeroclaw-tts\data:/app/data:Z" ^
  -p 3000:3000 ^
  --add-host=host.containers.internal:host-gateway ^
  -e DATABASE_PATH=/app/data/tts.db ^
  -e CDP_URL=http://host.containers.internal:9222 ^
  -e VBEE_JWT=%VBEE_JWT% ^
  tts-gateway
```

Kiểm tra container thấy browser:

```bat
podman exec -it tts-gateway curl http://host.containers.internal:9222/json/version
```

Nếu fail:

- Kiểm tra Brave/Chromium đã chạy port 9222 chưa.
- Thử `--network host`.
- Kiểm tra firewall.
- Trên Windows/WSL2, `host.containers.internal` đôi khi cần cấu hình lại.

## 11. Sound Editor

Nguyên tắc:

- Preview realtime dùng Web Audio API + wavesurfer.js.
- ffmpeg chỉ chạy khi export final.
- Sound Editor chỉ query file `download_complete=1`.
- Không hiển thị file còn `.tmp`.

Timeline JSON:

```json
[
  { "seq": 1, "file": "001_xinchao.mp3", "start_ms": 0, "duration_ms": 2500 },
  { "seq": 2, "file": "002_camon.mp3", "start_ms": 2500, "duration_ms": 1800 }
]
```

ffmpeg export cần normalize sample rate:

```bash
ffmpeg -i input.mp3 -ac 2 -ar 48000 \
  -filter_complex "[0:a]aresample=48000,pan=stereo|c0=c0|c1=c0" \
  output_stereo.mp3
```

## 12. Thứ tự triển khai

### Pha 1 - Browser/Gateway chạy được

- Tạo `scripts/start-brave.bat`.
- Mở Brave/Chromium port 9222.
- Login Vbee thủ công lần đầu.
- Test `curl http://localhost:9222/json/version`.
- Tạo Gateway Node.js với `/api/queue`.
- Bật SQLite WAL.
- Test Gateway add/list queue.

### Pha 2 - Worker nghe thử

- Viết Playwright attach CDP.
- Tính delay theo số từ/phút.
- Gọi WS demo hoặc client-side flow.
- Download `.tmp`.
- Rename `.mp3`.
- Update `download_complete=1`.

### Pha 3 - Worker đổi sound

- Dùng API chính thức nếu token/app id hoạt động.
- Nếu không, dùng browser context/client view.
- Lưu `request_id`.
- Poll.
- Download ngay khi có audio URL.

### Pha 4 - ZeroClaw skills

- Tạo workspace skills.
- Skill nghe thử gọi `/api/queue` với `incognito=1`.
- Skill đổi sound gọi `/api/queue` với `incognito=0`.
- Test skill-only không LLM.

### Pha 5 - Tauri UI

- UI nhập text.
- Text Pre-processor cards.
- Queue table.
- Project/voice/speed/incognito controls.
- Sound Editor chỉ đọc file hoàn tất.

### Pha 6 - Packaging

- Bundle ZeroClaw sidecar nếu cần.
- Với MVP cá nhân: Podman có thể chạy riêng.
- Với app bán cho người khác: cân nhắc Node/Gateway native sidecar để giảm phụ thuộc Podman.

## 13. Checklist debug

Browser:

```bat
curl http://localhost:9222/json/version
```

Gateway:

```bat
curl http://localhost:3000/api/queue
```

Podman thấy browser:

```bat
podman exec -it tts-gateway curl http://host.containers.internal:9222/json/version
```

Log:

```bat
podman logs -f tts-gateway
```

SQLite:

```sql
SELECT id, status, incognito, retry_count, download_complete, relative_path
FROM tts_queue
ORDER BY created_at DESC
LIMIT 20;
```

Reset job kẹt:

```sql
UPDATE tts_queue
SET status='pending', notes='Reset manually'
WHERE status='processing';
```

## 14. Rủi ro cần nhớ

| Rủi ro | Cách giảm |
|---|---|
| Vbee đổi UI selector | Không phụ thuộc selector; ưu tiên API/page.evaluate |
| JWT hết hạn | Thêm màn hình cấu hình token hoặc auto-refresh sau |
| Browser CDP không mở | Start script + healthcheck trước worker |
| Podman không thấy host | Test `host.containers.internal`; fallback `--network host` |
| File .tmp tồn đọng | Maintenance worker |
| SQLite locked | WAL + transaction ngắn |
| Delay quá máy móc | Dùng delay theo word_count + jitter |
| Brave fingerprint lạ | Shields Standard, hoặc chuyển Chromium vanilla |

## 15. Quy tắc làm việc tiếp theo

- Mọi automation browser đặt trong Gateway adapter.
- ZeroClaw skill không chứa logic Vbee phức tạp.
- Mọi file audio phải đi qua `.tmp -> rename -> download_complete=1`.
- Mọi preview trong Sound Editor dùng browser audio engine.
- ffmpeg chỉ export final.
- Delay worker dùng công thức word_count / WPM.
- Browser adapter phải thay được: Brave CDP, Chromium CDP, Camoufox, Patchright.

