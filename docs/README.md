# Documentation Index

Docs are split into two layers:

```text
docs/design/
  01_...  # design source documents and architecture decisions

docs/milestones/
  M0_001_...  # implemented work, named after .context/MILESTONES.md

docs/artifacts/
  typography-options.html  # exploratory previews and decision artifacts
  vbee-worker-routing-workflow.md
  claude-critique-of-migration-plan.md  # new tool (Claude Critic) output — source of truth per review
  critique-prompt-tool.html  # interactive new tool for generating design critiques
```

**Note on source of truth (per task):** The documents under `ZeroClaw VBEE TTS/` (including old master specs, chat logs, vN docx, and new tool outputs like the Claude Critic + prompt tool) were read as inputs. The *docs of the new tools* (Claude Critic + response amendments, prompt tool) are treated as source of truth for architecture decisions and risk analysis — not the older documents in that folder. The numbered `docs/design/*.md` + `.context/modules/*.md` + `.context/MILESTONES.md` + `MILESTONE_ROADMAP.md` are the active controlled sources.

## Naming Rules

Design docs use numeric order:

```text
01_<name>.md
02_<name>.md
```

Milestone docs use:

```text
<milestone>_<sequence>_<name>.md
```

Example:

```text
M0_001_gateway-core-fake-end-to-end.md
```

The milestone code must match `.context/MILESTONES.md`.

## Agent Rules

When an agent completes a meaningful implementation slice, it must create or update a milestone doc.

Milestone docs must start with workflow first, then explain:

```text
what was implemented
files changed or added
design patterns used
verification commands or acceptance checks
known limits
```

After adding, moving, or renaming a docs file, update this index.

## Design Docs

1. [ZeroClaw Vbee Working Spec](design/01_zeroclaw-vbee-working-spec.md) — includes browser alternatives table (Brave headed baseline, Lightpanda as experimental CDP headless option) + notes on headed vs headless for Vbee stealth/session.
2. [MVP Architecture](design/02_mvp-architecture.md)
3. [Phase 1 Design](design/03_phase-1-design.md)
4. [Migration Plan To Gateway Core](design/04_migration-plan-to-gateway-core.md)
5. [Critique Response And Plan Amendments](design/05_critique-response-and-plan-amendments.md)
6. [VoiceFactory Provider Adapter Contract](design/06_voicefactory-provider-adapter-contract.md) — includes "Authentication and Credential Handling (Architecture Notes for Planning)" section (browser-session model, boundaries, no leak of JWT to core)
7. [Vbee Dual Execution Workflows](design/07_vbee-dual-execution-workflows.md)
8. [Usable Build and Distributed Deployment Plan](design/08_usable-build-and-distributed-deployment.md) — approved plan (2026-07-12) cho executor Sonnet: Phase C (real voice creation, Playwright approved), Phase D (Tauri remote + Tailscale + token auth/CORS), Phase E (OneDrive hybrid export), Phase F (Sound Editor extension point). Kèm PM risk assessment.
9. [Test Suite Plan](design/09_test-suite-plan.md) — kế hoạch cho test agent độc lập: behavior checklist P1-P3 (job-runner, queue-service, file-service, routes, sqlite), seams/fixtures (in-memory DB, adapter contract design/06, recorder frames), node --test only.
10. [Startup Race Quick Fix Plan](design/10_startup-race-quick-fix-plan.md) — PLAN, chưa thực thi. Hướng sửa nhanh cho lỗi race điều kiện ở M2_016 (cửa sổ Tauri load Gateway URL trước khi Gateway sẵn sàng): đảo thứ tự trong lib.rs's setup() — chỉ tạo cửa sổ sau khi start_gateway() xong. Đổi trong 1 file, ~15-20 dòng; đánh đổi: cửa sổ không hiện gì trong lúc chờ (tới 12s).
11. [Startup Splash Screen Proper Fix Plan](design/11_startup-splash-screen-proper-fix-plan.md) — PLAN, chưa thực thi. Hướng làm tử tế cho cùng vấn đề: trang splash.html nhúng sẵn (không phụ thuộc Gateway) poll gateway_runtime_status (lệnh Tauri có sẵn) rồi tự điều hướng sang UI thật khi sẵn sàng, có xử lý lỗi/nút thử lại. Cần đổi setup() sang chạy start_gateway() trên thread nền (không block cửa sổ) — việc lớn hơn plan 10 đáng kể, effort ước tính vài giờ.

## Learning

1. [Solo Dev Curriculum](learning/SOLO_DEV_CURRICULUM.md) — giáo trình tự code plan 08/09 không cần agent: điểm mù (evidence-based từ repo), khái niệm thiết kế theo phase, lộ trình 4 tuần, danh sách đọc, bài kiểm tra cuối khóa.

## Artifacts

