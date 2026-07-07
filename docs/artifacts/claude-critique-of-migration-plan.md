## Phản biện kỹ thuật — Migration Plan to Gateway Core

---

### [ARCHITECTURE]

**Gateway Core có giải quyết root cause không, hay chỉ relocate complexity?**

Migration plan xác định vấn đề là "Worker trộn browser logic và Vbee logic" — đây là symptom, không phải root cause. Root cause thực sự là **không có boundary rõ ràng giữa transport layer (browser/CDP), business logic (TTS job), và persistence layer (SQLite)**. Câu hỏi: Gateway Core mới có enforced boundary thật sự — ví dụ VbeeService không thể import thẳng từ BrowserService — hay chỉ là folder structure đẹp hơn mà vẫn cho phép cross-import tự do trong cùng một Node.js process?

Nếu không có boundary enforcement (interface contract, dependency injection, hoặc ít nhất là lint rule cấm cross-import), complexity cũ sẽ tái xuất hiện sau 2–3 tháng phát triển.

**Single point of failure còn tồn tại không?**

Kiến trúc cũ: Gateway Podman container là SPOF. Kiến trúc mới: Gateway Core local process là SPOF — nhưng bây giờ nó còn giữ thêm Queue Service, Job State Machine, Delay Policy, và là writer duy nhất của SQLite. Nghĩa là **blast radius khi Gateway crash còn lớn hơn cũ**. Câu hỏi: có cơ chế nào để Tauri UI detect Gateway crash và tự restart không, hay user phải tự biết mà restart?

---

### [RISK]

**Rủi ro nào có xác suất cao nhất trong 2 tuần đầu?**

Trong 6 rủi ro được liệt kê, "Local sidecar khó package" và "Vbee API chưa ổn" được đặt ở cuối — nhưng thực tế hai cái này sẽ xuất hiện ngay từ Phase 1. Cụ thể: Phase 1 yêu cầu Tauri spawn Node gateway, nhưng master doc chưa có bất kỳ code nào làm điều này. Đây không phải rủi ro tương lai — đây là **prerequisite chưa được thiết kế**. Câu hỏi: Tauri sẽ spawn gateway bằng cơ chế nào — `tauri::process::Command`, sidecar binary, hay shell script? Câu trả lời ảnh hưởng trực tiếp đến toàn bộ Phase 9.

**Rủi ro chưa được đề cập — Windows file lock:**

Master doc nhắc đến atomic rename trên NTFS, nhưng migration plan không đề cập rủi ro **Windows file locking**. Trên Windows, nếu Sound Editor (hoặc bất kỳ process nào) đang đọc file `.mp3`, `fs.rename()` sẽ throw `EPERM`, không phải atomic fail mà là hard error. `better-sqlite3` cũng có behavior khác trên Windows khi WAL file bị lock bởi antivirus scan. Câu hỏi: có test case nào cho Windows-specific file lock behavior trong acceptance criteria không?

---

### [DB]

**Migration SQL có handle `file_path IS NULL` không?**

Migration SQL trong Phase 2 có `WHERE download_complete = 1 AND file_path IS NOT NULL` — đây là đúng. Nhưng câu hỏi tiếp theo: các job có `download_complete = 0` và `file_path IS NOT NULL` — tức là job đã download xong file nhưng chưa update flag — sẽ bị bỏ qua hoàn toàn. Trong thực tế, đây là chính xác các job bị interrupt ở bước `atomic rename → UPDATE download_complete=1`. Nếu có 5–10 job dạng này trong production DB, audio file đã có trên disk nhưng sẽ không có row trong `audio_assets`. Câu hỏi: sau migration, có script audit nào kiểm tra "file tồn tại trên disk nhưng không có trong audio_assets" không?

**Race condition giữa `insert audio_assets` và `update status='done'`:**
 
Migration plan Phase 6 mô tả File Service: "Rename xong mới insert audio_assets. Job done sau khi asset insert thành công." Nhưng đây là 2 SQLite write riêng biệt — không phải 1 transaction. Nếu process crash giữa `INSERT audio_assets` thành công và `UPDATE tts_queue SET status='done'`, job sẽ ở trạng thái `finalizing` mãi mãi, trong khi asset đã tồn tại. Worker retry sẽ làm gì — tạo asset duplicate, hay check trước? Câu hỏi: hai operation này có được wrap trong cùng 1 SQLite transaction không?

---

### [PHASE]

**Tại sao Phase 4 và Phase 5 tuần tự thay vì song song?**

`BrowserSessionAdapter` (Phase 5) cần `BrowserService` (Phase 4) — đây là dependency thật. Nhưng `OfficialApiAdapter` và `FakeVbeeAdapter` (cũng trong Phase 5) hoàn toàn **không cần BrowserService**. Migration plan gộp 3 adapter vào cùng một phase, tạo ra bottleneck nhân tạo. Câu hỏi: nếu `FakeVbeeAdapter` và `OfficialApiAdapter` được tách ra và làm song song với Phase 4, timeline có rút ngắn được 1–2 sprint không?

**Phase 7 (UI migration) có thể bắt đầu từ Phase 1 không?**

