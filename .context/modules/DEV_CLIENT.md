# Dev Client Context

<!-- AUTO_START -->
[auto] Pending context-mapping build.
<!-- AUTO_END -->

<!-- MANUAL_START -->
## [manual] Design Decisions

The dev client is a temporary browser-based control surface for validating Gateway Core before Tauri is introduced.

It must use the same public Gateway HTTP API that future UI and ZeroClaw clients use. It is not allowed to read SQLite or local audio paths directly.

The UI is intentionally plain static HTML/CSS/JavaScript served by Gateway. This avoids adding a frontend build system before the Gateway contract stabilizes.

The product direction is tabbed desktop UI:

```text
Queue  -> create and monitor jobs
Assets -> compact asset browser with selected preview
Edit   -> future sound timeline and stereo export
```

The dev client should keep light and dark themes available because long desktop sessions are expected.

The product name is VoiceFactory. UI copy should use VoiceFactory unless referring to a specific provider such as Vbee.

Typography decision: use Manrope for UI/display text and Geist Mono for timestamps, provider codes, durations, and other compact technical values. This came from the `docs/artifacts/typography-options.html` exploration.

## [manual] Invariants & Constraints

The dev client must not become the product UI.

The dev client must not introduce client-side access to local file paths, SQLite, Vbee credentials, browser CDP, or private environment values.

Audio playback must use `/api/audio/:filename`.

Queue creation must use `POST /api/queue`.

Assets must be compact by default. Full native audio players should appear only in preview/detail areas, not on every list row.

Theme preference should be local to the browser/dev client and must not require server state.

## [manual] Test Strategy

Test through the browser and through `scripts/smoke-gateway.sh`:

- load `/`
- confirm `/health` values are visible
- submit a queue job
- wait for fake worker
- confirm asset appears
- confirm audio element points to `/api/audio/:filename`
- switch light/dark theme
- select an asset and confirm preview renders only for the selected asset

## [manual] Behavior chưa implement (TODO)

Chunk splitting is not implemented here.

Voice catalog management is not implemented here. (M2_023: picker hiện tại chỉ là datalist từ `GET /api/voices` — chưa có thêm/sửa/xoá giọng, chưa preview mẫu giọng.)

Sound Editor timeline is represented as a placeholder Edit tab only.

Stereo export is represented as a disabled placeholder only.

Tauri lifecycle behavior is not implemented here.
<!-- MANUAL_END -->
