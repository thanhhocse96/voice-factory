# 11 - Startup Splash Screen: Native Loading State Independent Of The Gateway

Trạng thái: PLAN — chưa thực thi

Bối cảnh: xem [10_startup-race-quick-fix-plan.md](10_startup-race-quick-fix-plan.md) cho mô tả đầy đủ vấn đề gốc (cửa sổ Tauri load `127.0.0.1:3000` trước khi chắc Gateway đã sẵn sàng, chớp trang lỗi connection-refused). Đây là hướng **làm tử tế** — thay vì chỉ né lỗi, cho người dùng thấy trạng thái thật (đang khởi động / lỗi thật / thử lại) ngay từ khi mở app, giống các app "vỏ native bọc server local" đúng chuẩn (Docker Desktop và tương tự). Không thực thi plan này cho tới khi user chọn hướng — và không làm song song với plan 10, hai plan là 2 lựa chọn loại trừ nhau cho cùng 1 vấn đề.

## Vì sao plan 10 (đổi thứ tự) không đủ

Plan 10 chỉ đổi lúc nào cửa sổ xuất hiện — không giải quyết việc **trong lúc chờ, người dùng không thấy gì cả** (không phân biệt được "đang khởi động" với "app bị treo"). Với máy chậm hoặc lần đầu Brave phải khởi tạo profile mới, khoảng chờ có thể gần chạm mốc 12s timeout — im lặng hoàn toàn trong 12 giây là trải nghiệm tệ, dù không còn lỗi.

## Kiến trúc đề xuất

```
Mở app
  → Cửa sổ hiện NGAY LẬP TỨC, load public/splash.html
    (nhúng sẵn trong app qua frontendDist - KHÔNG phụ thuộc Gateway)
  → Đồng thời (nền, KHÔNG chặn cửa sổ): start_gateway() + start_browser()
  → splash.html tự poll lệnh Tauri có sẵn gateway_runtime_status()
    mỗi ~700ms
  → Khi status.ok === true: window.location.href = status.url
    (điều hướng bình thường sang UI thật - KHÔNG cần API Tauri gì thêm)
  → Nếu quá ~15s vẫn chưa ok: hiện thông báo lỗi thật (status.error)
    + nút "Thử lại" gọi lệnh gateway_runtime_start() có sẵn
```

Điểm quan trọng nhất: **`gateway_runtime_status` và `gateway_runtime_start` đã tồn tại sẵn** ([lib.rs:60-70](../../src-tauri/src/lib.rs), đã đăng ký trong `invoke_handler`), và `withGlobalTauri: true` đã bật sẵn trong `tauri.conf.json` — `window.__TAURI__.core.invoke(...)` gọi được ngay từ trang splash mà không cần thêm API Rust nào mới. Cơ chế polling này cũng đã có tiền lệ trong chính `public/app.js`'s `refreshDesktopRuntime()` — splash.html chỉ là dùng lại đúng cơ chế đó, sớm hơn, trước khi có Gateway.

**Hoạt động đúng cho cả 2 chế độ (local lẫn remote) mà không cần splash.html biết đang ở chế độ nào** — vì `gateway_runtime_status` đã tự trả đúng `url` cho từng trường hợp (`status_remote()` cho remote mode, health check thật cho local mode). Splash chỉ cần: hỏi status, có `url` thì điều hướng tới đó.

## Thay đổi cần làm (rộng hơn plan 10 đáng kể)

### 1. File mới: `public/splash.html`

Trang HTML tự chứa hoàn toàn (inline hết CSS/JS) — **không được** load `/dev/styles.css` hay `/dev/app.js` (2 file đó do chính Gateway phục vụ, dùng chúng ở đây là tự phá mục đích "không phụ thuộc Gateway"). Nội dung: logo/tên app, spinner đơn giản, dòng trạng thái text, khu vực lỗi ẩn sẵn (hiện khi timeout) kèm nút "Thử lại".

### 2. `src-tauri/tauri.conf.json`

Không cần đổi `frontendDist` (đã là `"../public"` sẵn) — `splash.html` chỉ cần nằm trong `public/` là được nhúng vào bundle tự động.

### 3. `src-tauri/src/lib.rs` — thay đổi cấu trúc, không chỉ thứ tự

