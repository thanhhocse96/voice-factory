# ZeroClaw Vbee Automate - Project Overview

**Cập nhật:** 2026-07-12  
**Phiên bản:** v0.0.1  
**Status:** M2 - Browser CDP Health & Vbee Preview Harness  

---

## 1. Tổng quan dự án

### Mục tiêu chính
Xây dựng một **Local-first Gateway Core** để tự động hóa quy trình Text-to-Speech (TTS) của Vbee thông qua browser automation, được điều khiển từ Tauri Desktop UI và/hoặc ZeroClaw skill runner.

### Vấn đề giải quyết
- Trước đây: ZeroClaw trực tiếp click/type trên Vbee → khó kiểm soát, khó scale
- Giải pháp: Tạo Gateway Core làm trung gian → browser automation via CDP → Vbee Studio

### Kiến trúc high-level
```
Tauri Desktop UI (Vue)
    ↓ HTTP
Gateway Core (Node.js)
    ├── Queue Service (Job management)
    ├── Browser Service (Playwright CDP Adapter)
    ├── Vbee Service (API + session)
    ├── File Service (Download & atomic rename)
    └── SQLite WAL (Persistent state)
        ↓
    Browser Automation (Brave/Chromium + CDP)
        ↓
    Vbee Studio / Vbee API
```

**Optional:** ZeroClaw skill runner có thể gọi Gateway API để tạo/quản lý jobs.

---

## 2. Kiến trúc Gateway Core

### 2.1 Layer breakdown

| Layer | Mô tả | Files |
|-------|-------|-------|
| **API Layer** | Express REST API, socket connections | `gateway/src/api/` |
| **Service Layer** | Business logic (queue, browser, vbee, file) | `gateway/src/services/` |
| **Adapter Layer** | Pluggable adapters (Playwright CDP, Vbee API, File ops) | `gateway/src/infrastructure/` |
| **Data Layer** | SQLite with WAL mode | `gateway/src/data/` |
| **Worker Loop** | Job processor, delay policy | `gateway/src/worker/` |

### 2.2 Key Services

**Queue Service**
- Nhận job từ UI/ZeroClaw
- Lưu vào SQLite
- Trả về status
- Không ghi trực tiếp, thông qua DB Service

**Browser Service**
- Health check CDP (M2 scope)
- Adapter interface: `connect()`, `withPage()`, `close()`
- Current: Playwright CDP Adapter (stubs for full connect)
- Future: Camoufox, Patchright adapters

**Vbee Service**
- API interactions (official HTTP endpoints)
- Session management
- Preview recording (WebSocket protocol)

**File Service**
- Download to `.tmp`
- Atomic rename to `.mp3`
- Update `audio_assets` table
- ffmpeg export (future)

**Worker Loop**
- Poll SQLite for pending jobs
- Apply delay policy (based on word count, speaking rate)
- Call Browser/Vbee adapters
- Update job state → audio_assets

### 2.3 Data Model (SQLite)

**Main tables:**
- `tts_queue` - Job queue (legacy, being phased out to audio_assets)
- `audio_assets` - Audio files + metadata (new source of truth)
- `job_state` - State machine tracking (queued → processing → complete/failed)
- `gateway_config` - Runtime settings (profile path, CDP URL, delays)

---

## 3. Browser Automation Strategy

### 3.1 Brave vs Chromium
- **MVP default:** Brave headed + profile
  - Pro: Real session, cookies, login state
  - Con: User must login manually first time
- **Future:** Chromium vanilla profile
  - Pro: Clean state, no side effects
  - Con: Requires separate login flow

### 3.2 CDP (Chrome DevTools Protocol)
- Port: 9222 (configurable via env/config)
- WSL + Windows: CDP accessible from WSL Node server to Windows Brave via localhost:9222
- Cross-platform launch script: `scripts/browser-lifecycle.mjs`

### 3.3 Playwright Integration
- **M2:** Health checks only (fetch `/json/version`)
- **M3+:** Full page automation via `connectOverCDP()`
- Not installed by default (flagged for user confirmation)

---

## 4. Migration Roadmap

### Strangler Pattern Approach
Old flow stays working while new core is built incrementally.

```
Current (M0-M1):
Gateway → Worker → Browser → Vbee

New (M2+):
UI/ZeroClaw → Gateway Core Services → Adapters → Audio Assets
```

