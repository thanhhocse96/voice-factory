# M2_014 - Voice & Speed Selection: Investigation Findings, Deferred By Decision

Milestone: `M2 - Browser CDP Health And Vbee Preview Harness` (investigation only — no adapter code shipped this slice)

Date: 2026-09-10

## Workflow

```mermaid
flowchart TD
  UserFlag["User flags a real gap: VbeePreviewAdapter\nnever selects voice/speed - jobs just use\nwhatever is already active in the Vbee UI"] --> InvestigateVoice["Live DOM investigation:\nfind the voice-picker trigger and dialog"]
  InvestigateVoice --> FoundVoiceSelector["Found: [data-id=\"open-voice-list\"] opens a\nreal dialog, rows are .voice-info-container\nwith a \"Sử dụng\" button each"]
  FoundVoiceSelector --> NoCode["But: no data-* attribute anywhere carries\nthe internal voice_code - only the Vietnamese\ndisplay name is in the DOM"]
  NoCode --> InvestigateSpeed["Investigate speed: NOT inside the voice\ndialog at all (a slider found there turned\nout to be an unrelated audio-preview scrubber)"]
  InvestigateSpeed --> FoundSpeedField["Found via a different trigger entirely:\n[data-id=\"open-punct-duration\"] -> a text\nfield placeholder=\"Tốc độ đọc\", value \"1.05x\""]
  FoundSpeedField --> ClickBlocked["Clicking that field to edit it is reproducibly\nblocked - Playwright reports the dialog's own\ncontainer intercepting the click, 3 attempts,\nsame result each time - not yet diagnosed"]
  ClickBlocked --> AskUser["Asked the user how to handle the voice_code\nmapping gap"]
  AskUser --> Decision["Decision: defer both voice and speed\nautomation - ship what already works\n(content generation) as the MVP first,\nresearch a direct-API approach later"]
  Decision --> Doc["Document findings as M2_014 so this\ninvestigation isn't repeated from scratch"]
```

## Module / Slice Under Test

After Phase D (M2_013), the user reviewed the running UI and flagged that `VbeePreviewAdapter` has a real, unaddressed gap underneath its proven text-to-audio path: it never actually selects a voice or sets a speed in the real Vbee Studio UI. `job.voice_code`/`job.speed` are recorded and passed through the normalized adapter contract, but nothing in `defaultInjectPreviewText`/`defaultTriggerPreview` (or anywhere else in `vbee-preview.js`) touches Vbee's own voice or speed controls — every job silently uses whatever voice/speed happens to already be active in the shared Brave session. This slice is a live investigation into what it would take to close that gap, per the user's own warning that both controls are behind popups that are hard to work with. It ends in a deliberate decision to defer implementation, not a shipped feature — the value here is the documented findings, so the next attempt starts from real evidence instead of from scratch.

## What Was Found

### Voice selector: real trigger and row structure, but no stable code-to-row mapping

`[data-id="open-voice-list"]` (`aria-label="Chọn giọng đọc"`, also has a plain `id="voice"`) opens a real MUI Dialog (`.voice-list-container-result`). Each voice is a `.voice-info-container` row (20 rendered in the default/unfiltered view, not virtualized on scroll) with a "Sử dụng" ("Use") button. A search box exists (`placeholder="Tìm kiếm bằng từ khóa liên quan"`) but a `.fill()` attempt against it returned zero matching rows afterward — not yet diagnosed whether that needs real keystrokes (the same lesson `injectPreviewText` already learned from Draft.js) or something else entirely.

