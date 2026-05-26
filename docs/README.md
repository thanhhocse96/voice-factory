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
```

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

1. [ZeroClaw Vbee Working Spec](design/01_zeroclaw-vbee-working-spec.md)
2. [MVP Architecture](design/02_mvp-architecture.md)
3. [Phase 1 Design](design/03_phase-1-design.md)
4. [Migration Plan To Gateway Core](design/04_migration-plan-to-gateway-core.md)
5. [Critique Response And Plan Amendments](design/05_critique-response-and-plan-amendments.md)
6. [VoiceFactory Provider Adapter Contract](design/06_voicefactory-provider-adapter-contract.md)
7. [Vbee Dual Execution Workflows](design/07_vbee-dual-execution-workflows.md)

## Artifacts

1. [VoiceFactory Typography Options](artifacts/typography-options.html)
2. [Vbee Worker Routing Workflow Trial](artifacts/vbee-worker-routing-workflow.md)

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