### Phase breakdown

| Phase | Milestone | Focus | Status |
|-------|-----------|-------|--------|
| **Phase 0** | M0-M1 | Gateway core + Tauri lifecycle | ✅ Done |
| **Phase 1** | M2 | Browser CDP health + preview harness | 🟡 **In Progress** |
| **Phase 2** | M2.5-M3 | Full browser connect + job state machine | ⏳ Planned |
| **Phase 3** | M3-M4 | Vbee WS protocol + real preview | ⏳ Planned |
| **Phase 4** | M4-M5 | Sound Editor + export | ⏳ Planned |

---

## 5. Current Status (M2)

### What's been done
✅ Gateway core API (Express)  
✅ Tauri desktop shell with lifecycle commands  
✅ Browser CDP health checks (M2_001-M2_002)  
✅ Docs sync + architecture clarification (M2_003-M2_004)  
✅ Browser lifecycle script (`scripts/browser-lifecycle.mjs`)  
✅ Rust/Tauri browser commands (`src-tauri/src/gateway_lifecycle.rs`)  
✅ Gateway stubs for full connect (playwright-cdp.js + browser-service.js)  

### What's happening now (M2_005 / M2_006)
🟡 **Test & verify browser launch** via manual Brave test (WSL foreground)  
🟡 **Prepare Phase C** - Full browser connect (playwright install + page automation)  
✅ **Feasibility assessment documented** — [M2_006](milestones/M2_006_project-feasibility-assessment.md): MVP 1 máy + audio Vbee thật là khả thi nếu giữ cut line

### Known blockers / decisions needed
- [ ] User confirms Brave manual test works (WSL + Windows Brave launch)
- [ ] Decision: Full playwright install for M3 (currently flagged "ask before")
- [ ] Vbee login flow (manual first time or auto-provision?)
- [ ] Human accepts M2_006 cut line before starting real Vbee job path

---

## 6. Tech Stack

### Backend
- **Runtime:** Node.js v24+ (experimental-sqlite)
- **Framework:** Express.js
- **Database:** SQLite with WAL mode
- **Testing:** Node.js built-in test runner

### Desktop
- **Framework:** Tauri 2.x
- **UI:** Vue.js
- **IPC:** Tauri invoke commands

### Browser Automation
- **Browser:** Brave (headed) or Chromium (headed/headless)
- **CDP:** Chrome DevTools Protocol (port 9222)
- **Control:** Playwright (Node.js adapter, not installed by default)

### Build & Dev
- **Scripts:** Bash, JavaScript (Node), Rust
- **Linting:** python3 context-mapping (consistency checks)

---

## 7. File Structure

```
zeroclaw-vbee-automate/
├── docs/
│   ├── design/                          # Design docs (source of truth)
│   │   ├── 01_zeroclaw-vbee-working-spec.md
│   │   ├── 02_mvp-architecture.md
│   │   ├── 04_migration-plan-to-gateway-core.md
│   │   └── ...
│   ├── milestones/                      # Milestone docs (evidence)
│   │   ├── M0_001_gateway-core-fake-end-to-end.md
│   │   ├── M1_005_tauri-gateway-lifecycle-shell.md
│   │   ├── M2_001_browser-cdp-health-and-preview-harness.md
│   │   ├── M2_004_architecture-clarifications-parallel-planning.md
│   │   ├── M2_005_browser-launch-rust-and-gateway-connect-prep.md
│   │   └── ...
│   └── PROJECT_OVERVIEW.md              # This file
│
├── gateway/                             # Gateway Core (Node.js)
│   └── src/
│       ├── api/                         # Express routes
│       ├── services/                    # Queue, Browser, Vbee, File
│       ├── infrastructure/
│       │   ├── browser/                 # Browser service + adapters
│       │   ├── vbee/                    # Vbee API adapters
│       │   └── file/                    # File operations
│       ├── data/                        # SQLite schema, migrations
│       ├── worker/                      # Job processor loop
│       └── server.js                    # Entry point
│
├── src-tauri/                           # Tauri Desktop App
│   └── src/
│       ├── gateway_lifecycle.rs         # Gateway start/stop commands
│       ├── browser_lifecycle.rs         # Browser start/stop commands
│       └── lib.rs                       # Tauri invoke exports
│
├── src/                                 # Frontend Vue UI
│   └── App.vue, components, etc.
│
├── scripts/
│   ├── browser-lifecycle.mjs            # Cross-platform browser launcher
│   ├── gateway-lifecycle.mjs            # Gateway state management
│   ├── live-cdp-vbee-check.mjs          # CDP health + Vbee API test
│   └── smoke-*.sh                       # Smoke tests
│
├── package.json                         # npm scripts (test:m2, smoke, etc.)
├── Cargo.toml                           # Tauri Rust config
└── .context/                            # Context mapping (for consistency checks)
    ├── MILESTONES.md                    # Milestone registry
    ├── ROADMAP.md                       # High-level roadmap
    └── modules/                         # Architecture specs
```

