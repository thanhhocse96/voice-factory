# Milestones

Current: M2 - Browser CDP Health And Vbee Preview Harness

Detailed roadmap source: `.context/MILESTONE_ROADMAP.md`.

This file is the active milestone pointer. Load only the current milestone in full. Promote one future milestone at a time from `.context/MILESTONE_ROADMAP.md`.

## Completed: M0 - Gateway Core Fake End-to-End

Goal: turn the project from architecture documents into a runnable local Gateway skeleton.

Acceptance:

- [x] `GET /health` returns Gateway, DB, worker, and degraded status.
- [x] `POST /api/queue` creates a pending job.
- [x] Fake worker processes pending job into an audio asset.
- [x] `GET /api/assets` lists finalized assets only.
- [x] `GET /api/audio/:filename` serves finalized audio.
- [x] Context-mapping protocol is present in `AGENTS.md` and `.context/`.
- [x] Static dev client can add a queue job and play assets through Gateway HTTP.
- [x] Implemented M0 work is documented in `docs/milestones/M0_*.md`.

Out of scope:

- Real Vbee BrowserSessionAdapter.
- Official Vbee API adapter.
- Tauri packaging.
- Podman as default runtime.
- Sound Editor timeline.

## Completed: M1 - Tauri Gateway Lifecycle

Goal: Tauri starts/checks/polls Gateway and shows degraded runtime state.

Acceptance:

- [x] Lifecycle command can report Gateway status.
- [x] Lifecycle command starts Gateway if it is not running.
- [x] Lifecycle command detects a healthy existing Gateway without spawning a duplicate.
- [x] Lifecycle command refuses to own/stop a Gateway it did not start.
- [x] Port occupied but `/health` unavailable is reported as actionable conflict.
- [x] M1 lifecycle CLI work is documented in `docs/milestones/M1_*.md`.
- [x] M1 lifecycle CLI has a module test report.
- [x] Desktop UI direction documents Queue/Assets/Edit tabs and light/dark mode.
- [x] Product name and provider-extension scope are documented as VoiceFactory.
- [x] Tauri shell calls or ports the lifecycle behavior.

## Next: M2 - Browser CDP and Vbee Preview

Superseded by current M2 below.

## Current: M2 - Browser CDP Health And Vbee Preview Harness

Goal: add a BrowserService boundary, CDP health reporting, and a Vbee preview protocol harness without making real Vbee mandatory for dev/test.

Source docs:

```text
docs/design/04_migration-plan-to-gateway-core.md
docs/design/07_vbee-dual-execution-workflows.md
.context/modules/TTS_PROVIDER_ADAPTERS.md
.context/MILESTONE_ROADMAP.md
```

Acceptance:

- [x] `BrowserService` exists behind an adapter contract.
- [x] `PlaywrightCdpAdapter` or equivalent CDP adapter can healthcheck configured CDP URL.
- [x] `/health` reports Browser CDP available/unavailable without crashing Gateway.
- [x] JobRunner does not import browser automation directly.
- [x] Vbee preview protocol recorder/harness exists for debug/test mode.
- [x] Recorder can represent expected preview sequence, including `GET_REMAINING_PREVIEW`.
- [x] Fake provider remains the default test path.
- [x] M2 milestone doc and test report are created.

Out of scope:

- Full official Vbee download flow.
- Provider account credential storage.
- Replacing fake adapter.
- Sound editor timeline.

Ask human before coding if:

- The expected browser target is unclear.
- The recorder must touch a live authenticated Vbee session.
- CDP adapter requires installing browsers or Playwright packages.

## Next: M3 - Provider Registry And Execution Mode Routing

Goal: persist provider/execution mode choices and route jobs through provider contracts instead of JobRunner branches.
