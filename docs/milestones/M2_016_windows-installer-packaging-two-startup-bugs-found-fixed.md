# M2_016 - Windows Installer Packaging: Cross-Compile From WSL, Multiple Real Startup Bugs Found And Fixed

Milestone: `M2 - Browser CDP Health And Vbee Preview Harness` (infrastructure/packaging slice - no Gateway API/adapter code touched)

Date: 2026-09-10

## Workflow

```mermaid
flowchart TD
  Ask["User asks: \"Huớng dẫn tôi kết xuất thành phần mềm\""] --> Scope["AskUserQuestion: which meaning -\nuser picks \"installer (.exe/.msi) for another machine\""]
  Scope --> Audit["Audit current state: no Windows-native\nRust toolchain, bundle.active:false,\nproject_root() hardcodes CARGO_MANIFEST_DIR\n(non-relocatable), Gateway/Brave never bundled"]
  Audit --> RustQ["AskUserQuestion: MSVC vs GNU linker,\nbundle Node or require it preinstalled"]
  RustQ --> Pushback["User: \"Tôi có cài trong wsl mà?\"\n- already has Rust, just not for Windows target"]
  Pushback --> CrossCompile["Pivot: cross-compile x86_64-pc-windows-gnu\nFROM WSL via mingw-w64 + NSIS (makensis) -\nofficially \"experimental\" per Tauri's own docs,\nbut avoids any Windows-side toolchain install"]
  CrossCompile --> Config["tauri.conf.json: bundle.active true,\ntargets [nsis], bundle.resources mapping\ngateway/scripts/server.js/package.json"]
  Config --> IconBug["tauri icon fails: existing 32x32\nicon.png is corrupt (invalid deflate stream)"]
  IconBug --> IconFix["Hand-build a valid 1024x1024 PNG via\nNode's own zlib (no external tool needed),\nre-run tauri icon successfully"]
  IconFix --> RootFix1["Fix project_root(): CARGO_MANIFEST_DIR\nonly for debug builds; release falls back\nto the exe's own runtime directory"]
  RootFix1 --> Build1["First successful cross-compiled build +\nNSIS installer produced"]
  Build1 --> Bug1["LIVE: user reports \"127.0.0.1 refused\nto connect\" after installing/running"]
  Bug1 --> Diag1["Diagnosed: bundle.resources lands\nDIRECTLY beside the exe in a raw build\noutput, not nested under resources/ as\nTauri's own docs describe for NSIS -\nfirst project_root() fix guessed wrong"]
  Diag1 --> Fix1["Fix: check both locations, use\nwhichever actually has the marker file"]
  Fix1 --> Build2["Rebuild, retest - STILL refused"]
  Build2 --> Diag2["Second, unrelated bug found: scripts/\ngateway-lifecycle.mjs spawns 'npm' with\nshell:false - on Windows npm resolves to\nnpm.cmd, which spawn() can't execute\nthat way. Silently produced zero child\nprocess, zero log output. Pre-existing\nbug, never caught before since the Tauri\nshell had never successfully run on\nWindows until this session."]
  Diag2 --> Fix2["Fix: spawn(process.execPath, [...])\ndirectly - no npm dependency at all"]
  Fix2 --> Verify["LIVE: Gateway + Brave both start,\n/health returns ok:true, browserCdp\navailable - confirmed via curl"]
  Verify --> FinalBuild["Official rebuild with both fixes\nbaked in from source (not the manual\ncopy used for fast iteration)"]
  FinalBuild --> Ux["User raises a THIRD issue: even fixed,\nthe window still races the Gateway\nstartup on every cold launch - no app\ndoes UX like that"]
  Ux --> Defer["Confirmed live in code: real race\n(window navigates before start_gateway()\nreturns). Deferred - two follow-up plan\ndocs instead of guessing at a fix now"]
```

## Module / Slice Under Test

Following up directly on M2_013 (Phase D), which shipped the code needed for a two-machine split but could not verify the actual Tauri desktop shell running natively, since no Windows Rust toolchain existed in this environment. This slice closes that gap from the other direction: instead of installing a Windows-native toolchain, it cross-compiles the Windows target (`x86_64-pc-windows-gnu`) from the WSL Rust toolchain that was already present, using mingw-w64 as the linker and NSIS (`makensis`, also Linux-native) as the installer packager - a path Tauri's own docs call "experimental... should only be used as a last resort," accepted here specifically because the user already had Rust in WSL and did not want a second, redundant install on the Windows side.

