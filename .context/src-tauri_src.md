<!-- AUTO_START | hash: f748e666 | built: 2026-05-26T09:37 -->
# Context: `src-tauri/src`

> **[auto-generated — không sửa tay phần này]**  
> Language: `rust`  
> Source files: 3

## [auto] Tauri Commands (IPC Bridge)

Các hàm được expose ra frontend qua `invoke()`:

- **`gateway_runtime_status`**
- **`gateway_runtime_start`**
- **`gateway_runtime_stop_if_owned`**

## [auto] Public Functions

### `start_gateway` (line 42)
```rust
pub fn start_gateway() -> Result<RuntimeSnapshot, LifecycleError>
```

### `status_gateway` (line 46)
```rust
pub fn status_gateway() -> Result<RuntimeSnapshot, LifecycleError>
```

### `stop_gateway` (line 50)
```rust
pub fn stop_gateway() -> Result<RuntimeSnapshot, LifecycleError>
```

### `run` (line 71)
```rust
pub fn run()
```

## [auto] Structs

### `RuntimeSnapshot`
_derives: Debug, Clone, Serialize_

| Field | Type |
|-------|------|
| `ok` | `bool` |
| `action` | `Option<String>` |
| `url` | `String` |
| `port_open` | `Option<bool>` |
| `owned_by_shell` | `bool` |
| `degraded` | `bool` |
| `health` | `Option<Value>` |
| `state` | `Option<Value>` |
| `error` | `Option<String>` |

### `LifecycleError`
_derives: Debug, Clone, Serialize, Debug_

| Field | Type |
|-------|------|
| `message` | `String` |

## [auto] Key Imports

```
use serde::Serialize;
use serde_json::Value;
use std::env;
use std::path::PathBuf;
use std::process::Command;
use super::snapshot_from_json;
use gateway_lifecycle::RuntimeSnapshot;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use tauri::{Manager, State};
```

<!-- AUTO_END -->

<!-- MANUAL_START -->
## [manual] Design Decisions
> Tại sao module này được thiết kế như vậy? Trade-off gì đã được chọn?

Rust backend expose Tauri commands cho runtime state và gọi `scripts/gateway-lifecycle.mjs`.

State `started_by_shell` là ownership boundary để shutdown chỉ stop Gateway do shell start.

## [manual] Invariants & Constraints
> Các quy tắc KHÔNG BAO GIỜ được vi phạm khi sửa code ở đây.

Không bypass Gateway API để đọc queue/assets/audio.

Không kill external Gateway.

Port conflict phải được trả về như runtime error/degraded state, không được tự xử lý bằng kill process.

## [manual] Test Strategy
> Cách test module này: unit/integration, mock gì, test case quan trọng nhất là gì?

Unit tests nên cover JSON mapping từ lifecycle CLI sang `RuntimeSnapshot`.

Integration/manual test nên cover: absent Gateway, existing healthy Gateway, occupied non-Gateway port, shutdown ownership.

## [manual] Behavior chưa implement (TODO)
> Các behavior đã thiết kế nhưng chưa code. LLM đọc để không "sáng tác" sai hướng.

Rust/Tauri compile chưa được verify trên máy này.

Chưa có UI route riêng cho lỗi startup trước khi Gateway serve được frontend.
<!-- MANUAL_END -->
