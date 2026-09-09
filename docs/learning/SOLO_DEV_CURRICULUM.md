# Giáo trình Solo Dev — Tự tay code plan 08 không cần agent

**Tên tài liệu:** `SOLO_DEV_CURRICULUM.md` (Giáo trình Solo Dev — Từ Plan đến Production)
**Ngày:** 2026-07-12
**Dành cho:** Chủ dự án, trong kịch bản phải tự code toàn bộ [design/08](../design/08_usable-build-and-distributed-deployment.md) + [design/09](../design/09_test-suite-plan.md) bằng tay.
**Chuẩn tham chiếu:** năng lực của một dev 8+ năm kinh nghiệm — không phải "biết nhiều công nghệ" mà là **biết cái gì sẽ hỏng trước khi nó hỏng**.

---

## Bài 0 — Dev 8y+ khác dev 3y ở chỗ nào (khi nhìn đúng plan này)

Cùng đọc plan 08, hai người thấy hai thứ khác nhau:

| Dev 3 năm thấy | Dev 8+ năm thấy |
|---|---|
| "Cài Playwright, gọi connectOverCDP, xong Phase C" | "Điểm chết là JWT/DOM selector — thứ duy nhất không kiểm soát được. Làm skeleton trước, dồn thời gian vào phiên khám phá live session" |
| "Thêm HOST=0.0.0.0 là gọi được từ máy kia" | "Mở port trước khi có auth = mọi máy cùng LAN/tailnet điều khiển được browser đang login Vbee của mình. Auth TRƯỚC, mở host SAU" |
| "Để cả folder data/ vào OneDrive cho tiện sync" | "SQLite WAL + atomic rename trong thư mục sync = corrupt data chỉ là vấn đề thời gian. Copy-after-finalize, không share nguồn" |
| "Code chạy rồi, test sau" | "Không viết test ngay cũng được, nhưng **contract và seam phải chốt ngay** — vì refactor để test được sau này đắt gấp 10 lần" |
| "Job chạy xong là done" | "Job fail thì sao? Retry từ state nào? Ai được claim job khi 2 tick chạy đè nhau?" |

Kỹ năng lõi của 8y+ không phải là code nhanh hơn — mà là **ba câu hỏi phản xạ** trước mọi dòng code:
1. **Cái gì hỏng thì mất gì?** (blast radius)
2. **Hai thứ chạy cùng lúc thì sao?** (concurrency)
3. **Ranh giới này ai được vượt?** (boundary/contract)

Toàn bộ giáo trình bên dưới là dạy 3 phản xạ này qua chính code của bạn.

---

## Bài 1 — Điểm mù của bạn (bằng chứng lấy từ chính repo này)

Đây không phải suy đoán — mỗi điểm mù dưới đây là một lỗ hổng **thật, đang tồn tại trong code**, thuộc đúng nhóm lỗi mà dev ít kinh nghiệm backend/hệ thống thường không nhìn thấy:

### Điểm mù 1: Kết quả bị vứt bỏ mà không ai nhận ra
`gateway/src/application/job-runner.js` gọi `await vbeeAdapter.synthesize(job)` rồi **vứt kết quả**, luôn gọi `createFakeAsset`. Code chạy, test pass, demo đẹp — nhưng đường dẫn dữ liệu thật chưa từng tồn tại.
→ **Bài học:** đọc code theo *dòng chảy dữ liệu* (data flow), không theo *dòng chảy điều khiển* (control flow). Hỏi: "giá trị này sinh ra ở đâu, chết ở đâu?"

### Điểm mù 2: Bảo mật là thứ "thêm sau" 
Gateway không có auth, không CORS, và kế hoạch ban đầu là "connect qua Tailscale" — tức mặc định tin rằng mạng riêng = an toàn. Tailnet có nhiều thiết bị; một thiết bị bị chiếm là toàn bộ gateway (và browser đang login Vbee) bị điều khiển.
→ **Bài học:** *authentication đi trước exposure*, luôn luôn. Thứ tự D.1 → D.4 trong plan 08 không phải ngẫu nhiên.

