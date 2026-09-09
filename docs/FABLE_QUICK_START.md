# Quick Start Guide for Fable (and future contributors)

**Dành cho:** Agent Fable hoặc bất cứ ai nhận tiếp dự án  
**Bắt đầu từ:** Chat session sau khi chuẩn bị tài liệu  

---

## 🚀 Trong 5 phút: Hiểu dự án là gì

1. **Đọc:** [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) - Section 1-3 (Tổng quan, kiến trúc, M2 status)
2. **Kết quả:** Bạn biết
   - Dự án xây dựng Gateway Core để tự động hóa Vbee TTS
   - Đang ở M2: Browser CDP health checks
   - Next: Full browser connect (Phase C, M3)

---

## 📂 Cấu trúc key folders

```
docs/
  ├── design/                 ← Design decisions (read first for "why")
  ├── milestones/             ← Evidence of completed work (M0-M2 done, M2_005 current)
  └── PROJECT_OVERVIEW.md     ← Full reference (this guide refers to it)

gateway/src/
  ├── api/                    ← Express routes (entry points)
  ├── services/               ← Business logic (queue, browser, vbee, file)
  ├── infrastructure/
  │   ├── browser/            ← Browser automation (health + stubs for connect)
  │   └── ...
  └── worker/                 ← Job processor

src-tauri/src/               ← Desktop Rust code (browser_lifecycle, gateway_lifecycle commands)
scripts/                     ← CLI helpers (browser-lifecycle.mjs, gateway-lifecycle.mjs)
```

---

## ✅ First task: Verify M2 is working

```bash
# Check tests pass
npm run test:m2

# Check Rust compiles
cargo check --manifest-path src-tauri/Cargo.toml

# Check consistency
python3 ../context-mapping/cli.py check-consistency .
```

**Expected:** All green (no errors). If not, check M2_005 known issues section.

---

## 📖 What to read before starting a task

### For any task:
- [ ] [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) relevant section
- [ ] Milestone doc for your target phase (M2_005 if working on Phase C now)
- [ ] Related design doc (e.g., design/02_mvp-architecture.md)

### For browser/CDP work:
- [ ] design/01_zeroclaw-vbee-working-spec.md (Section 2: browser-control)
- [ ] M2_005_browser-launch-rust-and-gateway-connect-prep.md (Section: Known Limits)

### For gateway core work:
- [ ] design/02_mvp-architecture.md (Section 3: Boundary)
- [ ] M2_004_architecture-clarifications-parallel-planning.md

### For Vbee/API work:
- [ ] design/06_voicefactory-provider-adapter-contract.md (auth/creds)
- [ ] design/07_vbee-dual-execution-workflows.md (protocol)

---

## 🎯 Current work: Phase C (Full browser connect)

**Status:** Ready to start (after user confirms Brave manual test works)

**What needs to happen:**
1. Implement `connect()` + `withPage()` in `gateway/src/infrastructure/browser/adapters/playwright-cdp.js`
2. Add integration tests for page automation
3. Install Playwright (flagged "ask before")
4. Create M2_006 milestone doc with evidence
5. Update ROADMAP for M3 prep

**Files to touch:**
- `gateway/src/infrastructure/browser/adapters/playwright-cdp.js` (add implementation)
- `gateway/src/infrastructure/browser/browser-service.js` (remove stubs)
- `gateway/src/worker/` (integrate page automation with job processor)
- Tests (new integration tests)
- Docs (M2_006 or update M2_005)

**Decisions to make:**
- [ ] Install Playwright now? (See PROJECT_OVERVIEW Section 8: pending decisions)
- [ ] Vbee login flow (manual vs auto)?

---

## 🔍 Code navigation tips

### "Where is X defined?"

| Looking for | Check |
|---|---|
| Express routes | `gateway/src/api/*.js` |
| Service logic | `gateway/src/services/*Service.js` |
| Browser adapter | `gateway/src/infrastructure/browser/adapters/` |
| Tauri commands | `src-tauri/src/lib.rs` |
| Job processor | `gateway/src/worker/` |
| Tests | `gateway/src/**/*.test.js` (tests live next to source) |

### "What does this module do?"

Read the top comment or check PROJECT_OVERVIEW Section 2.2 (Key Services).

### "How do I run just one test?"

```bash
# Run one test file
node --test gateway/src/infrastructure/browser/adapters/playwright-cdp.test.js

# Run with grep filter (if using Node.js test runner)
node --test --grep "health" gateway/src/**/*.test.js
```

---

## 💡 Key concepts to understand

