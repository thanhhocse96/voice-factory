<!-- AUTO_START | hash: deb00c57 | built: 2026-05-26T09:37 -->
# Context: `src-tauri`

> **[auto-generated — không sửa tay phần này]**  
> Language: `rust`  
> Source files: 1

<!-- AUTO_END -->

<!-- MANUAL_START -->
## [manual] Design Decisions
> Tại sao module này được thiết kế như vậy? Trade-off gì đã được chọn?

Tauri shell là lớp desktop mỏng cho M1. Shell dùng Gateway lifecycle CLI đã được test thay vì tự viết lại policy trong Rust.

Tauri config trỏ cửa sổ desktop về Gateway dev URL để UI tiếp tục dùng Gateway HTTP API.

## [manual] Invariants & Constraints
> Các quy tắc KHÔNG BAO GIỜ được vi phạm khi sửa code ở đây.

Shell không được đọc hoặc ghi SQLite trực tiếp.

Shell không được kill Gateway nếu Gateway không do shell start.

Không thêm install/dependency runtime mới mà chưa có approval.

## [manual] Test Strategy
> Cách test module này: unit/integration, mock gì, test case quan trọng nhất là gì?

Khi Rust/Tauri toolchain có sẵn, chạy `cargo test --manifest-path src-tauri/Cargo.toml` và `npm run desktop:dev`.

Luôn chạy lifecycle smoke CLI vì shell gọi lại CLI này.

## [manual] Behavior chưa implement (TODO)
> Các behavior đã thiết kế nhưng chưa code. LLM đọc để không "sáng tác" sai hướng.

Chưa có product frontend riêng cho Tauri.

Chưa có restart-on-crash trong shell.

Chưa verify compile vì local Rust toolchain đang thiếu.
<!-- MANUAL_END -->