### Điểm mù 3: Filesystem không phải là nơi an toàn để "cứ ghi vào"
Ý định ban đầu: để file vào OneDrive cho tiện. Nhưng OneDrive lock file đang sync, upload file `.tmp` dở dang, và SQLite WAL cần 3 file (`.db`, `-wal`, `-shm`) nhất quán với nhau — sync từng file một sẽ phá tính nhất quán đó.
→ **Bài học:** phân biệt **storage bạn sở hữu** (local disk — được phép giả định atomic rename, lock) và **storage bạn không sở hữu** (thư mục sync, network drive — chỉ được phép copy một chiều, file bất biến).

### Điểm mù 4: "Chạy tuần tự" là ảo giác
`pickPendingJob` phải dùng `UPDATE ... WHERE status='pending'` và kiểm tra `changes===1` — vì nếu 2 tick (hoặc 2 process gateway) cùng chạy, cả hai có thể cùng claim một job. Code hiện tại làm đúng, nhưng nếu bạn không hiểu **tại sao**, bạn sẽ phá nó khi sửa.
→ **Bài học:** mọi thao tác đọc-rồi-ghi (read-then-write) đều là race condition tiềm năng. Vũ khí: atomic compare-and-swap ngay trong câu UPDATE.

### Điểm mù 5: Contract lỏng = nợ lãi kép
`FakeVbeeAdapter` trả `{adapter, ...}` trong khi design/06 định nghĩa `{provider, audioUrl, localAudioPath, ...}`. Hai shape lệch nhau tồn tại song song nhiều tháng mà không ai phát hiện — vì không có test contract nào khóa nó lại.
→ **Bài học:** contract không nằm trong file .md; contract nằm trong **test chạy được**. Doc chỉ là lời hứa, test là hợp đồng.

### Điểm mù 6 (nghi ngờ, tự kiểm chứng): Phân biệt "degraded" và "broken"
Bạn đã làm tốt phần health degraded (gateway sống khi browser chết) — nhưng câu hỏi tiếp theo của 8y+: *user nhìn vào đâu để biết PHẢI LÀM GÌ khi degraded?* Error message có actionable không ("Brave chưa chạy — chạy lệnh X") hay chỉ là `fetch failed`?
→ **Bài học:** observability không phải log nhiều, mà là log **đọc xong biết hành động gì**.

---

## Bài 2 — Các khái niệm thiết kế phải học (map thẳng vào từng phase)

Học theo thứ tự này, mỗi khái niệm gắn với phần code bạn sắp phải viết:

### Nhóm A — Cần cho Phase C (voice creation thật)

**A1. Ports & Adapters (Hexagonal Architecture)**
- Là gì: business logic (JobRunner) chỉ biết *cổng* (interface `synthesize(job) → normalized result`), không biết *thiết bị* (Vbee, fake, browser).
- Trong repo: `JobRunner → vbeeAdapter` và `BrowserService → PlaywrightCdpAdapter` chính là nó. Invariant "JobRunner không import browser" là luật hexagonal.
- Đọc: Alistair Cockburn — "Hexagonal Architecture" (bài gốc, ngắn); chương "Ports and Adapters" trong *Clean Architecture* (Robert Martin).
- Bài tập: viết `VbeePreviewAdapter` mà **không sửa một dòng nào** trong JobRunner ngoài đoạn consume result (C.5). Nếu phải sửa nhiều hơn — bạn đang rò rỉ abstraction.

**A2. State Machine tường minh**
- Là gì: `pending → typing_delay → submitting → downloading → done/failed` là một state machine; mỗi transition phải được liệt kê, mọi transition ngoài danh sách phải bị từ chối (như `retryJob` chỉ nhận từ failed/cancelled).
- Đọc: khái niệm Finite State Machine (bất kỳ giáo trình nào); bài "Designing with State Machines" — không cần library, chỉ cần bảng transition + guard.
- Bài tập: vẽ bảng transition đầy đủ cho job (state × event → state mới hoặc REJECT), rồi so với code. Chỗ nào code cho phép mà bảng không cho — đó là bug tương lai.

