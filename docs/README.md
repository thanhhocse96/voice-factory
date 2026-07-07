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
5. [Browser Launch (Rust/Tauri) and Gateway Connect Prep](milestones/M2_005_browser-launch-rust-and-gateway-connect-prep.md) — dedicated evidence for the plan + started Phase B (Rust browser lifecycle + Tauri commands) and gateway stubs (with verification commands, limits, next steps for full connect after Brave test).
