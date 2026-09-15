# M2_018 - `public/` Never Bundled (Bug 4), Then A Reproducible Cross-Compile Build Failure

Milestone: `M2 - Browser CDP Health And Vbee Preview Harness` (infrastructure/packaging slice)

Date: 2026-09-10

**Status: VERIFIED.** Both Bug 4 and Bug 5 are fixed and confirmed live from a genuine from-source build - not just the manually-patched test instance. Building from WSL's native filesystem (`~/vf-build-tmp`) instead of the `/mnt/d/...`-mounted Windows drive succeeded on the first attempt, strongly (though not 100% conclusively) supporting the Windows-Defender-interference hypothesis. The resulting `voicefactory-desktop.exe` and NSIS installer were copied back into the repo's normal `src-tauri/target/x86_64-pc-windows-gnu/release/` path via `rsync` and re-verified live: `GET /` → 200 (real HTML), `GET /dev/app.js` → 200, `GET /dev/styles.css` → 200, `GET /health` → `ok:true`, `browserCdp:"available"`.

## Workflow

```mermaid
flowchart TD
  Report["User reports the same generic\n{\"ok\":false,\"error\":\"not found\"} JSON\nagain, this time from inside the app's UI"] --> Check["Direct curl against the running\ninstance: GET / itself returns 404,\nnot just some API route"]
  Check --> Bug4["Bug 4 found: public/ (index.html,\napp.js, styles.css - the whole UI)\nwas never added to tauri.conf.json's\nbundle.resources at all"]
  Bug4 --> FastFix["Fast-path fix: copy public/ directly\ninto the already-running build's output\ndir - GET / and /dev/app.js immediately\nreturn real content, no restart needed\n(sendStaticFile reads per-request)"]
  FastFix --> ConfigFix["Real fix: add \"../public\": \"public\"\nto bundle.resources in tauri.conf.json"]
  ConfigFix --> Rebuild1["Rebuild from source - FAILS:\nPermission denied (os error 13) writing\nresource.lib, exact same path, 4 times\nin a row across different mitigations"]
  Rebuild1 --> Tried1["Tried: kill all running app instances\n(release any file lock) - still fails"]
  Tried1 --> Tried2["Tried: delete the stale resource.lib\ndirectly (succeeded, proving it was NOT\nactually locked at rest) - still fails"]
  Tried2 --> Tried3["Tried: wipe the whole intermediate\nbuild/voicefactory-desktop-* directory\n(rule out corrupted cache) - still fails,\nidentical error 4th time"]
  Tried3 --> Diag["Checked Windows Defender: real-time\nprotection is ON, can't view/change\nexclusions without admin - a plausible,\nunconfirmed cause (AV scanning a\nfreshly-written .lib mid-build is a\nknown class of Windows build flakiness)"]
  Diag --> Decision["Decision: don't touch Defender/security\nsettings (out of bounds without admin\nand without the user's explicit say-so)\n- instead move the build to WSL's own\nnative filesystem, bypassing the\nDrvFs-mounted D: drive entirely during\nthe write"]
  Decision --> Pending["rsync the working tree (minus .git,\nnode_modules, target, data) to\n~/vf-build-tmp, fresh npm install,\nrebuild there - IN PROGRESS,\nresult not yet known"]
```

## Bug 4: `public/` never bundled - the actual cause of the recurring "not found" the user kept seeing