**A3. Concurrency căn bản: atomic claim, idempotency**
- Là gì: `UPDATE ... WHERE status='pending'` + check `changes===1` là *optimistic concurrency control*. Idempotency: chạy lại một bước 2 lần không tạo 2 kết quả (vd. `source_job_id UNIQUE` trong `audio_assets` chính là chốt idempotent).
- Đọc: *Designing Data-Intensive Applications* (Kleppmann) — chương 7 (Transactions), đây là quyển đáng đọc nhất trong toàn giáo trình.
- Bài tập: viết test P1 trong doc 09 mô phỏng 2 tick claim cùng job — tự chứng minh guard hoạt động.

**A4. Atomic file operations & the tmp-rename pattern**
- Là gì: ghi `.tmp` → `fs.rename` sang tên cuối = reader không bao giờ thấy file dở dang. Windows có bẫy riêng: rename fail EPERM/EBUSY khi antivirus/indexer đang giữ file (đây là lý do M6 tồn tại trong roadmap).
- Đọc: man page `rename(2)` (tính atomic trên cùng filesystem); bài về "crash-safe file writes".
- Bài tập: giải thích được tại sao `listAssets` phải `WHERE filename NOT LIKE '%.tmp'` — và tại sao chỉ filter thôi chưa đủ nếu crash giữa insert DB và rename (transaction + thứ tự thao tác).

**A5. Browser automation internals: CDP là gì thật sự**
- Là gì: CDP = WebSocket protocol vào browser đang chạy; Playwright `connectOverCDP` là client của protocol đó, khác hoàn toàn `playwright.launch()` (browser riêng, profile riêng, dễ dính anti-bot). Hiểu network interception (`page.on('response')`) vs DOM scraping — plan C.4 cần chọn một.
- Đọc: Chrome DevTools Protocol docs (chỉ cần trang overview + Network domain); Playwright docs mục "connect over CDP".
- Bài tập: tự chạy 4 bước debug checklist trong doc 08 C.1 bằng tay, hiểu từng lệnh làm gì.

### Nhóm B — Cần cho Phase D (tách 2 máy)

**B1. AuthN cơ bản cho API nội bộ: Bearer token, và tại sao "mạng riêng" không phải auth**
- Là gì: token tĩnh trong header là mức tối thiểu chấp nhận được cho internal API. Hiểu threat model: ai có thể gửi request tới port này? (câu trả lời đúng: mọi node trong tailnet, không chỉ bạn).
- Đọc: OWASP API Security Top 10 (chỉ cần đọc API1, API2, API5); khái niệm "zero trust networking" (mức blog post là đủ).
- Bài tập: viết được 3 dòng threat model cho gateway: tài sản gì (browser login Vbee, DB), ai với tới được (tailnet nodes), chặn bằng gì (token + bind IP cụ thể).

**B2. CORS — hiểu đúng nó bảo vệ ai**
- Là gì: CORS bảo vệ *người dùng browser* khỏi site lạ gọi API của bạn bằng cookie của họ — nó KHÔNG phải firewall, không chặn curl. Tauri webview có origin riêng (`tauri://localhost`) nên cần allow đích danh.
- Đọc: MDN "CORS" (đọc kỹ phần preflight OPTIONS — plan D.2 phải xử lý nó).
- Bài tập: trả lời không cần tra: "tại sao có token auth rồi vẫn cần CORS, và ngược lại?" (đáp: hai lớp cho hai kẻ tấn công khác nhau).

