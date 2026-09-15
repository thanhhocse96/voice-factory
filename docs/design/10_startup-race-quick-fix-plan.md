# 10 - Startup Race Quick Fix: Start The Gateway Before Creating The Window

Trạng thái: PLAN — chưa thực thi

Bối cảnh: [M2_016](../milestones/M2_016_windows-installer-packaging-two-startup-bugs-found-fixed.md) tìm ra và sửa 2 lỗi khiến Gateway không khởi động được khi chạy qua app Tauui đã đóng gói. Sau khi sửa xong, lộ ra 1 vấn đề thứ 3, độc lập: cửa sổ app **luôn** load `http://127.0.0.1:3000` trước khi chắc chắn Gateway đã sẵn sàng, nên lần mở đầu tiên gần như luôn chớp qua trang lỗi "connection refused" của trình duyệt, dù Gateway sau đó lên đúng.

Đây là plan cho hướng **sửa nhanh** — đối lập với [11_startup-splash-screen-proper-fix-plan.md](11_startup-splash-screen-proper-fix-plan.md) (hướng làm tử tế hơn). Không thực thi plan này cho tới khi user chọn hướng.

## Vấn đề chính xác (đọc từ code thật, không suy đoán)

`src-tauri/src/lib.rs`, trong `.setup(|app| {...})`:

```rust
let target_url = remote_url.clone().unwrap_or_else(|| DEFAULT_LOCAL_URL.to_string());
WebviewWindowBuilder::new(app, "main", WebviewUrl::External(target_url.parse()?))
    .title("VoiceFactory")
    .inner_size(1180.0, 780.0)
    .min_inner_size(960.0, 640.0)
    .build()?;   // <-- cửa sổ tạo ra VÀ bắt đầu load URL ngay tại đây

let owner = app.state::<RuntimeOwner>();
if let Some(url) = remote_url {
    owner.set_remote(url);
} else {
    match gateway_lifecycle::start_gateway() {   // <-- CHỈ chạy SAU khi cửa sổ đã bắt đầu load
        Ok(snapshot) => owner.observe_start(&snapshot),
        Err(error) => owner.record_start_error(Some(error.to_string())),
    }
    let _ = gateway_lifecycle::start_browser();
}
```

`gateway_lifecycle::start_gateway()` (qua `run_lifecycle("start")`) **block đồng bộ** tới khi script `scripts/gateway-lifecycle.mjs start` tự thoát — script đó tự chờ `/health` OK tới `GATEWAY_STARTUP_TIMEOUT_MS` (mặc định 12000ms) trước khi in kết quả và thoát. Nghĩa là: cửa sổ đã thử load `127.0.0.1:3000` **trước khi Gateway kịp tồn tại**, nhận connection-refused ngay lập tức, hiển thị trang lỗi gốc của WebView2 — và không có gì tự động load lại trang sau khi `start_gateway()` cuối cùng thành công.

## Thay đổi đề xuất

Đảo thứ tự: gọi `start_gateway()`/`start_browser()` **trước**, chỉ tạo cửa sổ (và chọn URL) **sau khi** biết kết quả:

```rust
.setup(|app| {
    let remote_url = std::env::var("VOICEFACTORY_REMOTE_GATEWAY_URL")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let owner = app.state::<RuntimeOwner>();
    let target_url = if let Some(url) = remote_url.clone() {
        owner.set_remote(url.clone());
        url
        // Remote mode: không đổi hành vi - vẫn trỏ thẳng, không chờ health
        // trước (máy backend không do app này quản lý, chờ ở đây không có
        // ý nghĩa gì hơn ngoài làm chậm mở cửa sổ mà không tự sửa được gì).
    } else {
        match gateway_lifecycle::start_gateway() {
            Ok(snapshot) => owner.observe_start(&snapshot),
            Err(error) => owner.record_start_error(Some(error.to_string())),
        }
        let _ = gateway_lifecycle::start_browser();
        DEFAULT_LOCAL_URL.to_string()
    };

    WebviewWindowBuilder::new(app, "main", WebviewUrl::External(target_url.parse()?))
        .title("VoiceFactory")
        .inner_size(1180.0, 780.0)
        .min_inner_size(960.0, 640.0)
        .build()?;

    Ok(())
})
```

Điểm mấu chốt: **chỉ đổi thứ tự cho local mode.** Remote mode giữ nguyên hành vi hiện tại (trỏ thẳng luôn, không chờ) — vì app này không quản lý được máy backend từ xa, chờ ở đây không giải quyết được gì, chỉ làm cửa sổ mở chậm hơn vô ích khi máy backend thực sự có vấn đề.

## Đánh đổi (phải nói rõ, không giấu)

- **Được:** trường hợp thành công (đa số) không còn chớp trang lỗi nào cả — cửa sổ chỉ xuất hiện khi đã có gì đó đúng để hiển thị.
- **Mất:** trong lúc `start_gateway()` đang chạy (có thể tới 12s nếu máy chậm hoặc port bị chiếm phải chờ timeout), **không có cửa sổ nào hiện ra cả** — không progress bar, không gì báo "đang khởi động". Với người dùng không biết trước, cảm giác giống app bị treo/không phản hồi khi double-click icon.
- **Trường hợp lỗi thật** (Gateway không lên được, vd port bị app khác chiếm): cửa sổ vẫn được tạo sau đó, vẫn trỏ vào `127.0.0.1:3000` (lúc này thật sự chết), vẫn hiện đúng trang lỗi connection-refused như bây giờ — nhưng ít nhất KHÔNG xảy ra ở trường hợp thành công nữa, và `owner.last_start_error()` vẫn có lỗi thật để debug qua `gateway_runtime_status`.

## Phạm vi thay đổi

- **File duy nhất:** `src-tauri/src/lib.rs`, chỉ trong `.setup()`.
- Không đổi `gateway_lifecycle.rs`, không đổi `tauri.conf.json`, không đổi bất kỳ file JS/HTML nào.
- Không cần asset mới, không cần cơ chế polling/redirect nào ở phía trang web.

## Kế hoạch verify

1. `cargo check --manifest-path src-tauri/Cargo.toml` (qua WSL) — đảm bảo không lỗi biên dịch.
2. Build lại qua quy trình cross-compile đã có (`npx tauri build --target x86_64-pc-windows-gnu`).
3. Test sống, local mode: đóng hết tiến trình liên quan (`voicefactory-desktop.exe`, `node.exe`, Brave của `.local/runtime`), chạy lại `voicefactory-desktop.exe` từ đầu, đo thời gian tới khi cửa sổ xuất hiện — xác nhận cửa sổ chỉ hiện SAU khi `curl 127.0.0.1:3000/health` đã trả `ok:true` (không còn khoảng nào cửa sổ hiện mà Gateway chưa sẵn sàng).
4. Test sống, cố tình làm Gateway lỗi (vd chiếm trước port 3000 bằng tiến trình khác) — xác nhận cửa sổ vẫn xuất hiện cuối cùng (không bị treo vĩnh viễn), hiện đúng trang lỗi, và `gateway_runtime_status` qua devtools vẫn trả lỗi thật.
5. Test remote mode (`VOICEFACTORY_REMOTE_GATEWAY_URL=...`) — xác nhận hành vi không đổi so với trước (cửa sổ mở ngay, không chờ).

## Effort ước tính

Nhỏ — sửa ~15-20 dòng trong 1 file, không cấu trúc mới. Có thể xong (implement + build + test sống) trong 1 lần build (~6-13 phút chờ compile là phần tốn thời gian nhất, không phải code).
