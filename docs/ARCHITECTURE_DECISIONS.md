# Architecture Decision Log (ADL)

**Purpose:** Record key architectural decisions, their rationale, and status.  
**Format:** ADL entries with date, decision, rationale, and status.  
**Updated:** 2026-07-12  

---

## ADL-001: Gateway Core Pattern (Strangler Migration)

**Date:** 2026-05-25 (design/01-04)  
**Decision:** Migrate from direct ZeroClaw → Vbee to centralized Gateway Core using strangler pattern.

**Rationale:**
- Direct click/type automation via ZeroClaw is brittle (locator changes, timing issues)
- Central Gateway Core allows:
  - Single source of truth for job queue
  - Pluggable browser adapters (Brave, Chromium, Camoufox, etc.)
  - Decoupled UI/ZeroClaw from browser complexity
  - Easier testing (mock gateway for UI, test adapters separately)

**Architecture:**
```
Old: ZeroClaw → Browser → Vbee
New: UI/ZeroClaw → Gateway → Adapter → Browser → Vbee
```

**Status:** ✅ Implemented (M0-M1)  
**Related:** design/04_migration-plan-to-gateway-core.md

---

## ADL-002: Adapter Pattern for Browser

**Date:** 2026-05-25  
**Decision:** Browser automation via pluggable adapters (current: Playwright CDP).

**Rationale:**
- Easy to swap implementations (Brave ↔ Chromium ↔ Camoufox)
- BrowserService doesn't know about Playwright details
- Testable: mock adapter for health checks, real adapter for automation
- Future: Patchright or headless browser can replace Playwright without touching gateway

**Pattern:**
```javascript
class BrowserAdapter {
  isAvailable() { }     // Health check
  async connect() { }   // Full connection (M3+)
  async withPage(cb) {} // Run code in browser context
  async close() { }     // Cleanup
}
```

**Status:** ✅ Implemented (M2 stubs for connect/withPage)  
**Related:** design/02_mvp-architecture.md Section 3, design/06

---

## ADL-003: Brave Headed Browser with Real Session

**Date:** 2026-05-25  
**Decision:** Use Brave headed browser with real user profile (not headless, not incognito).

**Rationale:**
- Vbee detects automation (kills browser if headless/incognito detected)
- Real session + cookies = user doesn't need to re-login every job
- Real fingerprint = less likely to trigger anti-bot
- Trade-off: User must login manually once, then session is persistent

**Tradeoffs:**
| Pro | Con |
|-----|-----|
| Real session/login | Manual login first time |
| Avoids anti-bot | GUI visible (not pure background job) |
| Less flaky | Profile storage needed |

**Fallback:** Manual Brave start on Windows, Node script connects via CDP (if auto-launch flaky)

**Status:** ✅ Implemented (browser-lifecycle.mjs + M2_005)  
**Related:** design/01 Section 2, M2_005 WSL/Windows notes

---

## ADL-004: CDP (Chrome DevTools Protocol) for Health + Automation

**Date:** 2026-05-25  
**Decision:** Use Chrome DevTools Protocol (port 9222) for both health checks and full automation.

**Rationale:**
- CDP is standard + stable (works across Brave, Chrome, Chromium)
- Health check: `GET /json/version` (lightweight, no auth)
- Full automation: Playwright `connectOverCDP()` after `npm install playwright`
- Decouples browser launch from automation logic

**Why not WebDriver?**
- WebDriver requires browser restart with specific flags
- CDP is simpler for already-running browser

**Why not direct Playwright launch?**
- User may want to manually manage browser (login, debugging)
- CDP allows browser lifecycle outside Node.js

**Status:** ✅ Implemented (health checks in M2)  
**Next:** Full automation in M3 (Phase C)  
**Related:** design/01 Section 2, M2_005

---

## ADL-005: SQLite WAL Mode + Gateway Single Writer

**Date:** 2026-05-25  
**Decision:** Gateway is the only process that writes to SQLite (WAL mode for concurrent reads).

**Rationale:**
- Prevents data corruption from concurrent writes
- WAL mode allows UI/Tauri to read health status without blocking
- Simpler than distributed locks
- SQLite handles WAL cleanup automatically

**Pattern:**
```
UI → reads via HTTP → Gateway reads DB → sends JSON response
ZeroClaw → writes via HTTP → Gateway writes DB (only writer)
Worker → reads from DB (via Gateway) → writes state (via Gateway)
```

**Status:** ✅ Implemented (M0-M1)  
**Related:** M0_001 (gateway-core-fake-end-to-end.md)

---

## ADL-006: Audio Assets Table (Not tts_queue)

**Date:** 2026-05-25  
**Decision:** `audio_assets` table is source of truth (not `tts_queue`).

**Rationale:**
- Decouples job state from file state
- Sound Editor works with audio files independently
- Legacy tts_queue kept for backward compat during migration
- Strangler pattern: gradually move jobs to audio_assets