### Adapter Pattern
```javascript
// All adapters implement this interface:
class PlaywrightCdpAdapter {
  constructor() { ... }
  isAvailable() { return true/false; }          // Health check
  async connect() { ... }                       // Full browser connection
  async withPage(callback) { ... }              // Run code in browser context
  async close() { ... }                         // Cleanup
}

// Gateway doesn't know which adapter → can swap easily
class BrowserService {
  async getAdapter() { return new PlaywrightCdpAdapter(); }
  async health() { return adapter.isAvailable(); }
  async automate(job) { return adapter.withPage(...); }
}
```

### Job State Machine
```
Job states:
queued → processing → complete/failed

M2 (current): Health checks only
M3 (next): Full automation + state transitions
```

### Strangler Pattern
```
Old: Gateway → Worker → Browser → Vbee
New: UI/ZeroClaw → Gateway Services → Adapters → Audio Assets

Both run together, old flow gradually replaced.
```

---

## 🐛 Debug tips

### "Gateway won't start"
```bash
# Check if port 3000 is in use
lsof -i :3000  # or: netstat -ano | findstr :3000

# Check SQLite is writable
ls -la gateway/tts.db

# Check Node version
node --version  # needs >= 24
```

### "Browser health check fails"
```bash
# Check if Brave is running
lsof -i :9222  # or: netstat -ano | findstr :9222

# Test CDP endpoint manually
curl -v http://127.0.0.1:9222/json/version

# Check WSL→Windows networking (if on WSL)
ping host.docker.internal  # or check /etc/resolv.conf
```

### "Tests fail"
```bash
# Run with verbose output
npm run test:m2 -- --verbose

# Run one test file with debug
node --test --inspect-brk gateway/src/infrastructure/browser/adapters/playwright-cdp.test.js
```

---

## 📝 Before committing

**Checklist:**
```
[ ] npm run test:m2 passes
[ ] cargo check --manifest-path src-tauri/Cargo.toml passes
[ ] python3 ../context-mapping/cli.py check-consistency . (clean output)
[ ] node --check on any .mjs files I modified
[ ] Updated milestone doc (M2_005 or new M2_006)
[ ] Updated ROADMAP if timeline changed
[ ] No console.log left (use logger if needed)
[ ] No hardcoded paths (use config/env)
```

---

## 📞 Ask questions in code

### Add a TODO if you find ambiguity
```javascript
// TODO: M3 - Implement full Playwright connect here (job_runner.withPage)
async withPage(callback) {
  throw new Error('Not implemented in M2 (health-only scope)');
}
```

### Link to docs if logic is complex
```javascript
// For Vbee preview protocol, see design/07_vbee-dual-execution-workflows.md
// Job state flow per M2_004 phase diagram
```

---

## 🎓 Learning path (if new to project)

1. **Day 1:** Read PROJECT_OVERVIEW, understand 2-3 design docs
2. **Day 2:** Run tests, start the gateway locally
3. **Day 3:** Read code for 1 service (e.g., BrowserService)
4. **Day 4:** Make a small change + commit (e.g., add a comment, fix a typo)
5. **Day 5:** Work on a real task with guidance from this doc

---

## 🚨 Red flags (don't do these)

❌ Edit SQLite schema without checking M0_001 migration notes  
❌ Remove browser adapter stubs without understanding Phase C plan  
❌ Hardcode CDP URL (use config)  
❌ Install Playwright without user confirmation  
❌ Skip consistency check before pushing  
❌ Change MILESTONES.md without updating milestone docs  
❌ Modify .context files directly (use context-mapping CLI)  

---

## 🔗 Quick links

| Need | Link |
|------|------|
| Full reference | [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) |
| Current work | [M2_005 milestone](milestones/M2_005_browser-launch-rust-and-gateway-connect-prep.md) |
| Architecture | [design/02_mvp-architecture.md](design/02_mvp-architecture.md) |
| Browser strategy | [design/01_zeroclaw-vbee-working-spec.md](design/01_zeroclaw-vbee-working-spec.md) |
| Migration roadmap | [design/04_migration-plan-to-gateway-core.md](design/04_migration-plan-to-gateway-core.md) |
| Phases overview | [.context/ROADMAP.md](../.context/ROADMAP.md) |

---

## ✨ Pro tips

- **Use consistent naming:** Job, Queue, Adapter, Service (no random names)
- **Keep services thin:** Move logic to adapters
- **Test at boundaries:** HTTP tests, adapter tests, worker loop tests
- **Document decisions:** Add milestone doc even for small changes
- **Ask before big changes:** Check MILESTONES.md + design docs first
- **Link related files:** Use comments like "See M2_005 Phase C plan"

---

## 📅 Next milestone check-in

After completing a task:
1. Update milestone doc (M2_005 or create M2_006)
2. Verify: `npm run test:m2`, `cargo check`, consistency check
3. Update ROADMAP if timeline changed
4. Link related PRs/issues in commit message
5. Done! 🎉

---

**Questions?** Check PROJECT_OVERVIEW.md or look for similar code patterns in gateway/src/.

Good luck! 🚀
