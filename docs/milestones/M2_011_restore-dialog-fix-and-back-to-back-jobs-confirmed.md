# M2_011 - Phase C: Restore-Dialog Fix - Back-To-Back Jobs Confirmed Live

Milestone: `M2 - Browser CDP Health And Vbee Preview Harness` (continues Phase C from M2_010)

Date: 2026-09-09

## Workflow

```mermaid
flowchart TD
  UserEvidence["User inspects the real DOM and pastes the actual\nrestore-dialog markup: data-id=\"reload-prev-session\"\n/ \"not-reload-prev-session\""] --> FirstFix["Wire ensureStudioPage: reload,\nthen wait up to 5s for the dialog\nand click it if present"]
  FirstFix --> StillFails1["Live retry still fails: 'session signal\nnot found' - #try-listening never appears"]
  StillFails1 --> Isolated["Isolated test against the live page:\nthe exact same selector click DOES work\nwhen run standalone"]
  Isolated --> RestartTheory["Restarted the Gateway to force a fresh\nconnectOverCDP() - still fails identically"]
  RestartTheory --> RootCause["Real cause found: two separate fixed-window\nwaits (5s dialog, 10s button) can each\nindividually miss a dialog that renders\nseveral seconds after reload()'s load event"]
  RootCause --> RealFix["Fix: single poll loop watching for EITHER\nsignal together (dialog present -> click;\nbutton present -> already hydrated), 15s budget"]
  RealFix --> UnitTests["35/35 unit tests pass"]
  UnitTests --> JobA["Real Gateway job A: succeeds"]
  JobA --> JobB["Real Gateway job B, submitted immediately\nafter A finished, zero manual steps: succeeds"]
  JobB --> Doc["Document as M2_011;\ncorrect M2_010's Known Limits"]
```

## Module / Slice Under Test

M2_010 left back-to-back jobs in the same browser tab as an open, unresolved problem, having reverted two failed fix attempts live. The user directly inspected the actual restore-content dialog's DOM (via their own DevTools) and supplied its real markup - `data-id="reload-prev-session"` on the "Đồng ý" button, `data-id="not-reload-prev-session"` on "Hủy" - which M2_010 never had (its own `[data-testid="CloseIcon"]` guess was for a *different* problem, the leftover player bar, and was never shipped). This slice wires that selector in, hits and resolves a further timing bug in doing so, and confirms live that two real jobs can now run back-to-back with no manual recovery step in between - the thing M2_010 explicitly could not yet claim.

## What Was Implemented

### `defaultEnsureStudioPage` now handles the restore dialog, using the user-supplied selector

`gateway/src/vbee/adapters/vbee-preview.js` brings back the "always reload" behavior M2_010 had reverted, this time paired with real handling for the dialog that reload can trigger:

```js
async function defaultEnsureStudioPage(page) {
  const currentUrl = page.url();
  if (currentUrl.startsWith(VBEE_STUDIO_URL)) {
    await page.reload();
  } else {
    await page.goto(VBEE_STUDIO_URL);
  }

  const restoreDialogButton = page.locator('[data-id="reload-prev-session"]');
  const previewButton = page.locator(PREVIEW_BUTTON_SELECTOR);
  const deadline = Date.now() + STUDIO_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await restoreDialogButton.count()) {
      await restoreDialogButton.click();
      break;
    }
    if (await previewButton.count()) break;
    await page.waitForTimeout(STUDIO_READY_POLL_MS);
  }
}
```

Always agrees to restore ("Đồng ý") rather than choosing "Hủy": `injectPreviewText` already clears the editor with its own `Control+A`/`Delete` before typing new content regardless of what got restored, so the choice only matters for getting the dialog out of the way, not for what ends up in the editor.

### The real bug: two sequential fixed-window waits can each individually miss a delayed dialog

The first version of this fix (a 5-second `waitFor` for the dialog, then separately a 10-second `waitFor` for `#try-listening` in `defaultExtractSessionToken`) failed live, repeatedly, with the same "session signal not found" error M2_010 had already seen. Isolating the exact same selector/click logic in a standalone script against the live page showed it worked perfectly on its own - which ruled out the selector and pointed at *timing* instead.

The actual mechanism: `page.reload()` resolves on the browser's `load` event, but the dialog is rendered by the React app's own post-load logic, which can take several seconds longer. A `waitFor(dialog, {timeout: 5000})` that starts right after `reload()` returns can time out and give up a moment *before* the dialog actually appears. Once the code has already moved on to the (previously separate) button wait, that just-appeared dialog sits there blocking `#try-listening` for the entirety of *that* window too - so both fixed windows fail for the same underlying reason, just at different points in the flow.

**Fix:** replaced the two independent waits with a single loop (`STUDIO_READY_TIMEOUT_MS = 15000`, polling every `STUDIO_READY_POLL_MS = 500`) that checks for *both* signals together on every iteration, so there is no gap where a dialog that appears "late" can be missed. `defaultExtractSessionToken` was separately hardened to wait (bounded, 10s) for `#try-listening` rather than doing an instant snapshot `count()` check, as defense in depth against the same class of hydration race regardless of what triggered the navigation.

### A red herring worth naming: "Target page, context or browser has been closed"

