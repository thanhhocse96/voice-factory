# 🚀 START HERE FOR FABLE (and future contributors)

**Prepared:** 2026-07-12  
**For:** Fable or next chat session contributor  
**Time to read:** 15 minutes (overview) + 1 hour (deep dive)  

---

## What happened in this prep session

A human contributor asked me to **prepare comprehensive documentation** so that Fable (a future Claude model) can understand the ZeroClaw Vbee Automate project without starting from scratch.

**Result:** 5 new documents + memory system to preserve architectural decisions.

---

## 📚 Documents prepared (in order of reading)

### 1️⃣ **THIS FILE** (you're reading it)
Start here → quick navigation to other docs

### 2️⃣ **[FABLE_QUICK_START.md](FABLE_QUICK_START.md)** ⭐ Read this first
- 5-minute project overview
- Code structure cheat sheet
- First task checklist
- Debug tips + common commands

**Read time:** 10-15 minutes  
**Do after:** Run the "Verify M2" commands

### 3️⃣ **[PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md)** 📖 Full reference
- Complete architecture breakdown
- All 15 sections (tl;dr to glossary)
- Tech stack + file structure
- Development workflow + commands

**Read time:** 20-30 minutes  
**Use when:** Need detailed reference (not quick lookup)

### 4️⃣ **[M2_COMPLETION_CHECKLIST.md](M2_COMPLETION_CHECKLIST.md)** ✅ Verification
- Checklist to confirm M2 is done
- All tests + build checks
- Documentation completeness
- Ready for Phase C? Yes/No

**Read time:** 5-10 minutes  
**Do when:** About to start Phase C work

### 5️⃣ **[ARCHITECTURE_DECISIONS.md](ARCHITECTURE_DECISIONS.md)** 🏗️ Design rationale
- 14 ADL entries (why did we choose this?)
- Each decision linked to phase + related docs
- Summary table for quick lookup
- ADL-012 = this prep work itself

**Read time:** 15-20 minutes  
**Use when:** Need to understand "why" not just "how"

### 📌 Design Docs (already exist)
- [design/01_zeroclaw-vbee-working-spec.md](design/01_zeroclaw-vbee-working-spec.md) - Browser control strategy
- [design/02_mvp-architecture.md](design/02_mvp-architecture.md) - Layers & boundaries
- [design/04_migration-plan-to-gateway-core.md](design/04_migration-plan-to-gateway-core.md) - Strangler roadmap

### 📋 Milestone Docs (already exist)
- [M2_005_browser-launch-rust-and-gateway-connect-prep.md](milestones/M2_005_browser-launch-rust-and-gateway-connect-prep.md) - Current phase (browser launch + gateway stubs)

### 💾 Memory System
- [../../../memory/MEMORY.md](../../../memory/MEMORY.md) - Preserved decisions + project state

---

## ⏱️ Quickest path (15 minutes)

For getting started ASAP:

1. **Read FABLE_QUICK_START.md** (10 min)
   - Understand what project does
   - See code structure
   - Know first commands to run

2. **Run verification** (5 min)
   ```bash
   npm run test:m2
   cargo check --manifest-path src-tauri/Cargo.toml
   python3 ../context-mapping/cli.py check-consistency .
   ```

3. **Result:** ✅ You're ready to start Phase C work

---

## 📊 Comprehensive path (1-2 hours)

For deep understanding:

1. **FABLE_QUICK_START.md** (15 min)
2. **PROJECT_OVERVIEW.md sections 1-7** (30 min)
   - Tl;dr + architecture + tech stack
3. **ARCHITECTURE_DECISIONS.md ADL-001 to ADL-012** (15 min)
   - Why we built it this way
4. **M2_005 milestone** (15 min)
   - Current phase status + test results
5. **Run M2_COMPLETION_CHECKLIST** (10 min)
   - Verify everything works

6. **Result:** ✅ You deeply understand the project + can make design decisions

---

## 🎯 By phase (if working on specific task)

### Working on **Phase C** (full browser connect)?
1. Read: FABLE_QUICK_START.md → M2_005 Phase C section
2. Read: design/02_mvp-architecture.md (layers)
3. Read: ARCHITECTURE_DECISIONS.md ADL-002 (Adapter pattern)
4. Check: M2_COMPLETION_CHECKLIST.md (ready?)
5. Implement: playwright-cdp.js connect() + withPage()

### Working on **Tauri/Desktop UI**?
1. Read: FABLE_QUICK_START.md → code navigation
2. Read: design/02_mvp-architecture.md Section 3 (boundaries)
3. Read: M2_005 (browser lifecycle commands)
4. Check: src-tauri/src/lib.rs (exported commands)