**Schema outline:**
```sql
audio_assets (
  id PRIMARY KEY,
  text,
  voice,
  audio_file,
  metadata JSON,
  created_at
)

job_state (
  id PRIMARY KEY,
  audio_asset_id,
  status (queued/processing/done/failed),
  updated_at
)
```

**Status:** ✅ Planned (schema exists, M2 health-only)  
**Next:** Full job state machine in M3  
**Related:** design/02, M2_004

---

## ADL-007: M2 = Health Only (No Full Automation)

**Date:** 2026-06-21  
**Decision:** M2 scope limited to health checks + launch prep; full browser automation deferred to M3.

**Rationale:**
- De-risk: Verify browser launch + CDP health before complex page automation
- Staged: Health checks first (easy), then full `connectOverCDP()` (complex)
- Avoids premature playwright install (may not be needed)
- Allows parallel manual Vbee testing while gateway team preps code

**What M2 does:**
- ✅ Browser CDP health: `GET /json/version`
- ✅ Browser launch via scripts + Rust
- ✅ Adapter stubs with TODO comments
- ✅ Unit tests for health degradation

**What M2 doesn't do:**
- ❌ Full Playwright connect
- ❌ Page automation (withPage callback)
- ❌ Vbee WS protocol handling
- ❌ Job state machine

**Status:** ✅ Implemented (M2_001-M2_005)  
**Next:** M3 Phase C (full browser connect + automation)  
**Related:** M2_005, PROJECT_OVERVIEW Section 5

---

## ADL-008: Cross-platform Browser Launch (WSL + Windows)

**Date:** 2026-06-21  
**Decision:** Browser launch script supports both Windows native and WSL → Windows Brave.

**Rationale:**
- Common setup: Node.js runs in WSL (Linux), Brave on Windows GUI
- CDP accessible via localhost:9222 (WSL2 forwards to Windows)
- Single script handles both: `scripts/browser-lifecycle.mjs`
- Fallback: Manual Brave start if auto-launch flaky

**Implementation:**
```javascript
// Check platform
if (process.platform === 'win32') {
  // Windows: direct launch via powershell.exe Start-Process
} else {
  // WSL: launch Windows Brave via powershell.exe (cross-platform)
}
```

**Known issues:**
- WSL launch can be flaky (path quoting, window focus)
- Workaround: User manually start Brave, Node connects via CDP

**Status:** ✅ Implemented (browser-lifecycle.mjs in M2_005)  
**Related:** M2_005 WSL/Windows notes, design/01 start-brave.bat

---

## ADL-009: Playwright Install = User Decision (Not Default)

**Date:** 2026-06-21  
**Decision:** Playwright not installed by default; flagged for user confirmation (M3+).

**Rationale:**
- M2 doesn't need Playwright (health checks only)
- Playwright is large (~500MB), slow to install
- Not everyone may need full automation (some use API-only)
- "Ask before" matches ZeroClaw skill principle (human-in-loop)

**Implementation:**
- Health checks work without Playwright
- `gateway/src/infrastructure/browser/browser-service.js` has flag
- Stubs throw: "Not implemented in M2 (ask before Playwright install)"

**Status:** ✅ Implemented (flagged for M3)  
**Related:** M2_004, M2_005

---

## ADL-010: Tauri Rust Shell for Lifecycle Commands

**Date:** 2026-06-21  
**Decision:** Browser + Gateway lifecycle via Tauri Rust commands (thin wrapper around CLI scripts).

**Rationale:**
- Tauri UI can invoke commands without spawning subprocess
- Rust thread-safe lifecycle state management
- Easy to add desktop app integration later (taskbar, system tray)
- Follows M1 pattern (gateway-lifecycle.rs) for consistency

**Pattern:**
```rust
#[tauri::command]
async fn browser_runtime_status() -> BrowserStatus { ... }

#[tauri::command]
async fn start_browser() -> Result<()> { ... }
```

**Status:** ✅ Implemented (M2_005 src-tauri/src/gateway_lifecycle.rs)  
**Related:** M1_005, M2_005

---

## ADL-011: Milestone-based Documentation (ADR Style)

**Date:** 2026-07-12  
**Decision:** Each milestone has docs in `docs/milestones/Mx_NNN_*.md` with workflow, evidence, tests, limits.

**Rationale:**
- Clear evidence of what was done + when
- Test results + verification commands for reproducibility
- Known limits documented (no surprises for next phase)
- Workflow diagrams (mermaid) show decision flow

**Structure:**
```
M2_005_browser-launch-rust-and-gateway-connect-prep.md
├── Workflow (decision flow, what happened)
├── What Was Implemented (code changes + design patterns)
├── Files Changed or Added (git diff summary)
├── Design Patterns Used (architecture patterns applied)
├── Verification Commands (tests + checks)
├── Known Limits (scope boundaries)
├── Test Results (actual output, dates)
└── Next Action (what's blocked, what's ready)
```

**Status:** ✅ Implemented (M0-M2_005)  
**Related:** docs/README.md, .context/MILESTONES.md

---

## ADL-012: Prepare Detailed Docs for Fable (Async Handoff)