**B3. Network topology thực dụng: bind address, loopback, overlay network**
- Là gì: khác biệt giữa `127.0.0.1` (chỉ máy này), `0.0.0.0` (mọi interface — nguy hiểm), và bind đích danh Tailscale IP (chỉ tailnet). WSL2 ↔ Windows localhost forwarding là một lớp phức tạp riêng bạn đã gặp trong M2_005.
- Đọc: Tailscale docs "How Tailscale works" (bài này viết rất hay, đáng đọc trọn); ôn lại TCP bind/listen căn bản.
- Bài tập: dùng `netstat -ano` chỉ ra gateway đang listen trên interface nào, và giải thích từng dòng.

### Nhóm C — Cần cho Phase E + doc 09 (file sync + test)

**C1. Distributed file sync hazards**
- Là gì: thư mục sync (OneDrive/Dropbox/Drive) là *eventually consistent, non-transactional storage*. Luật: chỉ đặt vào đó **file bất biến, ghi một lần** (write-once immutable). Copy-after-finalize trong Phase E là áp dụng trực tiếp.
- Đọc: SQLite docs "How To Corrupt An SQLite Database File" (ngắn, kinh điển, đọc 15 phút) — mục về network filesystem.

**C2. Test seams & Dependency Injection thủ công**
- Là gì: seam = điểm bạn có thể thay hành vi mà không sửa code. Repo đã có seam mẫu: `fetchImpl` inject vào `PlaywrightCdpAdapter`. DI ở đây không cần framework — chỉ là truyền dependency qua constructor.
- Đọc: *Working Effectively with Legacy Code* (Michael Feathers) — chương về seams; đây là quyển thứ hai đáng đọc nhất.
- Bài tập: tự viết 1 test P1 trong doc 09 (job-runner state machine với in-memory SQLite) không nhìn mẫu. Nếu bạn thấy "không mock được chỗ này" — bạn vừa tìm ra chỗ thiếu seam.

**C3. Contract testing**
- Là gì: một test duy nhất khóa shape của normalized result (design/06) — chống chính xác loại drift ở Điểm mù 5.
- Bài tập: viết test `fake-vbee.test.js` assert đủ các key `{provider, requestId, audioUrl, localAudioPath, metadata}`.

### Nhóm D — Tư duy nền (học rải, không chặn phase nào)

**D1. Strangler Fig migration** — bạn đang sống trong nó (fake adapter mặc định, real adapter thêm dần). Đọc: Martin Fowler — "StranglerFigApplication" (bài ngắn).
**D2. Human-paced automation & rate limiting** — delay policy M5, jitter, backoff. Hiểu tại sao random 4-10s chứ không phải fixed 5s.
**D3. Observability tối thiểu** — mỗi lỗi log ra phải trả lời "user làm gì tiếp theo". Không cần tool, cần kỷ luật viết message.

---

## Bài 3 — Lộ trình học-bằng-làm (4 tuần, mỗi tuần một phase)

Nguyên tắc: **không học chay**. Mỗi khái niệm học ngay trước khi code phần cần nó.

### Tuần 1 — Phase C phần "khô" (không cần Vbee live)
- Học: A1 (hexagonal), A3 (atomic claim), C3 (contract).
- Làm: chuẩn hóa fake adapter theo design/06 (C.3) + viết contract test → sửa job-runner consume result (C.5) + viết test 2-tick claim → viết `finalizeFromDownload` với mock fetch (C.6).
- Thước đo: `npm run test:m2` pass với ~5 test mới do chính bạn viết.

### Tuần 2 — Phase C phần "ướt" (live session)
- Học: A5 (CDP), A2 (state machine — vẽ bảng transition trước khi đụng adapter).
- Làm: cài Playwright theo C.1, chạy đủ 4 bước debug checklist bằng tay; login Brave, dùng DevTools Network tab quan sát flow preview thật của Vbee (đây chính là việc "human-gated" — bạn tự làm luôn không cần agent); điền selector/interception vào `VbeePreviewAdapter`.
- Thước đo: acceptance C.8 — một file mp3 thật của Vbee trong Assets tab.