**The real blocker:** no `.voice-info-container` row, nor any of its ancestors up to 8 levels, carries any `data-*` attribute identifying the voice. The only identifying information in the DOM is the Vietnamese display name text (e.g. "Pha Lê Rạch Giá", "HN - Ngọc Huyền"). Meanwhile, this project's existing `voice_code` values (e.g. `s_travinh_male_truongdoctin_news_vc`) are Vbee's real internal slug format — confirmed independently via a live network capture of `GET https://vbee.vn/api/v1/voice-leaderboard-events`, whose JSON body contains a `voice_code` field in exactly that shape. So the slug format is real and Vbee-native, but nothing observed so far connects a given slug to a specific row in this dialog. A few network-capture attempts to catch the actual voice-catalog fetch (as opposed to this unrelated leaderboard endpoint) came back empty - the catalog data appears to already be loaded/cached before the dialog opens rather than fetched fresh per open, which means catching it needs a careful fresh-page-load capture that wasn't nailed down this session.

### Speed: a completely different control than voice, itself gated behind another popup

Initially, a `.MuiSlider-root` found *inside* the voice dialog looked like a promising speed control - it was not. Its `aria-valuemax="2112"` and a preceding sibling text of `"00:00"` identify it as an audio-preview scrubber (playback position for previewing a voice sample), unrelated to TTS speed. The real control lives behind an entirely separate trigger, `[data-id="open-punct-duration"]`, which opens a "Thiết lập ngắt nghỉ" (pause/break settings) dialog. That dialog contains per-punctuation pause durations (Dấu chấm/phẩy/chấm phẩy, Xuống dòng) plus a field with `placeholder="Tốc độ đọc"` whose value was `"1.05x"` at the time of inspection - an exact match to this project's own default speed (`1.05`), strong confirmation this is the right control, not a guess.

That field turned out to be a MUI Autocomplete input (`aria-autocomplete="list"`, `MuiAutocomplete-input` classes), not a plain text field - consistent with the user's own warning that this needs a click before its real option list renders. Attempting to click it to test the value directly failed three separate times with the identical Playwright error: the dialog's own `MuiDialog-container` reported as intercepting pointer events for a click targeted at an element inside that same dialog. This is a distinct, reproducible symptom from the previously-solved "stray backdrop" issue (a leftover invisible popover from earlier in this long debugging session, cleared once via a forced click on it) - the punct-duration dialog's blocking behavior recurred fresh across separate dialog opens, so it is not simply leftover cruft from that same stray element. Root cause is not yet diagnosed.

### A real, separately-caused issue also found and fixed in passing

Before any of the above could be tested, a leftover invisible `MuiBackdrop-root` from a `popover-date-range-picker` (almost certainly the date-range filter on the "Danh sách chuyển đổi" conversion-history table, from earlier in this long session's manual testing) was found blocking clicks page-wide. `page.keyboard.press('Escape')` did not dismiss it; a forced click directly on the backdrop element did. This was a real, live-reproducible click-interception state (Playwright's actionability check refused the click exactly as a real mouse click would have been refused), not a testing artifact - worth remembering as a recurring failure shape (an invisible modal backdrop left mounted after some earlier interaction) distinct from the residual-player-bar and restore-dialog problems already solved in M2_010/M2_011.

## Decision

Asked the user directly how to handle the voice_code-to-row mapping gap (manual mapping table vs. deeper network-capture research vs. changing the `voice_code` convention to match display names). The user's answer: prioritize shipping an MVP that is already usable for generating content, and revisit voice/speed selection later with deeper research - possibly a direct-API approach rather than DOM automation, echoing M2_009's originally-shelved direct-API pivot. Given speed hit its own unresolved click-interception blocker independent of the voice mapping question, this session did not implement either `selectVoice` or `selectSpeed` as adapter steps. `VbeePreviewAdapter` is unchanged by this slice - it still relies on whatever voice/speed is already active in the shared Brave session, exactly as it did after M2_012.

## Files Changed Or Added