**Date:** 2026-07-12  
**Decision:** Create PROJECT_OVERVIEW.md, FABLE_QUICK_START.md, M2_COMPLETION_CHECKLIST.md for future contributor (Fable or other).

**Rationale:**
- Async collaboration: Next contributor can understand project without sync meeting
- PROJECT_OVERVIEW = complete reference (what, why, how, what's next)
- FABLE_QUICK_START = fast onboarding (5-min overview, debug tips)
- M2_COMPLETION_CHECKLIST = verification before Phase C starts
- Memory system = decisions + phase timeline preserved

**Files created:**
1. docs/PROJECT_OVERVIEW.md (15 sections, ~500 lines)
2. docs/FABLE_QUICK_START.md (quick reference)
3. docs/M2_COMPLETION_CHECKLIST.md (verification)
4. docs/ARCHITECTURE_DECISIONS.md (this file)
5. memory/project_zeroclaw_vbee.md + MEMORY.md (persist decisions)

**Status:** ✅ Implemented (2026-07-12)  
**Related:** All docs above

---

## ADL-013: Job Delay Policy (Future, M3+)

**Date:** TBD  
**Decision:** Job delay = function of word count + speaking rate (configurable policy).

**Rationale:**
- Different voices have different speeds
- Can preview or batch jobs by delay estimate
- Delay calculated by gateway (not UI), so centralizes policy
- Example: 10 words @ 1.0x speed = 5 second minimum wait

**Pattern (planned):**
```javascript
delay = (wordCount / speakingRate) * policyMultiplier;
```

**Status:** ⏳ Planned (M3)  
**Related:** design/02 worker section

---

## ADL-014: Vbee WS Protocol Recording (Future, M3+)

**Date:** TBD  
**Decision:** Preview protocol via WebSocket + Vbee protocol recorder (state machine).

**Rationale:**
- Vbee preview is WebSocket-based (INIT → accessToken → GET_REMAINING_PREVIEW → audio)
- Test harness needed before real automation
- Recorder captures state transitions (helps debug)

**Protocol (outline):**
```
WS init
  ↓ INIT (job_id)
  ↓ GET ACCESS TOKEN (response = audio_token)
  ↓ GET_REMAINING_PREVIEW (response = audio_url)
  ↓ close
  ✓ audio downloaded
```

**Status:** ⏳ Planned (M2.5-M3)  
**Related:** design/07_vbee-dual-execution-workflows.md

---

## Summary Table

| ADL | Title | Date | Status | Related Phase |
|-----|-------|------|--------|---------------|
| 001 | Gateway Core + Strangler | 2026-05-25 | ✅ Done | M0-M1 |
| 002 | Adapter Pattern | 2026-05-25 | ✅ Stubs in M2 | M2 → M3 |
| 003 | Brave Headed Browser | 2026-05-25 | ✅ M2 | M2-M5 |
| 004 | CDP for Health + Automation | 2026-05-25 | ✅ Health in M2 | M2 → M3 |
| 005 | SQLite WAL + Gateway Writer | 2026-05-25 | ✅ Done | M0+ |
| 006 | Audio Assets Table | 2026-05-25 | ✅ Planned | M3+ |
| 007 | M2 = Health Only | 2026-06-21 | ✅ Done | M2 |
| 008 | Cross-platform Launch | 2026-06-21 | ✅ M2 | M2-M5 |
| 009 | Playwright = User Decision | 2026-06-21 | ✅ Flagged | M3+ |
| 010 | Tauri Rust Lifecycle | 2026-06-21 | ✅ M2 | M1+ |
| 011 | Milestone Documentation | 2026-07-12 | ✅ M0-M2 | M0+ |
| 012 | Docs for Async Handoff | 2026-07-12 | ✅ Done | M2+ |
| 013 | Job Delay Policy | TBD | ⏳ Planned | M3 |
| 014 | Vbee WS Protocol | TBD | ⏳ Planned | M3 |

---

## How to Use This Document

### For Fable / Next Contributor
1. **Understanding "why":** Read ADL entries for decisions, not just code
2. **Checking assumptions:** Look here before changing architecture
3. **Phase planning:** Use summary table to see what's decided vs planned

### For Adding New Decisions
When making a major architectural decision:
1. Create ADL entry with date + rationale
2. Link to related docs + milestones
3. Update summary table
4. Reference ADL number in commit message

**Example commit:**
```
feat: add retry logic for CDP health checks

Implements resilience per ADL-004 (CDP for Health + Automation).
See M2_005 Phase C.

- Add exponential backoff for /json/version fetch
- Retry max 3 times with 1s between attempts
- Log each attempt for debugging
```

---

## Next ADL Entries (Anticipated for M3+)

- **ADL-015:** Job State Machine + State Transitions
- **ADL-016:** Provider Routing (Vbee API vs Browser)
- **ADL-017:** Execution Modes (sync/async/batch)
- **ADL-018:** Error Recovery + Retry Policy
- **ADL-019:** Audio Export + ffmpeg Integration

---

**Last Updated:** 2026-07-12  
**Next Review:** After M3 completion (Phase C implementation + job state machine)