### Tuần 3 — Phase D
- Học: B1 → B2 → B3 (đúng thứ tự đó).
- Làm: token auth (D.1) → CORS (D.2) → UI base-url (D.3) → Tauri remote mode (D.4) → Tailscale (D.5). Viết 3 dòng threat model TRƯỚC khi mở port.
- Thước đo: acceptance D.6 + tự tấn công thử: từ máy thứ 3 trong tailnet, curl không token phải nhận 401.

### Tuần 4 — Phase E + trả nợ test
- Học: C1 (sync hazards), C2 (seams).
- Làm: OneDrive export (Phase E) + cày checklist P1 còn lại trong doc 09 (file-service transaction rollback, path traversal).
- Thước đo: definition of done trong doc 09 mục 4 (chạy 3 lần không flaky).

---

## Bài 4 — Danh sách đọc rút gọn (xếp theo ROI)

| # | Tài liệu | Vì sao | Thời lượng |
|---|---|---|---|
| 1 | *Designing Data-Intensive Applications* — Kleppmann, ch.7 | Đóng Điểm mù 4 (concurrency) vĩnh viễn | 1 chương |
| 2 | SQLite: "How To Corrupt An SQLite Database File" | Đóng Điểm mù 3, giải thích toàn bộ quyết định hybrid OneDrive | 15 phút |
| 3 | *Working Effectively with Legacy Code* — Feathers (phần seams) | Nền của toàn bộ doc 09 | 2-3 chương |
| 4 | Fowler: "StranglerFigApplication" + Cockburn: "Hexagonal Architecture" | Hai bài ngắn giải thích tại sao repo có hình dạng hiện tại | 1 giờ |
| 5 | MDN CORS + OWASP API Top 10 (API1/2/5) | Đóng Điểm mù 2 trước Phase D | 2 giờ |
| 6 | Tailscale: "How Tailscale works" | Hiểu mạng mình sắp tin tưởng | 1 giờ |
| 7 | Chrome DevTools Protocol overview + Playwright connectOverCDP docs | Phase C tuần 2 | 2 giờ |

Tổng: ~2 quyển sách đọc chọn lọc + 5 bài ngắn. Cố tình KHÔNG có: microservices, Kubernetes, event sourcing, DDD full — dự án này không cần, và học chúng lúc này là procrastination có vỏ bọc productive.

---

## Bài 5 — Bài kiểm tra cuối khóa (tự chấm)

Trả lời không nhìn tài liệu. Trả lời được 8/10 = bạn đã đạt mức "tự code plan này không cần agent":

1. Tại sao `pickPendingJob` phải kiểm tra `changes===1` thay vì SELECT rồi UPDATE?
2. Nếu process crash ngay SAU khi ghi file `.tmp` nhưng TRƯỚC khi rename — hệ thống ở trạng thái gì, và ai dọn?
3. Tại sao Phase D bắt buộc auth trước khi đổi HOST — kể một kịch bản tấn công cụ thể nếu làm ngược.
4. CORS chặn được curl không? Tại sao vẫn cần nó khi đã có Bearer token?
5. Tại sao DB không được nằm trong OneDrive nhưng file mp3 hoàn tất thì được?
6. `connectOverCDP` khác `playwright.launch()` ở điểm nào, và tại sao dự án này bắt buộc dùng cái đầu?
7. Contract test cho fake adapter chống lại loại lỗi gì mà unit test thường không bắt được?
8. JobRunner branch theo `result.audioUrl` thay vì theo `provider` — invariant nào được bảo vệ?
9. Nếu 2 máy cùng chạy gateway trỏ vào cùng 1 file DB qua thư mục sync — liệt kê 2 thứ hỏng đầu tiên.
10. Retry job từ state `done` bị từ chối — nếu cho phép thì hỏng gì? (gợi ý: `source_job_id UNIQUE`)

---

*Tài liệu này là companion của design/08 + design/09. Khi bạn học xong nhóm khái niệm nào, đánh dấu vào đây và ghi lại câu hỏi phát sinh — đó chính là nội dung buổi review tiếp theo.*