---

## 8. Key Design Decisions

### ✅ Decided

1. **Gateway = Single source of truth for SQLite**
   - UI, ZeroClaw, worker don't read/write DB directly
   - Gateway API is the only DB interface

2. **Adapter pattern for browser**
   - Pluggable adapters (Playwright CDP, Camoufox, Patchright)
   - Easy to swap implementations

3. **Headed browser with real session**
   - Brave profile with real login
   - Avoids Vbee's anti-bot protections
   - CDP health check before full automation

4. **Strangler migration**
   - Old flows stay working
   - New services added incrementally
   - No big-bang refactors

5. **Audio assets as source of truth (not tts_queue)**
   - Sound Editor works with audio_assets
   - Job state decoupled from file state

### ⏳ Pending decisions

- Full playwright install for Phase C?
- Vbee login flow (manual vs auto)?
- Chromium instead of Brave for distribution?
- Camoufox/Patchright timeline?

---

## 9. Development Workflow

### Setup
```bash
# Backend (Gateway + Tauri Rust)
npm install
source ~/.nvm/nvm.sh && nvm use 24

# Build Tauri (requires Rust)
npm run desktop:build
# Or dev mode
npm run desktop:dev

# Run tests
npm run test:m2

# Smoke tests
npm run smoke
npm run smoke:lifecycle
```

### Testing
```bash
# Unit tests (gateway + browser adapters)
npm run test:m2

# Manual gateway start (WSL)
HOST=127.0.0.1 npm run dev

# Manual browser start
node scripts/browser-lifecycle.mjs start

# Browser health check
curl http://127.0.0.1:9222/json/version

# Consistency check
python3 ../context-mapping/cli.py check-consistency .
```

### Verify before commit
```bash
node --check scripts/browser-lifecycle.mjs
cargo check --manifest-path src-tauri/Cargo.toml
python3 ../context-mapping/cli.py check-consistency .
```

---

## 10. Documentation Index

### Design Docs (source of truth)
1. [01 - ZeroClaw Vbee Working Spec](design/01_zeroclaw-vbee-working-spec.md) - Architecture decision
2. [02 - MVP Architecture](design/02_mvp-architecture.md) - Layers and boundaries
3. [03 - Phase 1 Design](design/03_phase-1-design.md) - Early phase details
4. [04 - Migration Plan](design/04_migration-plan-to-gateway-core.md) - Strangler roadmap
5. [05 - Critique Response](design/05_critique-response-and-plan-amendments.md) - Design review outcomes
6. [06 - VoiceFactory Adapter Contract](design/06_voicefactory-provider-adapter-contract.md) - Auth/creds architecture
7. [07 - Dual Execution Workflows](design/07_vbee-dual-execution-workflows.md) - Vbee protocol flows

### Milestone Docs (evidence)
- **M0:** Gateway core + fake E2E (Done)
- **M1:** Tauri lifecycle shell (Done)
- **M2_001-M2_003:** Browser CDP health + docs sync (Done)
- **M2_004:** Architecture clarifications + Phase B plan (Done)
- **M2_005:** Browser launch Rust/Tauri + gateway stubs
- **M2_006:** Project feasibility assessment (skeleton proven; one-machine real Vbee audio is the cut line)

### Key References
- `.context/MILESTONES.md` - Milestone registry
- `.context/ROADMAP.md` - Phase timeline
- `.local/M2_LIVE_VBEE_CDP_TEST.md` - Manual test protocol (if exists)
- `.local/ENVIRONMENT.md` - WSL/Windows setup notes

