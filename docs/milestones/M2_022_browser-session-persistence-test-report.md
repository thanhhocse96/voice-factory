# M2_022 Browser Session Persistence — Test Report

> Milestone: M2. Slice: Tier 2 — graceful launch/close + `--restore-last-session`.
> Bản thân milestone doc: `M2_022_browser-session-persistence-tier2.md`.

## Command & Result

| Lệnh | Kết quả |
|---|---|
| `node --check scripts/browser-lifecycle.mjs` | `SYNTAX_OK` |
| `npm run test:m2` (WSL, node 24) | 24/24 pass, 0 fail, 0 skipped |
| `node scripts/browser-lifecycle.mjs close` (Brave thật đang chạy, CDP 9222) | `{"ok":true,"action":"closed"}` — CDP `Browser.close` thành công |
| `node scripts/browser-lifecycle.mjs status` sau close | `ok:false`, `portOpen:false` — browser đã tắt sạch |
| `node scripts/browser-lifecycle.mjs start` | spawn Brave với args gồm `--restore-last-session`, `action:"started"`, state `managed` pid 36588 |
| `node scripts/browser-lifecycle.mjs status` | `ok:true`, state `managed` |
| `node scripts/browser-lifecycle.mjs stop` | `closeMethod:"cdp"`, `action:"stopped"`, port đóng, state file xóa (run tiếp `status` → state null) |
| `context:check` (WSL venv, `-u`) | `OK  Context files consistent.` (EXIT=0) |

## Covered Cases

1. **Launch** — `--restore-last-session` xuất hiện trong command line thật.
2. **Graceful close qua CDP** — `Browser.close` trên browser websocket; browser
   đóng, port 9222 giải phóng, không cần force-kill.
3. **Managed stop** — stop chỉ chạy khi state `managed`; sau stop profile path
   được chờ đóng (port poll), state file bị xóa.
4. **`close` command cho browser external/remote** — không yêu cầ므로 state
   managed; trả `not_reachable` khi CDP không tới được (không đụng process).
5. **Fallback process-level** — `taskkill /PID <pid> /T` (không `/F`) / SIGTERM
   chỉ chạy khi CDP close thất bại (đọc code path; case này không kích hoạt về
   mặt live vì CDP luôn reachable).
6. **Không hồi quy** — toàn bộ module test gateway (job-runner, queue, assets,
   csv export, adapter) vẫn pass; không đổi `gateway/src/*`.

## Chưa verify (residual risk)

- **`--restore-last-session` thật sự giữ session Vbee qua restart trên homelab**
  — cần test live với 1 account Vbee (login 1 lần → close → start → không phải
  login lại). Không làm tự động vì chạm live session (human-gated theo M2).
- **Vòng `start` managed→`stop` trên Linux thuần** — chưa có máy homelab Linux
  sẵn trong phiên này; verified trên Windows (spawn brave.exe + `close` path là
  native WebSocket, độc lập nền).
- **Profile flush sau graceful close** — tin theo Chromium behavior; chưa có
  bằng chứng cookie DB thay đổi mtime sau `close`.
- **`build . --quiet` của context-mapping** treo >300s trên /mnt/d (scan `target/`
  qua 9P) — `check-consistency` pass là nguồn xác nhận context; phần build vẫn
  là rủi ro chưa chạy được trong phiên này.

## Bootstrap: Môi trường thật

Đây là máy Windows hiện mở Brave "probe" (mode `managed`, sinh 2026-09-12).
Live test đã **đóng mềm** browser probe này bằng `close` — profile tại
`.local/runtime/brave-profile` không bị xóa.

## Next action

- Human: trên homelab Linux, mở Brave kèm `--restore-last-session` (hoặc dùng
  `browser-lifecycle.mjs start` khi Windows), đóng bằng `browser-lifecycle.mjs close`;
  kiểm tra login Vbee còn sống sau 1 vòng restart.
- Quyết định Tier 3 (persistent-context rewrite) vs Tier 4 (đo TTL token) theo
  plan trong milestone doc — đề xuất đo TTL token trước (nhỏ, không rủi ro).