Two real, pre-existing bugs were only surfaced because this was the *first time in this project's history* the actual compiled Tauri shell ran on Windows at all - everything before this session was verified either via the raw Gateway (`node server.js`) hit directly with a browser, or via WSL-side `cargo check`/`cargo test` (compiles, but never runs the GUI).

## What Was Found And Fixed

### Bug 0 (packaging gap, not yet a runtime bug): non-relocatable project root

`gateway_lifecycle.rs`'s `project_root()` used `env!("CARGO_MANIFEST_DIR")` unconditionally - a value baked in at *compile time* to whichever machine ran `cargo build`. Harmless for `cargo run`/`tauri dev` (always run from the checked-out repo), but would silently break the moment a built binary was copied anywhere else, including a real installer on a different machine. Fixed by gating the compile-time path to debug builds only (`cfg!(debug_assertions)`); release builds resolve relative to the running executable instead. This was a correctness fix made *before* any live test, based on reading the code - not yet proof it was sufficient (see Bug 1).

### Bug 1: wrong assumption about where `bundle.resources` land at runtime

First fix (above) assumed - based on Tauri's own written docs, not a live check - that NSIS nests `bundle.resources` one level down under `resources\` inside the install directory, so `project_root()`'s release fallback was `current_exe().parent().join("resources")`.