At one point a retry failed near-instantly with this Playwright error instead of the usual timeout. `PlaywrightCdpAdapter.connect()` caches its `browser` handle for the Gateway process's entire lifetime (`if (this.browser) return this.browser;`) and never reconnects. This session's manual testing methodology involved dozens of short-lived standalone scripts each calling `connectOverCDP()` against the same long-running Brave instance - plausible enough to leave a long-lived cached session pointing at a stale/detached target. Restarting the Gateway process (forcing a fresh `connect()`) made it disappear immediately and it did not recur. Treated as an artifact of this session's testing approach, not a defect in the adapter - a real deployment would not have many competing debug connections churning against the one browser it depends on.

## Files Changed Or Added

- Modified: `gateway/src/vbee/adapters/vbee-preview.js` (`defaultEnsureStudioPage` reloads and polls for the restore dialog / hydrated button together; `defaultExtractSessionToken` waits instead of snapshotting; two new module constants `STUDIO_READY_TIMEOUT_MS`/`STUDIO_READY_POLL_MS`), `gateway/src/vbee/adapters/vbee-preview.test.js` (`fakePlaywrightPage` gained `hasRestoreDialog`, a `count()`-based restore-dialog locator, `waitForTimeout`, and a `waitFor` on the preview-button locator; `ensureStudioPage`'s tests updated for reload-always and dialog-dismiss behavior; `extractSessionToken`'s existing tests needed no changes).
- Added: `docs/milestones/M2_011_restore-dialog-fix-and-back-to-back-jobs-confirmed.md` (this file).
- Modified: `docs/milestones/M2_010_selection-gated-preview-confirmed-real-e2e-audio.md` (correction note on the multi-job "Known Limits" bullet), `docs/README.md` (index entry).
- Not part of this repo (referenced only), at `D:\Programs\vbee-cdp-driver\`: `test-dialog-selector.mjs` (isolated confirmation that the user-supplied selector works), `screenshot-now.mjs` (reused from M2_010).

## Design Patterns Used

- **Isolate before re-theorizing**: when the first fix still failed live, the next step was testing the exact same selector/click logic in complete isolation (a tiny standalone script) rather than immediately guessing at a second explanation. That test coming back clean was what redirected the investigation from "is the selector wrong" to "is this a timing race" - the actual answer.
- **Watch signals together, not in sequence, when either can legitimately arrive first or late**: the two-fixed-window design looked reasonable but encoded an assumption (the dialog, if it appears, appears promptly) that live evidence contradicted. A single loop checking both conditions per iteration has no such assumption.
- **Verify the fix against the specific scenario that motivated it**: M2_010 could not claim back-to-back reliability because it never got a second job to succeed. This slice does not call itself done on job A alone - job B, submitted immediately after A with no restart and no manual step, is the actual evidence.

## Verification Commands Or Acceptance Checks

```bash
# WSL Debian
source ~/.nvm/nvm.sh && nvm use 24
npm run test:m2
```

Result: **35/35 tests pass** (unchanged count from M2_010 - this slice modified existing `ensureStudioPage`/`extractSessionToken` tests rather than adding new ones, since the *behavior* being locked in - reload, handle the dialog, wait for the button - is the same shape as before, just corrected).

Real Gateway, Windows-native, `VBEE_ADAPTER=vbee-preview`, same process as M2_010's:

- Job A (a retry of a job M2_010 had left failing): `status: "done"`, real `.mp3` confirmed via `file` (128kbps 24kHz MPEG).
- Job B: submitted via `POST /api/queue` immediately after job A reached `done`, **no Gateway restart, no manual page recovery, no other script touching the page in between**: `status: "done"`, a second real, distinct `.mp3` confirmed the same way.

This is the first time in this investigation two real jobs have completed back-to-back without a human stepping in between them.

## Known Limits

- **The narrow-window mobile-redirect risk from M2_010 is unchanged and still open.** `ensureStudioPage` still calls `page.reload()`/`page.goto()`, which is exactly what was observed (M2_010) to sometimes land on Vbee's `/m/...` mobile layout when the real browser window is narrow. This slice's fix addresses a different failure mode (the restore dialog blocking the button) and happened to be verified while the window was at a width that did not trigger the redirect - it does not address that risk at all.
- **Only two back-to-back jobs have been confirmed.** Real evidence now supports "at least two in a row works," not "arbitrarily many in a row is reliable." Longer unattended runs, and whether the "Hủy"/`not-reload-prev-session` choice would behave any differently over many cycles, remain unverified.
- **The 15-second poll budget is a live-tuned number, not a principled one.** It comfortably covered the delay observed this session; there is no evidence for what the actual worst case is on a slower connection or a heavier account state.
- M2_010's other still-open items are unaffected and carried forward: `audio_link`/window-width dependencies aside, the WSL↔Windows CDP gap (worked around, not fixed) and selectors/protocol being a 2026-09-09 snapshot with no drift detection.

## Next Action

With back-to-back jobs now confirmed, the next natural check is a longer unattended run (more than two jobs) to see whether reliability holds or whether some other residual-state issue appears at job 3, 4, or beyond - the same evidence-gathering approach used throughout this investigation, not a new design. Separately, the narrow-window mobile-redirect risk (still fully open) is worth a deliberate decision rather than continuing to discover it live.
