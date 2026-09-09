# M2 Completion Checklist

**Milestone:** M2 - Browser CDP Health & Vbee Preview Harness  
**Target:** Verify all work is done before proceeding to Phase C (full browser connect)  
**Updated:** 2026-07-12  

---

## ✅ Code Completeness

### Browser Health Infrastructure
- [x] BrowserService class exists (`gateway/src/infrastructure/browser/browser-service.js`)
- [x] PlaywrightCdpAdapter with health checks (`gateway/src/infrastructure/browser/adapters/playwright-cdp.js`)
- [x] Gateway `/health` endpoint includes browser CDP status
- [x] Health gracefully degrades when CDP unavailable

### Browser Lifecycle (Rust + Script)
- [x] `scripts/browser-lifecycle.mjs` (start/status/stop commands)
- [x] Rust functions in `src-tauri/src/gateway_lifecycle.rs` (start_browser, status_browser, stop_browser_if_owned)
- [x] Tauri invoke commands exported in `src-tauri/src/lib.rs`
- [x] Cross-platform support (Windows native + WSL)
- [x] CDP port configurable (default 9222)

### Adapter Pattern Ready
- [x] BrowserService delegates to adapter
- [x] Adapter interface: `isAvailable()`, `connect()` (stub), `withPage()` (stub), `close()`
- [x] Stubs have TODO comments linking to Phase C plan
- [x] No breaking changes to existing health flow

---

## ✅ Testing & Verification

### Unit Tests
- [x] All M2 tests pass: `npm run test:m2`
- [x] BrowserService returns unavailable when adapter missing
- [x] PlaywrightCdpAdapter reports health status
- [x] PlaywrightCdpAdapter degrades gracefully
- [x] VbeePreviewProtocolRecorder validates protocol sequence
- [x] No regressions in existing tests

### Syntax & Build Checks
- [x] JavaScript syntax: `node --check scripts/browser-lifecycle.mjs`
- [x] Gateway JS: `node --check gateway/src/infrastructure/browser/adapters/playwright-cdp.js`
- [x] Gateway JS: `node --check gateway/src/infrastructure/browser/browser-service.js`
- [x] Rust compiles: `cargo check --manifest-path src-tauri/Cargo.toml` (exit 0)
- [x] Consistency: `python3 ../context-mapping/cli.py check-consistency .` (clean output)

### Integration & Manual Tests
- [x] Gateway starts without errors: `npm run dev` (WSL or Windows)
- [x] `/health` endpoint works and includes browser status
- [x] Browser launch script works: `node scripts/browser-lifecycle.mjs start`
- [x] Browser status check works: `node scripts/browser-lifecycle.mjs status`
- [x] CDPHealth check works: `curl http://127.0.0.1:9222/json/version`
- [x] Smoke test passes: `npm run smoke` (if available)
- [x] Smoke lifecycle test passes: `npm run smoke:lifecycle` (if available)

---

## ✅ Documentation

### Milestone Documentation
- [x] M2_001 exists: Browser CDP Health And Preview Harness
- [x] M2_002 exists: Browser CDP Health Test Report
- [x] M2_003 exists: Docs Sync & Update from ZeroClaw VBEE TTS
- [x] M2_004 exists: Architecture Clarifications, Browser Options and Parallel Planning
- [x] M2_005 exists: Browser Launch (Rust/Tauri) and Gateway Connect Prep
- [x] M2_005 includes Phase B results (browser launch + gateway stubs)
- [x] M2_005 includes verified tests section (unit tests, simulated gateway, script tests, Rust)
- [x] M2_005 includes Known Limits + Next Action (Phase C)

### Reference Documentation
- [x] PROJECT_OVERVIEW.md created (full reference for future contributors)
- [x] FABLE_QUICK_START.md created (onboarding guide)
- [x] Design docs linked in README (01-07)
- [x] README.md updated with M2_005 entry
- [x] Glossary in PROJECT_OVERVIEW (CDP, Playwright, Adapter, etc.)

### Architecture Docs
- [x] design/01 - Browser control decision (Brave + CDP)
- [x] design/02 - MVP architecture layers
- [x] design/04 - Migration roadmap (strangler pattern)
- [x] design/06 - Vbee adapter contract (auth/creds architecture)
- [x] design/07 - Vbee dual execution workflows

---

## ✅ Code Quality

### No Known Issues
- [x] No console.log left in production code
- [x] No hardcoded paths (uses config/env where needed)
- [x] No sensitive data in logs
- [x] Error messages are helpful (network timeouts, port conflicts, etc.)
- [x] All TODOs are documented with phase/section reference