**Live evidence contradicted the docs for the actual build output that matters (the raw `tauri build` target directory, which is what a user runs first, and what the installer's own payload is assembled from):** `gateway/`, `scripts/`, `server.js`, and `package.json` all land *directly* beside `voicefactory-desktop.exe`, no `resources\` subfolder. Running the app against this layout produced exactly the reported symptom - the webview loads and immediately shows the browser's native "127.0.0.1 refused to connect" page, because `gateway_lifecycle::start_gateway()` silently failed to find `scripts/gateway-lifecycle.mjs` at the (wrong) path it was checking.

Fixed by checking for the real marker file (`resources/scripts/gateway-lifecycle.mjs`) and falling back to the exe's own directory when it's absent, rather than trusting either location unconditionally ([gateway_lifecycle.rs:178-210](../../src-tauri/src/gateway_lifecycle.rs)).

### Bug 2: `spawn('npm', ...)` silently does nothing on Windows

Even after Bug 1's fix, the symptom persisted identically. Diagnosis this time started from evidence, not another doc-based guess: the browser-lifecycle side of the exact same mechanism (`scripts/browser-lifecycle.mjs`, called the same way from the same Rust code) *did* work - a real Brave profile got created at the resolved root, proving `project_root()` itself was now correct. That isolated the remaining failure to `scripts/gateway-lifecycle.mjs` specifically.

Its `start()` function spawned `spawn('npm', ['run', 'dev'], { shell: false, ... })`. On Windows, `npm` resolves to `npm.cmd` (a batch/PowerShell shim, not a real `.exe`) - `child_process.spawn` with `shell: false` (the default, and what this code explicitly set) cannot execute a `.cmd` file directly. The call produced *no error, no child process, and no log output at all* - the emptiest possible failure signature, which is exactly what made this take two live round-trips to isolate rather than one. `browser-lifecycle.mjs` never hit this because it spawns `powershell.exe` directly, a real executable, not a `.cmd` shim.

Fixed by spawning `process.execPath` (the exact `node` binary already running this very script, guaranteed to exist, no PATH lookup needed) with the same args `package.json`'s own `"dev"`/`"start"` scripts use, instead of going through `npm run dev` at all ([scripts/gateway-lifecycle.mjs:63-76](../../scripts/gateway-lifecycle.mjs)). This also removes `npm` as a runtime dependency on the target machine entirely - only `node` itself needs to be present, matching the user's own decision (see M2_016's env vars / Known Limits) to keep Node.js as a documented prerequisite rather than bundling it.

### Bug 3 (found, NOT fixed this slice): startup is a real race

After both bugs above were fixed and live-verified (`GET /health` → `200 OK`, `ok: true`, `browserCdp: "available"`), the user asked why the app needs a UI-blocking dependency on the Gateway being up at all - a fair critique. Re-reading `lib.rs`'s `setup()` confirmed a genuine, independent race: `WebviewWindowBuilder::new(...).build()` creates the window and kicks off navigation to `http://127.0.0.1:3000` *before* `gateway_lifecycle::start_gateway()` is even called, let alone before it returns (it can block up to `GATEWAY_STARTUP_TIMEOUT_MS`, default 12000ms, waiting for `/health`). Nothing reloads the webview once the Gateway does come up. In practice: every cold start briefly (or not-so-briefly, on a slow machine) shows a real browser "can't connect" error page, even when everything is otherwise working correctly.

This is a real, separate issue, not fixed in this slice - see [10_startup-race-quick-fix-plan.md](../design/10_startup-race-quick-fix-plan.md) and [11_startup-splash-screen-proper-fix-plan.md](../design/11_startup-splash-screen-proper-fix-plan.md) for two alternative follow-up plans, per the user's explicit request to plan rather than guess at an implementation now. **Fixed - see [M2_017](M2_017_startup-race-quick-fix-implemented.md), design/10's plan was chosen and implemented, timing-verified live.**

### Bug 4: `public/` was never bundled at all - discovered *after* M2_017, not by checking `/health`

After Bug 3 was fixed (M2_017) and re-verified via `/health`, the user reported the UI itself still showing `{"ok":false,"error":"not found"}` - the exact same generic 404 shape from `routes.js:118` seen once before, this time persisting. Checking `GET /` directly against the running instance confirmed it: the entire `public/` directory (`index.html`, `app.js`, `styles.css` - the whole UI) was missing from `bundle.resources` in `tauri.conf.json`. Every request for the page itself, not just some API route, hit the same catch-all 404. `gateway/src/api/routes.js`'s `publicDir = path.join(config.rootDir, 'public')` ([routes.js:22](../../gateway/src/api/routes.js)) had nothing to find.

**This bug was actually present since Bug 1/2's original fix and build** - it just went uncaught because every round of verification in this slice checked `GET /health` (a pure JSON API endpoint, unaffected by `public/` being missing) and never actually loaded the real page. A real methodology gap: verifying the backend is healthy is not the same as verifying the app is usable. Fixed by adding `"../public": "public"` to `bundle.resources` alongside the existing entries. Verified live without a rebuild first (`sendStaticFile` reads from disk per request, no caching) by copying `public/` directly into the running build's output directory and re-requesting `GET /` and `GET /dev/app.js` - both returned real content immediately. A full rebuild with the fix baked in from source followed.

## Files Changed Or Added

- `src-tauri/tauri.conf.json`: `bundle.active: true`, `bundle.targets: ["nsis"]`, `bundle.icon` (populated), `bundle.resources` (maps `../gateway`, `../scripts`, `../public`, `../server.js`, `../package.json` into the bundle - `../public` added late, by Bug 4).
- `src-tauri/src/gateway_lifecycle.rs`: `project_root()` rewritten - debug builds keep `CARGO_MANIFEST_DIR`; release builds resolve from `current_exe()`, checking both a nested `resources/` layout and the exe's own directory.
- `scripts/gateway-lifecycle.mjs`: `start()` now spawns `process.execPath` directly instead of `npm run dev`.
- `src-tauri/icons/*`: full icon set regenerated (`icon.ico`, `32x32.png`, `128x128.png`, `128x128@2x.png`, plus the platform sets `tauri icon` produces alongside them) from a freshly hand-built valid source PNG - the pre-existing `icon.png` was corrupt (confirmed: `tauri icon` failed with a PNG deflate-stream error) and had evidently never been exercised before, since `bundle.active` was `false` this entire project until now.
- `.gitignore`, git history: none touched this slice (nothing committed yet - see Next Action).

## Design Patterns Used

- **Live evidence over documentation, twice in a row.** Both Bug 1's initial fix and its correction came from directly inspecting the actual build output on disk rather than trusting Tauri's own written docs a second time after the first doc-based guess turned out wrong for this specific build path.
- **Isolate before diagnosing further.** Bug 2 was found by noticing the *sibling* mechanism (browser-lifecycle) worked while gateway-lifecycle didn't, despite sharing the same `project_root()` - narrowing the search to what differs between the two, rather than re-guessing at the already-fixed path-resolution code.
- **Don't touch what already works.** `scripts/browser-lifecycle.mjs` was read and confirmed correct, not modified defensively.
- **A placeholder is fine, a broken placeholder is not.** The corrupt source icon had clearly sat unexercised in the repo for a long time; fixed with a genuinely valid (if simple/placeholder) replacement rather than leaving `bundle.active` unable to run at all.
- **Ask before a big, hard-to-reverse system install; adapt when the user has better local context than the plan assumed.** The original plan was "install Rust + MSVC Build Tools on Windows." The user's "I already have it in WSL" correction was true and led to a strictly better path (no new system-level install of anything on the Windows side at all).

## Verification Commands Or Acceptance Checks

```bash
# WSL - toolchain (user ran the sudo-gated parts themselves)
sudo apt install -y mingw-w64 nsis
rustup target add x86_64-pc-windows-gnu
# ~/.cargo/config.toml: [target.x86_64-pc-windows-gnu] linker = "x86_64-w64-mingw32-gcc"

# WSL - build
cd /mnt/d/Github/ZeroClaw-Vbee-Automate
npx tauri build --target x86_64-pc-windows-gnu
```

Live, Windows-native, after both bugs fixed:

```
./src-tauri/target/x86_64-pc-windows-gnu/release/voicefactory-desktop.exe
curl http://127.0.0.1:3000/health
```

Result: `HTTP/1.1 200 OK`, `{"ok":true,"gateway":"running","db":"ok","browserCdp":"available",...}` - confirmed live via `curl -v`, not just a green light in the window. Final official build (both fixes compiled in from source, not the manual file-copy used mid-session for fast iteration) produced:

```
src-tauri/target/x86_64-pc-windows-gnu/release/bundle/nsis/VoiceFactory_0.0.1_x64-setup.exe
```

## Known Limits

- **The NSIS installer itself was never actually run/installed.** All live verification ran the raw `voicefactory-desktop.exe` from the build output directory directly (matching what the user did when the original bug was reported). The installer's own install-time behavior (where NSIS *actually* places `bundle.resources` - the `resources\` nested case `project_root()` also now handles, but which the code comments explicitly flag as "documented, not yet independently confirmed live") remains unverified. If it turns out to differ from both cases already handled, the app would fail the same way again on a machine that used the real installer instead of the raw exe.
- **Cross-compilation from Linux to a Windows NSIS target is explicitly "experimental" per Tauri's own documentation** - it worked here, but is a less-traveled path than building natively on Windows, and signing is skipped entirely (`Warn Signing, by default, is only supported on Windows hosts`).
- **Never tested on a genuinely different second machine.** Every test this slice ran the built binary on the same machine that built it.
- **Node.js and Brave remain unbundled, required prerequisites on any target machine** - a deliberate scope decision (see the equivalent AskUserQuestion earlier this session), not an oversight.
- **The icon is a placeholder** (a simple generated teal waveform glyph, not real branding) - functional, not final.
- **Bug 3 (startup race) and Bug 4 (`public/` unbundled) are both now fixed** - see [M2_017](M2_017_startup-race-quick-fix-implemented.md) for Bug 3's verification. Bug 4 was verified live against the running (already-fixed-for-Bug-3) instance via the disk-copy trick described above; a from-source rebuild with the fix was still pending at the time this doc was last edited - confirm the final rebuild's log before treating Bug 4 as closed for the *shipped* binary, not just the manually-patched test instance.
- **This slice's own verification methodology had a real gap**: checking `/health` repeatedly gave false confidence that "the app works," while the actual page (`GET /`) was 404 the entire time until Bug 4 was found. Worth remembering for any future packaging change - verify the thing a human actually looks at, not just a health-check endpoint.
- **Nothing from this slice is committed to git yet.**

## Next Action

Confirm the from-source rebuild (with `../public` now in `bundle.resources`) actually completed and that a *fresh* launch (not the manually disk-patched instance) serves `GET /` correctly. Beyond that: test the actual NSIS installer (not just the raw exe) end to end; test on a genuinely separate machine; decide whether real code signing matters before this goes to anyone outside this one dev machine.