1. [VoiceFactory Typography Options](artifacts/typography-options.html)
2. [Vbee Worker Routing Workflow Trial](artifacts/vbee-worker-routing-workflow.md)
3. [Claude Critique of Migration Plan](artifacts/claude-critique-of-migration-plan.md) — source of truth output from new critique tool (see also `ZeroClaw VBEE TTS/` historical drop)
4. [Critique Prompt Tool](artifacts/critique-prompt-tool.html) — the interactive new tool used to generate structured design reviews for the migration plan

## Implemented Milestone Docs

### M0 - Gateway Core Fake End-to-End

1. [Gateway Core Fake End-to-End](milestones/M0_001_gateway-core-fake-end-to-end.md)
2. [Dev Client Gateway Validation](milestones/M0_002_dev-client-gateway-validation.md)
3. [Dev Runtime Scripts](milestones/M0_003_dev-runtime-scripts.md)

### M1 - Tauri Gateway Lifecycle

1. [Gateway Lifecycle CLI](milestones/M1_001_gateway-lifecycle-cli.md)
2. [Gateway Lifecycle Test Report](milestones/M1_002_gateway-lifecycle-test-report.md)
3. [Desktop UI Tabs And Theme Direction](milestones/M1_003_desktop-ui-tabs-and-theme-direction.md)
4. [VoiceFactory Rename And Provider Scope](milestones/M1_004_voicefactory-rename-and-provider-scope.md)
5. [Tauri Gateway Lifecycle Shell](milestones/M1_005_tauri-gateway-lifecycle-shell.md)
6. [Tauri Gateway Lifecycle Test Report](milestones/M1_006_tauri-gateway-lifecycle-test-report.md)

### M2 - Browser CDP Health And Vbee Preview Harness