### Patterns Consistent
- [x] Adapter pattern used for browser (easy to extend)
- [x] Service layer separation maintained (API → Service → Adapter)
- [x] Naming consistent (BrowserService, PlaywrightCdpAdapter, etc.)
- [x] No dead code or unused imports

---

## ✅ Known Limitations (Documented)

### M2 Scope (Correct & Expected)
- [x] Health checks only (no full page automation)
- [x] Playwright not installed (flagged for M3)
- [x] No Vbee WS protocol handling (preparation only)
- [x] No job state machine yet (simple health status)
- [x] No live Vbee authentication flow (manual or fake)

### WSL + Windows Notes (Documented)
- [x] Browser launch from WSL can be flaky (noted in M2_005)
- [x] Workaround provided (user manually start Brave, Node connects via CDP)
- [x] CDP networking explained (127.0.0.1 → Windows listener)

### Missing for Phase C (Clearly Marked)
- [x] `connect()` in adapter has TODO comment
- [x] `withPage()` in adapter has TODO comment
- [x] Playwright install flagged in browser-service.js
- [x] Job processor loop has TODO for full automation

---

## ✅ Git & Commit History

- [x] All changes committed with meaningful messages
- [x] M2_005 milestone commit includes evidence (date: 2026-07-08 or later)
- [x] Git log shows progression M0 → M1 → M2
- [x] No uncommitted changes blocking Phase C start

```bash
# Verify:
git log --oneline docs/milestones/ | head -20
git status  # Should be clean or have only Phase C start
```

---

## ⏳ Ready for Phase C?

### Check before proceeding

```bash
# Run these commands:
npm run test:m2                                      # Should pass (5 tests)
cargo check --manifest-path src-tauri/Cargo.toml    # Should exit 0
python3 ../context-mapping/cli.py check-consistency . # Should be clean
git status                                            # Should show no conflicts
```

**If all pass:** ✅ M2 is complete, ready to start Phase C

**If any fail:** ⚠️ Debug before proceeding (see FABLE_QUICK_START.md debug tips)

---

## Next: Phase C Kickoff

Once M2 is verified complete:

### 1. Plan (30 min)
- [ ] Read M2_005 Phase C section
- [ ] Review `gateway/src/infrastructure/browser/adapters/playwright-cdp.js` stubs
- [ ] Decide: Install Playwright now? (Ask human first)

### 2. Implement (2-3 hours)
- [ ] Implement `connect()` in playwright-cdp.js
- [ ] Implement `withPage()` with callback support
- [ ] Add integration tests for page automation
- [ ] Update browser-service.js (remove error throws on connect)
- [ ] Add tests for job processor with page context

### 3. Document (1 hour)
- [ ] Create M2_006 (or update M2_005) with Phase C evidence
- [ ] Update ROADMAP with M3 timeline
- [ ] Link to new tests in milestone doc

### 4. Verify (30 min)
- [ ] npm run test:m2 passes (including new tests)
- [ ] cargo check passes
- [ ] consistency check clean
- [ ] M2_006 milestone doc complete

---

## Checklist for Fable (next session)

Before starting work on Phase C:

```
Verification (do these first):
[ ] Read PROJECT_OVERVIEW.md sections 1-5
[ ] Read FABLE_QUICK_START.md
[ ] Read M2_005_browser-launch-rust-and-gateway-connect-prep.md (full)
[ ] Run npm run test:m2 locally
[ ] Run cargo check locally
[ ] Run consistency check locally
[ ] Understand why Phase C is full browser connect (not just health)

Decision:
[ ] Ask user: Ready for Playwright install?
[ ] Ask user: What Vbee login flow? (manual vs auto)

Then proceed:
[ ] Start implementing connect() + withPage() stubs
[ ] Add integration tests
[ ] Create M2_006 milestone doc
[ ] Verify all checks pass
[ ] Commit + done
```

---

## Reference Links

- [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) - Full architecture reference
- [FABLE_QUICK_START.md](FABLE_QUICK_START.md) - Onboarding guide
- [M2_005_browser-launch-rust-and-gateway-connect-prep.md](milestones/M2_005_browser-launch-rust-and-gateway-connect-prep.md) - Current milestone
- [design/02_mvp-architecture.md](design/02_mvp-architecture.md) - Architecture layers
- [design/06_voicefactory-provider-adapter-contract.md](design/06_voicefactory-provider-adapter-contract.md) - Adapter contract (browser + vbee)

---

**Status: Ready for Phase C** ✅  
All M2 requirements met. Waiting for user confirmation before full browser automation implementation begins.