---

## 11. Next Actions (For next chat session)

### Immediate (Fable can pick up here)
0. **Read [M2_006 feasibility](milestones/M2_006_project-feasibility-assessment.md)** — keep the one-machine real-audio cut line; do not start editor/multi-provider/2-machine work first.
1. **Verify M2 completion**
   - Run unit tests: `npm run test:m2`
   - Check Rust builds: `cargo check --manifest-path src-tauri/Cargo.toml`
   - Consistency: `python3 ../context-mapping/cli.py check-consistency .`

2. **Prepare Phase C (Full browser connect)**
   - Update M2_005 with Phase C plan details
   - Playwright install flagged (ask before `npm install playwright`)
   - implement `connect()` + `withPage()` in playwright-cdp.js
   - Add integration tests for page automation

3. **Browser health hardening**
   - Add retry logic for CDP health checks
   - Better error messages for network/connectivity issues
   - Support custom CDP_URL via env/config

4. **Documentation updates**
   - Create M2_006 (or continue M2_005) with Phase C details
   - Update ROADMAP with M3 prep (provider/executionMode)
   - Add WSL troubleshooting guide

### Medium-term (M3 prep)
- Job state machine implementation
- Delay policy from config
- Vbee WS protocol recording
- Provider/executionMode database schema

### Long-term (M4+)
- Sound Editor integration
- Export + ffmpeg
- Camoufox/Patchright adapters
- Multi-browser routing

---

## 12. Key Contacts / Owners

- **Project Lead:** Shinkuro (Git user)
- **Design Source:** ZeroClaw VBEE TTS docs + docs/design/
- **Context Authority:** .context/MILESTONES.md + ROADMAP.md

---

## 13. Quick Reference - Common Commands

| Task | Command |
|------|---------|
| Run tests | `npm run test:m2` |
| Start gateway (dev) | `HOST=127.0.0.1 npm run dev` |
| Start Tauri | `npm run desktop:dev` |
| Browser health check | `curl http://127.0.0.1:9222/json/version` |
| Start browser | `node scripts/browser-lifecycle.mjs start` |
| Browser status | `node scripts/browser-lifecycle.mjs status` |
| Consistency check | `python3 ../context-mapping/cli.py check-consistency .` |
| Check syntax | `node --check scripts/browser-lifecycle.mjs` |
| Cargo check | `cargo check --manifest-path src-tauri/Cargo.toml` |

---

## 14. Glossary

| Term | Definition |
|------|-----------|
| **CDP** | Chrome DevTools Protocol (browser automation API) |
| **Playwright** | Node.js browser automation library |
| **Brave** | Privacy-focused Chromium-based browser |
| **Tauri** | Lightweight desktop app framework (Rust + web UI) |
| **Gateway** | Central Node.js server managing jobs + browser |
| **Adapter** | Pluggable interface for browser/Vbee/file operations |
| **WAL** | Write-Ahead Logging (SQLite mode for concurrent access) |
| **ZeroClaw** | Skill-based task runner (optional client) |
| **Vbee** | Vietnamese TTS service (target automation) |
| **WS** | WebSocket (for Vbee preview protocol) |

---

## 15. Known Issues & Workarounds

### WSL + Windows Brave launch
- **Issue:** Script launch from WSL can be flaky (path quoting, window focus)
- **Workaround:** User manually start Brave on Windows, Node script connects via CDP
- **See:** M2_005 WSL/Windows notes + design/01 start-brave.bat example

### CDP health check network
- **Issue:** 127.0.0.1 may not be accessible in some setups
- **Workaround:** Use Windows IP from `/etc/resolv.conf` or hostname.local
- **See:** M2_005 networking troubleshooting

### Playwright not installed
- **Issue:** Full page automation needs Playwright, not in MVP scope
- **Workaround:** Flag for user confirmation before `npm install playwright`
- **See:** BROWSER_SERVICE.md "M2 health only" note

---

**End of Project Overview**

This document should give Fable (or any future contributor) a complete picture of:
- What the project does
- How it's structured
- Where important code/docs live
- What's been done (M0-M2)
- What's next (Phase C, M3)
- How to verify changes
- Common commands and gotchas

Feel free to reference this in future chat sessions!