### Working on **Gateway Core / Job Queue**?
1. Read: PROJECT_OVERVIEW.md Section 2 (services)
2. Read: design/02_mvp-architecture.md Section 3 (boundaries)
3. Read: ARCHITECTURE_DECISIONS.md ADL-001 (strangler pattern)
4. Check: gateway/src/services/ (current implementation)

### Working on **Browser Automation**?
1. Read: design/01_zeroclaw-vbee-working-spec.md Section 2 (browser strategy)
2. Read: ARCHITECTURE_DECISIONS.md ADL-003 + ADL-004 (Brave + CDP)
3. Read: M2_005 (browser launch + gateway stubs)
4. Check: gateway/src/infrastructure/browser/ (current state)

---

## ❓ FAQ for Fable

**Q: Is the project running/tested?**  
A: Yes! M2 is done and verified. See M2_COMPLETION_CHECKLIST.md ✅

**Q: What needs to be done next?**  
A: Phase C (full browser connect + page automation). See M2_005 → Next Action section.

**Q: Where's the most important code?**  
A: `gateway/src/` (services + adapters). See PROJECT_OVERVIEW section 2.2 & 2.3.

**Q: Why so many docs?**  
A: Async handoff (human → me → you). Each doc has a purpose (see sections above).

**Q: Should I read all of them?**  
A: No. Use quickest path (15 min) to start, then read deeper as needed.

**Q: What does Fable need to know before starting work?**  
A: M2 is done. Playwright not installed (user decision for M3). Next: implement adapter connect() + tests.

**Q: How do I debug if something breaks?**  
A: See FABLE_QUICK_START.md "🐛 Debug tips" section.

**Q: What if I need context during implementation?**  
A: Use doc shortcuts in PROJECT_OVERVIEW.md Section 14 (glossary) or grep for ADL-numbers.

---

## 📍 File locations

```
docs/
  ├── START_HERE_FOR_FABLE.md       ← You are here
  ├── FABLE_QUICK_START.md          ← Read first (quick)
  ├── PROJECT_OVERVIEW.md           ← Full reference
  ├── M2_COMPLETION_CHECKLIST.md    ← Verify M2 done
  ├── ARCHITECTURE_DECISIONS.md     ← Design rationale
  │
  ├── design/
  │   ├── 01_zeroclaw-vbee-working-spec.md
  │   ├── 02_mvp-architecture.md
  │   ├── 04_migration-plan-to-gateway-core.md
  │   └── ...
  │
  └── milestones/
      ├── M2_004_architecture-clarifications...md
      └── M2_005_browser-launch-rust-and-gateway-connect-prep.md

memory/
  ├── MEMORY.md                     ← Index of decisions
  └── project_zeroclaw_vbee.md      ← Preserved project state
```

---

## ⚡ Next steps for Fable

When you start the next chat:

1. **Load memory:**
   ```
   🧠 Read: memory/project_zeroclaw_vbee.md (project state + timeline)
   ```

2. **Verify M2:**
   ```bash
   npm run test:m2
   cargo check --manifest-path src-tauri/Cargo.toml
   python3 ../context-mapping/cli.py check-consistency .
   ```

3. **Read docs:** Pick based on your task (see "By phase" section above)

4. **Start work:** See FABLE_QUICK_START.md "Pro tips" for coding standards

5. **Commit:** Reference ADL numbers + milestone in commit message

---

## 🎓 Learning outcome

After reading these docs, you'll know:
- ✅ What the project does (Vbee TTS automation via Gateway Core)
- ✅ Why it's structured this way (strangler pattern, adapters, health-first)
- ✅ What's been done (M0-M2, all tested and verified)
- ✅ What's next (Phase C: full browser connect)
- ✅ How to add code (adapter pattern, services, tests)
- ✅ How to verify changes (checklist, commands, consistency check)

---

## 🙏 Thank you

This preparation was done to make **async handoff easier** and **reduce context loss** between chat sessions.

**The human's goal:** Fable should be able to pick up the project without asking "what's this about?" every time.

**Your job:** Maintain this quality as you work. When you make changes:
- Update milestone doc
- Keep docs in sync
- Add ADL entry for big decisions
- Leave TODOs with phase references

---

## ✨ Key takeaway

> **This project is well-documented, tested, and ready for the next phase.**  
> **M2 is done. Phase C (full browser connect) is next.**  
> **All architectural decisions are logged with rationale.**  
> **Async collaboration is set up.**  
> **Go build! 🚀**

---

**Created by:** Human contributor (chat session 2026-07-12)  
**For:** Fable or future contributor  
**Updated:** [Will be updated as project evolves]