- None in the repo. Added: this milestone doc.
- Not part of this repo (referenced only), at `D:\Programs\vbee-cdp-driver\`: `inspect-voice-speed-controls.mjs`, `inspect-voice-popup.mjs`/`-v2`, `clear-stray-backdrop.mjs`, `inspect-voice-list-detail.mjs`, `inspect-voice-row-and-slider.mjs`, `inspect-voice-full.mjs`, `inspect-voice-code-and-speed.mjs`, `inspect-settings-area.mjs`, `inspect-punct-duration.mjs`, `inspect-voice-api.mjs`/`-v2`, `inspect-voice-catalog-api.mjs`/`-v2`, `test-set-speed.mjs`, `inspect-speed-autocomplete.mjs`, `close-any-dialog.mjs`, `check-state-now.mjs`.
- `public/index.html` / `public/app.js` / `public/styles.css`: unrelated small UI fixes from the same conversation turn - "Incognito preview" relabeled "🕶️ Incognito Mode", and the Queue table's Text column now truncates to one line (`.cell-truncate`, `vertical-align: middle`) instead of wrapping to uneven row heights. Verified live in-browser (label text and computed styles read back via DOM inspection). Unrelated to the voice/speed investigation but landed in the same session.

## Design Patterns Used

- **Investigate live before designing, exactly as established for the original DOM-automation work.** Every selector named above (`data-id="open-voice-list"`, `.voice-info-container`, `data-id="open-punct-duration"`, `placeholder="Tốc độ đọc"`) came from direct inspection of the real page, not from guessing at plausible-sounding names.
- **A value match as corroborating evidence, not just a plausible label.** The speed field's `"1.05x"` value matching this project's own default was treated as real confirmation of having found the right control, the same evidentiary standard used throughout this investigation (e.g. M2_010's `audio_link` cookie-less-fetch confirmation via plain `curl`).
- **Don't force a fragile automation path just because a deadline-shaped decision is pending.** Rather than shipping a guessed voice-matching heuristic (e.g. fuzzy-matching `voice_code` substrings against display names) to "have something," the gap is left honestly unaddressed pending the user's own preferred direction (an API-based approach) - matching this project's repeated pattern of reverting or declining half-verified fixes rather than shipping them.

## Verification Commands Or Acceptance Checks

None applicable - no code shipped this slice. The Gateway was confirmed still healthy (`GET /health` → `ok:true`) and the job queue confirmed to have no orphaned/interfered-with jobs after this investigation's live DOM interactions on the shared Brave session.

## Known Limits

- **Voice selection remains entirely unautomated.** `job.voice_code` still has zero effect on which voice actually synthesizes a job's audio - jobs use whatever voice is already active in the shared browser, same as every milestone since M2_007.
- **Speed selection remains entirely unautomated**, for the same reason, plus its own distinct unresolved click-interception bug on top.
- **The click-interception issue on the punct-duration dialog's speed field is unexplained.** Three attempts, identical symptom each time. Worth a more targeted low-level investigation next time (e.g. `document.elementFromPoint` at the click coordinates to see what's actually on top, or trying keyboard-only Tab-based focus instead of a mouse click) rather than repeating the same click approach.
- **The voice-catalog network response was never actually captured.** Only an unrelated leaderboard endpoint (`voice-leaderboard-events`) was seen; the request that actually populates the 20 visible rows appears to fire before any capture window this session managed to attach in time. A careful fresh-page-load capture, timed from before the very first network request, is the natural next attempt if the API-based direction is pursued.
- The stray invisible backdrop issue (unrelated `popover-date-range-picker`) is very likely an artifact of this specific long-running manual-testing session rather than something a fresh session would hit - not confirmed either way.

## Next Action

Per the user's stated direction: no immediate next action on voice/speed - the priority is using the already-proven content-generation path. When this is revisited, the most promising thread is the "inject API" direction the user mentioned (mirroring M2_009's originally-shelved plan to call Vbee's synthesis API directly rather than automating its UI) - if the same API surface that presumably backs `open-voice-list`'s catalog and `open-punct-duration`'s speed setting can be called directly with a real voice_code and speed value, it would sidestep both the DOM-mapping gap and the unexplained click-interception bug at once, the same way M2_010's selection-gate discovery made the original preview-button problem moot rather than patched.