Full detail already folded into [M2_016](M2_016_windows-installer-packaging-two-startup-bugs-found-fixed.md#bug-4-public-was-never-bundled-at-all---discovered-after-m2_017-not-by-checking-health) (Bug 4 section, added there rather than duplicated here, since it belongs to the same investigation thread). Short version: `gateway/src/api/routes.js`'s `publicDir = path.join(config.rootDir, 'public')` had nothing to find, because `tauri.conf.json`'s `bundle.resources` only ever listed `gateway/`, `scripts/`, `server.js`, `package.json` - the actual frontend (`public/`) was omitted from the very first config edit in M2_016 and stayed missing through every fix since, because every round of "did it work" verification checked `GET /health` (a JSON API route, unaffected) and never actually loaded the page a human would see. **This is the real, root explanation for the `{"ok":false,"error":"not found"}` the user reported twice** - not a one-off fluke, not a different bug each time; the same missing directory, hit two different ways (first ambiguous, no follow-up; second time, directly through the actual UI).

Fixed in config: `"../public": "public"` added to `bundle.resources`. Verified live *without rebuilding* by copying `public/` straight into the already-built output directory and re-requesting `GET /` / `GET /dev/app.js` against the still-running Gateway process - both returned real content immediately, confirming the fix is correct and that `sendStaticFile` has no caching that would mask it. **Not yet verified from a clean, from-source rebuild** - that rebuild is what then hit Bug 5.

## Bug 5 (or: an environment issue, not a code bug - genuine cause unconfirmed): reproducible `Permission denied (os error 13)` writing `resource.lib`

Rebuilding after Bug 4's config fix (to get a properly from-source build, not just the manually patched test instance) failed identically four consecutive times:

```
cargo:rustc-link-arg-bins=.../voicefactory-desktop-d92da27b1ae19243/out/resource.lib
Permission denied (os error 13)
--- stderr
Final verdict: crate has binaries: true
failed to build app: failed to build app
```

**Also worth flagging on its own: `npx tauri build`'s own process exit code was `0` on every one of these four failed attempts.** `tail`-piping the output previously produced a misleading "success" once before (M2_017's first rebuild attempt hit the same trap for a different reason - a file lock, that time genuinely caused by a still-running test instance). This time the exit code was checked directly (no pipe), and it was *still* `0` despite the build visibly failing and printing its own `Error failed to build app` line. **Lesson, now confirmed twice: never trust `npx tauri build`'s exit code alone - always grep the log for `Finished 1 bundle at` (success) or an explicit `Error` line, regardless of how the exit code is captured.**

### What was ruled out, in order, with evidence for each