```rust
.setup(|app| {
    let remote_url = /* giữ nguyên logic đọc VOICEFACTORY_REMOTE_GATEWAY_URL */;

    // Cửa sổ luôn mở NGAY vào splash - không chờ gì cả.
    WebviewWindowBuilder::new(app, "main", WebviewUrl::App("splash.html".into()))
        .title("VoiceFactory")
        .inner_size(1180.0, 780.0)
        .min_inner_size(960.0, 640.0)
        .build()?;

    let owner = app.state::<RuntimeOwner>().inner().clone(); // cần RuntimeOwner Clone-able qua Arc, xem mục 4
    if let Some(url) = remote_url {
        owner.set_remote(url);
        // Remote mode: không có gì để "start" cục bộ - splash vẫn poll
        // status bình thường, status_remote() đã tự trả kết quả đúng.
    } else {
        // QUAN TRỌNG: phải chạy trên thread riêng, KHÔNG block setup().
        // start_gateway() hiện là lệnh đồng bộ (chờ tới 12s) - nếu gọi
        // thẳng trong setup() như code cũ, cửa sổ (kể cả splash) có thể
        // bị treo/không vẽ được trong lúc đó, y hệt vấn đề đang sửa.
        std::thread::spawn(move || {
            match gateway_lifecycle::start_gateway() {
                Ok(snapshot) => owner.observe_start(&snapshot),
                Err(error) => owner.record_start_error(Some(error.to_string())),
            }
            let _ = gateway_lifecycle::start_browser();
        });
    }
    Ok(())
})
```

### 4. `RuntimeOwner` cần chia sẻ được qua thread nền

`RuntimeOwner` hiện được Tauri quản lý qua `app.state::<RuntimeOwner>()` (một `State` guard gắn với lifetime của app, không tự nhiên `move` được vào `std::thread::spawn`). Cách làm chuẩn Tauri: lấy `AppHandle` (là `Clone`, `'static`) thay vì giữ `State` trực tiếp, rồi trong thread nền gọi lại `app_handle.state::<RuntimeOwner>()` khi cần — không cần đổi cấu trúc `RuntimeOwner` bản thân nó (các field bên trong đã dùng `Mutex`/`AtomicBool`, vốn đã thread-safe sẵn từ trước, không phải sửa gì thêm ở đó).

### 5. Guard tránh double-start khi bấm "Thử lại"

`gateway_runtime_start` hiện gọi thẳng `gateway_lifecycle::start_gateway()` mỗi lần — nếu splash gọi "Thử lại" trong lúc thread nền ở bước khởi động đầu vẫn đang chạy, có thể chạy trùng. Cần 1 cờ trạng thái đơn giản (`AtomicBool` mới trong `RuntimeOwner`, vd `starting`) để lệnh `start` tự bỏ qua nếu đã có 1 lần đang chạy dở, thay vì chạy chồng.

## Đánh đổi (so với plan 10)

- **Được:** trải nghiệm đúng chuẩn — cửa sổ hiện ngay, luôn có phản hồi thị giác, lỗi thật có nút thử lại thay vì phải tắt mở lại app.
- **Mất:** việc thật sự lớn hơn — 1 file HTML mới, đổi cấu trúc threading của `setup()` (không chỉ đổi thứ tự gọi), thêm 1 field trạng thái, cần viết + test kỹ hơn nhiều so với plan 10.
- **Rủi ro kỹ thuật chưa kiểm chứng:** `WebviewUrl::App(...)` cho 1 trang khác ngoài trang chính chưa từng dùng trong dự án này — cần thử thật mới biết có vướng gì với `frontendDist`/đường dẫn asset hay không (lý thuyết đúng theo tài liệu Tauri v2, chưa live-verify).

## Kế hoạch verify

1. `cargo check` qua WSL, rồi build cross-compile như thường lệ.
2. Test sống: đóng hết tiến trình liên quan, mở `voicefactory-desktop.exe`, đo bằng mắt — cửa sổ phải hiện tức thì (không delay), thấy spinner/trạng thái, rồi tự chuyển sang UI thật khi Gateway lên xong — không có khoảng nào cửa sổ trắng/treo.
3. Test lỗi thật: chiếm trước port 3000, mở app — phải thấy thông báo lỗi thật trong splash (không phải trang lỗi trình duyệt), bấm "Thử lại" sau khi giải phóng port phải khởi động được, không cần tắt mở lại app.
4. Test remote mode: xác nhận splash vẫn hoạt động đúng (poll → điều hướng sang URL backend từ xa) mà không cần sửa gì thêm cho nhánh này.
5. Test bấm "Thử lại" nhiều lần liên tiếp khi đang trong lúc chờ lần đầu — xác nhận không có 2 tiến trình Gateway bị spawn chồng nhau.

## Effort ước tính

Lớn hơn plan 10 đáng kể — ước chừng vài giờ làm thật (không tính thời gian build/test sống, vốn đã chậm sẵn do cross-compile ~6-13 phút/lần). Nên làm khi đã chắc đây là hướng muốn đi tiếp, không làm thử nửa vời.