Phase 7 yêu cầu UI gọi `/health` và `/api/queue` — cả hai endpoint này đã phải có từ acceptance test của Phase 1. Câu hỏi: lý do gì để UI migration phải đợi đến Phase 7, thay vì bắt đầu parallel từ Phase 1 với một feature flag đơn giản `USE_GATEWAY_CORE=true`?

---

### [ROLLBACK]

**Rollback Phase 2 — UI cũ có còn compatible không?**

Phase 2 thêm bảng `audio_assets` mới và giữ nguyên `tts_queue`. Rollback plan nói "UI có thể tạm đọc lại tts_queue nếu /api/assets chưa xong." Nhưng rollback không phải là "chưa xong" — rollback xảy ra khi có lỗi. Nếu lỗi là ở `/api/assets`, code UI cũ đọc `tts_queue.download_complete` vẫn hoạt động — đây là rollback thực sự feasible. Nhưng nếu lỗi là ở migration SQL đã chạy và làm corrupt `tts_queue`, thì không có gì để rollback về. Câu hỏi: migration SQL có được test trên một bản copy của production DB trước khi chạy thật không?

**Phase nào rollback là không thực tế:**

Phase 6 (File Service) có rollback "Tạm giữ finalize cũ với tts_queue.file_path" — nhưng nếu File Service đã chạy và đổi naming convention sang `001_name.mp3`, các file cũ với naming convention khác sẽ không được tìm thấy bởi code cũ. Câu hỏi: File Service có migrate naming convention của các file cũ trên disk không, hay chỉ áp dụng convention mới cho file mới?

---

### [VBEE]

**Hậu quả của việc bỏ sót frame `GET_REMAINING_PREVIEW`:**

Master doc ghi rõ: "BẮT BUỘC — bỏ qua server đánh dấu session bất thường." Hậu quả cụ thể không được document — có thể là rate limit tạm thời, có thể là flag account, có thể là WS connection bị throttle ở session tiếp theo. Đây là **unvalidated assumption** trong master doc. Migration plan không có bất kỳ mention nào về frame này. Câu hỏi: `BrowserSessionAdapter` có một integration test nào verify đủ 7 frame WS được gửi/nhận đúng thứ tự không, hay chỉ test happy path "có audio_link trong response"?

**Presigned URL TTL 3 phút và queue delay:**

Phase 3 (Delay Policy) có thể set delay lên đến 90 giây với jitter. Phase 5 (Vbee Service) trả về `audioUrl`. Phase 6 (File Service) mới thực sự download. Nếu ba service này không nằm trong cùng một synchronous flow — tức là có queue buffer giữa chúng — thì hoàn toàn có thể Vbee trả URL lúc 12:00:00, File Service bắt đầu download lúc 12:03:05, và URL đã expired. Câu hỏi: flow từ `VbeeService.convert()` đến `FileService.downloadAndFinalize()` có phải là direct call trong cùng một async chain, hay có message queue ở giữa?

---

### [MVP]

**App có crash khi Brave chưa chạy không?**

MVP cut line yêu cầu "Browser CDP health ok" — nhưng đây là điều kiện runtime, không phải startup condition. Nếu Gateway Core khởi động và `/health` check CDP ngay lập tức, behavior khi CDP không có sẽ quyết định toàn bộ UX. Master doc Troubleshoot section có entry "ECONNREFUSED port 9222" — đây là lỗi thường gặp. Câu hỏi: khi CDP unavailable, `/health` trả `ok: false` hay throw 500? Và Tauri UI khi nhận `/health` fail sẽ hiện error dialog, disable queue button, hay crash hoàn toàn?

**Acceptance test cho incognito worker với delay 30s–3 phút:**

Nếu acceptance test của Phase 1 là `curl POST /api/queue` rồi kiểm tra `audio_assets` có row — với fake worker thì ổn. Nhưng Phase 5 trở đi dùng real worker với incognito delay thật. Câu hỏi: acceptance test sẽ hardcode `DELAY_POLICY=none` trong CI, hay chờ thật 3 phút? Nếu hardcode, test có cover delay logic không? Nếu chờ thật, CI pipeline có timeout dưới 3 phút không?

---

## 3 điểm có nguy cơ thất bại cao nhất

**1. Tauri–Gateway lifecycle chưa được thiết kế.**

Toàn bộ migration plan giả định Gateway Core chạy như local sidecar được Tauri spawn và manage. Nhưng không có phase nào thiết kế cụ thể cơ chế này — restart on crash, health polling interval, port conflict handling, shutdown on app close. Đây là infrastructure foundation mà nếu sai, mọi phase bên trên đều bất ổn.

**2. Vbee WS protocol không có integration test.**

`GET_REMAINING_PREVIEW` frame, 3-phút TTL, session flag — tất cả là observed behavior từ DevTools, chưa phải documented contract. `BrowserSessionAdapter` sẽ là đoạn code mỏng manh nhất trong hệ thống mà không có cách nào test độc lập nếu không có Brave đang chạy với session Vbee thật. Không có test harness cho layer này = mọi bug sẽ chỉ tìm thấy được ở end-to-end.

**3. DB migration chưa có data audit step.**

Migration SQL chỉ migrate `download_complete=1 AND file_path IS NOT NULL`. Không có step nào audit disk vs DB sau migration, không có rollback script cho corrupt state, không có test trên production DB snapshot. Với một app chạy local single-user, mất data trong DB là mất vĩnh viễn — không có S3 backup, không có replication.