1. **A running instance holding the file lock** (the exact cause of M2_017's earlier false-positive). Killed every `voicefactory-desktop.exe`/related `node.exe`/related `brave.exe` process, confirmed zero remained via `Get-CimInstance`, rebuilt - identical failure. Not this.
2. **A genuinely stuck OS-level lock on `resource.lib` itself.** Directly deleted the file from Bash between attempts - succeeded with no error, which a real held lock would have refused. Not a persistent lock at rest.
3. **Corrupted/stale intermediate build-script cache.** Deleted the entire `target/x86_64-pc-windows-gnu/release/build/voicefactory-desktop-*` directory (not just the one file) before retrying - identical failure, same exact path, same exact error. Not stale cache.

### Suspected but not confirmed: Windows Defender real-time scanning

`Get-MpComputerStatus` confirms real-time protection is active; `Get-MpPreference`'s exclusion list could not be read without administrator rights. A freshly-written build artifact getting locked momentarily by antivirus real-time scanning is a well-documented category of Windows build flakiness, and would plausibly explain a failure that (a) isn't a genuine held lock at rest, (b) survives clearing all intermediate state, and (c) reproduces consistently for the *same* operation each time rather than being pure random noise. **This is the leading hypothesis, not a confirmed root cause** - it was not proven, only left standing after every checkable alternative was ruled out with direct evidence.

### Mitigation chosen: build from WSL's own native filesystem instead of the `/mnt/d/...`-mounted Windows drive

Changing Windows security/antivirus settings was deliberately not attempted - that falls under "modifying system or security settings," out of bounds without the user explicitly doing it themselves, and not something to reach for on a hypothesis alone regardless. Instead: `rsync`'d the working tree (excluding `.git`, `node_modules`, `src-tauri/target`, `data`, `.local` - source only) into `~/vf-build-tmp` on WSL's own virtual disk, ran a fresh `npm install` there, and re-ran the identical `tauri build` command from that native path. This sidesteps Defender's real-time hook on the DrvFs-mounted Windows drive entirely during the write, win or lose on the actual hypothesis above - a standard, independently-known WSL performance/reliability practice (build on the native Linux filesystem, not the Windows-mounted one) regardless of whether Defender turns out to be the real cause.

**Resolved.** The WSL-native build (`~/vf-build-tmp`) succeeded on the first attempt (`Finished 1 bundle at ...`), copied back to the repo's normal path via `rsync -a` (the accompanying `--delete` pass separately failed on unrelated, pre-existing `.local/runtime/brave-profile/*` LevelDB/SQLite files from earlier live testing - Chrome/Brave profile internals holding their own Windows-side locks/attributes, a different and expected friction, not a repeat of Bug 5; the actual new build artifacts copied over correctly regardless, confirmed by timestamp and a live functional test). Live verification: `GET /`, `/dev/app.js`, `/dev/styles.css` all `200`; `/health` reports `ok:true`.

This does not *prove* Windows Defender was the exact mechanism - only that building off the Windows-mounted drive reliably works where building on it reliably failed, four times, in this session. Treat Defender as the leading explanation, not a confirmed fact.

## Files Changed Or Added

- `src-tauri/tauri.conf.json`: `bundle.resources` gains `"../public": "public"` (see M2_016's Bug 4 section for the full entry).
- `docs/milestones/M2_016_...md`: amended in place (still uncommitted) to add the Bug 4 section and update Known Limits/Next Action - not duplicated here.
- Nothing in `src-tauri/src/*.rs` or `scripts/*.mjs` changed by this slice - Bug 5 (if Defender-caused) is an environment issue, not a code fix.
- `~/vf-build-tmp` (WSL-native, outside the repo): a working-tree copy used only to test the build location hypothesis - not part of the repo, not meant to be a permanent parallel build location unless Bug 5's cause is confirmed and this is adopted as the standard build path going forward.

## Design Patterns Used

- **Rule out with direct evidence, in order of cheapest-to-check first**, rather than jumping straight to the first plausible-sounding cause. Each of the three ruled-out hypotheses above was eliminated with a specific, falsifiable check, not assumed away.
- **Don't reach for a system-settings change on a hypothesis.** Defender exclusions would need admin rights and a real security-posture decision - correctly left to the user rather than attempted or even strongly recommended without more certainty.
- **Say "unconfirmed" instead of "fixed" when it's actually unconfirmed.** This doc is being written *before* knowing whether the mitigation worked, specifically so an honest, checkable record exists either way - continuing this project's established pattern of not claiming success ahead of evidence.

## Known Limits

- **Bug 5's root cause is a hypothesis, not a confirmed fact.** Defender is the leading suspect only because every checkable alternative was ruled out and the native-filesystem workaround worked, not because it was directly observed causing the failure.
- **The WSL-native-filesystem workaround sidesteps the problem rather than fixing an underlying cause on the Windows-mounted path.** Building directly against `/mnt/d/...` (the repo's normal location) may keep hitting this on a future rebuild - not re-tested after the workaround succeeded, since there was no need to once a working build existed. If it recurs, `~/vf-build-tmp`-style native builds (or a real Defender exclusion, added by the user, for the `target/` build directory) are the two known ways out.
- `rsync --delete`'s failure on stale `.local/runtime/brave-profile/*` files is a separate, minor, already-understood friction (Chrome/Brave profile internals) - left as leftover cruft in the repo's build output rather than force-cleaned, harmless since the app itself regenerates/reuses that directory at runtime regardless of what's already there.
- The build now used for live verification lives at `~/vf-build-tmp` (WSL-native, outside the repo) with its own copy of the working tree - it will drift from the real repo on any future source edit unless re-synced or abandoned in favor of always building from `/mnt/d/...` again.

## Next Action

None required for this bug - both Bug 4 and Bug 5 are resolved and verified. Worth a conscious decision (not urgent) on whether WSL-native builds become this project's standard practice for Windows packaging going forward, given they've now proven more reliable than the Windows-mounted-drive path. Nothing from M2_016, M2_017, or this slice is committed to git yet.