1. [Browser CDP Health And Preview Harness](milestones/M2_001_browser-cdp-health-and-preview-harness.md)
2. [Browser CDP Health Test Report](milestones/M2_002_browser-cdp-health-test-report.md)
3. [Docs Sync & Update from ZeroClaw VBEE TTS (New Tools Source of Truth)](milestones/M2_003_docs-sync-update-from-zeroclaw-vbee-tts-new-tools.md) — includes follow-ups on auth/credentials architecture and parallel work opportunities while manual Brave testing (M2 browser CDP + preview harness)
4. [Architecture Clarifications, Browser Options and Parallel Planning Documentation](milestones/M2_004_architecture-clarifications-parallel-planning.md) — documents JWT/credential model (encapsulated in adapters), Brave baseline vs Lightpanda experimental, and safe parallel tasks while testing Brave (per Phase 4A migration plan). Includes implementation plan and Phase B started: Rust Tauri browser launch (browser-lifecycle.mjs + Rust commands + cargo check passed) + gateway connect stubs in browser adapter/service (prep for full "kết nối", with playwright flag).
5. [Browser Launch (Rust/Tauri) and Gateway Connect Prep](milestones/M2_005_browser-launch-rust-and-gateway-connect-prep.md) — dedicated evidence for the plan + started Phase B (Rust browser lifecycle + Tauri commands) and gateway stubs (with verification commands, limits, next steps for full connect after Brave test). Includes detailed test results section (unit tests pass, simulated gateway health, script runs, WSL control notes).
6. [Project Feasibility Assessment](milestones/M2_006_project-feasibility-assessment.md) — đánh giá khả thi so với design + code reality (2026-08-12): skeleton M0–M2 đã chạy; MVP một máy + audio Vbee thật là khả thi; editor / multi-provider / 2 máy không nên làm trước cut line.
7. [Phase C: Real Vbee Adapter Wiring (Code-Only Slice)](milestones/M2_007_phase-c-real-vbee-adapter-wiring.md) — implements design/08 C.2–C.7: normalized FakeVbeeAdapter contract, FileService.finalizeFromDownload, JobRunner bug fix (discarded result + no failed-status path), PlaywrightCdpAdapter nav fallback, new VbeePreviewAdapter skeleton with HUMAN-GATED steps, adapter wiring. Fixes a latent test:m2 shell-glob bug (5→23 tests). Live-verified both fake and vbee-preview paths end-to-end. VbeePreviewAdapter's real selectors/token/audio-capture logic remain blocked on a live Vbee session (next action).
8. [Phase C: Live Vbee Session — HUMAN-GATED Steps Resolved](milestones/M2_008_phase-c-live-vbee-session-human-gated-resolution.md) — resolves all 5 HUMAN-GATED steps from a live, human-supervised studio.vbee.vn session: real Draft.js editor/button selectors, httpOnly-cookie session check, and a WebSocket-protocol capturePreviewAudioUrl (audio_link ships inside the SYNTHESIS SUCCESS frame itself). Corrects preview-recorder.js's expected frame sequence from live evidence. Documents a mid-session token-leak-and-fix in the discovery tooling. 31/31 tests pass; real end-to-end run still blocked on a WSL↔Windows CDP networking gap (next action).
9. [Phase C: DOM Automation Blocked — Diagnostics And Pivot To Direct API](milestones/M2_009_dom-automation-blocked-pivot-to-direct-api.md) — disproves M2_008's free-preview rate-limit theory via live diagnostics: 7 programmatic text-injection methods (keystroke, no-delete retype, clipboard paste, execCommand, raw CDP Input.insertText x2, single-char append) all fail identically (zero network requests, #try-listening stays disabled) while the user's own manual typing works twice in the same session — corrected conclusion is Vbee's own change-detection resisting automation, not a quota. Documents the resulting pivot toward calling the synthesis WebSocket directly with the bearer token confined to browser page-context via addInitScript()/page.evaluate() (feasibility confirmed by find-token-source.mjs); the full prototype (test-direct-api.mjs) is built but unverified, blocked on a user decision to run it past Claude Code's safety classifier. Flags adapter-integration shape and a design/06 credential-stance update as undecided follow-ups. **Superseded in part by M2_010: the real mechanism was a text-selection gate, not change-detection resistance.**
10. [Phase C: Selection-Gated Preview Confirmed — Real End-to-End Vbee Audio](milestones/M2_010_selection-gated-preview-confirmed-real-e2e-audio.md) — confirms live that #try-listening is gated on the editor having an active text selection, not on change-detection (correcting M2_009): adding one Control+A before the click, per the user's own hypothesis, makes every previously-"resistant" injection method work. Ships the fix in defaultTriggerPreview (33/33 tests pass) and runs the real production Gateway end-to-end for the first time — POST /api/queue through to a real, verified .mp3 via VBEE_ADAPTER=vbee-preview — closing out design/08 C.8's core acceptance path and mooting M2_009's direct-API pivot. Also confirms audio_link is fetchable cookie-less (closes a M2_008 unknown). Surfaces and honestly documents an unresolved second problem: back-to-back jobs in one browser tab hit residual UI (a leftover player, a "restore content?" dialog) that breaks the next job; two fix attempts (forced reload, networkidle wait) each failed differently and were reverted rather than shipped unverified. **Restore-dialog piece fixed in M2_011.**
11. [Phase C: Restore-Dialog Fix — Back-To-Back Jobs Confirmed Live](milestones/M2_011_restore-dialog-fix-and-back-to-back-jobs-confirmed.md) — wires in the restore-content dialog's real selector (data-id="reload-prev-session", supplied by the user from live DevTools inspection) into ensureStudioPage. Finds and fixes a genuine timing race in the first attempt: two independent fixed-window waits (5s dialog, 10s button) can each individually miss a dialog that renders several seconds after reload()'s load event — replaced with a single poll loop watching both signals together (35/35 tests pass). Also hardens extractSessionToken to wait rather than snapshot-check. Confirms live for the first time that two real jobs can run back-to-back through the actual Gateway with zero manual intervention — the thing M2_010 could not yet claim. Narrow-window mobile-redirect risk remains open and unaffected.
12. [Phase C: Pre-Reload Editor Clear — Hypothesis Tested And Disproven](milestones/M2_012_pre-reload-editor-clear-hypothesis-tested-and-disproven.md) — implements the user's proposal to clear the editor's text right before reload, on the theory that an empty editor leaves the restore-content dialog nothing to offer (37/37 tests pass; two more real back-to-back jobs succeed). Adds temporary diagnostic logging to test the mechanism directly rather than trusting job-level success alone — live evidence shows the dialog **still appears** immediately after the clear runs successfully, disproving the theory (most likely Vbee's autosave already persisted the draft earlier, during the previous job's typing, well before this runs). Keeps the harmless clear step but corrects the comment to state this honestly; M2_011's polling+click fix remains the actual reliability mechanism, unchanged.
13. [Phase D: Two-Machine Split — Token Auth, CORS, UI Settings, Tauri Remote Mode](milestones/M2_013_phase-d-two-machine-split-token-auth-cors-tauri-remote-mode.md) — implements design/08's Phase D (D.1-D.4): `GATEWAY_AUTH_TOKEN` bearer auth and `CORS_ORIGIN` support in the Gateway (config.js/routes.js, 46/46 tests pass, plus live curl-equivalent verification of all 5 auth/CORS scenarios against the real running Gateway), a new Connection-settings UI panel wiring gatewayBaseUrl/token through apiFetch() and a ?token= fallback for `<audio src>` (verified live in-browser), and Tauri "remote mode" — fixing an undocumented gap where the window's URL was hardcoded in tauri.conf.json, now built dynamically in Rust, with all 6 runtime commands branching to a new status_remote() when VOICEFACTORY_REMOTE_GATEWAY_URL is set (cargo check clean, 6/6 Rust tests pass). Known limit: no Windows-native Rust toolchain was available to actually launch the Tauri GUI or test across a real second machine/Tailscale — both remain open follow-ups.
14. [Voice & Speed Selection: Investigation Findings, Deferred By Decision](milestones/M2_014_voice-speed-selection-investigation-deferred.md) — investigates a real gap the user flagged: VbeePreviewAdapter never actually selects voice or speed, jobs just use whatever is already active in the shared browser. Finds real selectors for both controls live (`[data-id="open-voice-list"]` for voice, `[data-id="open-punct-duration"]` for speed — a completely separate dialog, confirmed via its "Tốc độ đọc" field matching this project's own 1.05x default) but hits two genuine blockers: no stable code-to-row mapping exists for voice in the DOM (display name only), and the speed field's own click is reproducibly intercepted by its dialog, unexplained. Also finds and works around an unrelated stray invisible backdrop blocking clicks page-wide. Per the user's decision, both are deferred — ship the already-proven content-generation path first, revisit voice/speed later via a possible direct-API approach rather than forcing fragile DOM automation now. No adapter code changed this slice.
15. [Preserve Vbee's Own Filename When Finalizing A Downloaded Asset](milestones/M2_015_preserve-vbee-audio-filename-on-download.md) — the user asked why a saved asset's filename didn't match Vbee's own name for the same audio; traced it to `FileService.finalizeFromDownload` discarding `result.audioUrl`'s basename (which really is Vbee's real `audio_link`, confirmed since M2_010) in favor of an invented `timestamp-jobId` name inherited unchanged from the original fake-adapter design. New `filenameFromResult()` now prefers the provider's own basename verbatim (per the user's explicit choice, over a timestamp-prefixed hybrid), falling back to the old scheme only when no safe filename-shaped basename exists. 52/52 unit tests pass; live-verified against the real running Gateway (`VBEE_ADAPTER=vbee-preview`) — a real job saved as `kiem_tra_ten_file_audio_lay_tu_vbee_2253bd74-...mp3`, byte-confirmed on disk. Known limit: filenames are no longer DB-uniqueness-guaranteed (no `UNIQUE` constraint on `filename`), an accepted small risk since Vbee already appends its own per-request UUID to every name.
16. [Windows Installer Packaging: Cross-Compile, Two Startup Bugs Found And Fixed](milestones/M2_016_windows-installer-packaging-two-startup-bugs-found-fixed.md) — first time the Tauri desktop shell actually ran on Windows in this project's history, via cross-compiling `x86_64-pc-windows-gnu` from the WSL Rust toolchain (mingw-w64 + NSIS/makensis) rather than installing a Windows-native toolchain, per the user's own correction that a second Rust install was redundant. Enabled `bundle.active`/resources/icon in tauri.conf.json (regenerating a corrupt placeholder icon via hand-built PNG bytes). Found and fixed two real, pre-existing bugs live: `project_root()`'s release-mode path resolution (compile-time `CARGO_MANIFEST_DIR` is meaningless off the build machine; fixed to check both possible runtime resource layouts) and `scripts/gateway-lifecycle.mjs` spawning `npm` with `shell:false` (silently no-ops on Windows, since `npm` resolves to `npm.cmd`; fixed to spawn `process.execPath` directly). Live-verified: `GET /health` → `ok:true`, `browserCdp:"available"`. Surfaces a third, unfixed issue (a real startup race between window creation and Gateway readiness) — deferred to two alternative follow-up plans (design/10 quick fix, design/11 proper splash-screen fix) rather than guessing at an implementation.
17. [`public/` Never Bundled (Bug 4), Then A Reproducible Cross-Compile Build Failure](milestones/M2_018_public-dir-unbundled-and-resource-lib-permission-denied.md) — **VERIFIED**. Finds the real cause of the recurring `{"ok":false,"error":"not found"}` the user kept seeing: `public/` (the entire frontend) was never added to `bundle.resources`, so `GET /` itself 404'd this whole time — every prior round of verification only checked `/health`, never the actual page. Fixed in config. The from-source rebuild meant to bake this in properly then hit a separate, reproducible `Permission denied (os error 13)` writing `resource.lib`, four times in a row, surviving process cleanup, direct file deletion, and a full intermediate-build-cache wipe — leading (unconfirmed) suspect is Windows Defender real-time scanning a freshly-written build artifact on the Windows-mounted drive. Mitigation: build from WSL's own native filesystem (`~/vf-build-tmp`) instead of `/mnt/d/...`, avoiding any change to security settings — succeeded on the first attempt, copied back into the repo's normal build path, and live-verified for real this time: `GET /`, `/dev/app.js`, `/dev/styles.css` all `200`, `/health` → `ok:true`.
