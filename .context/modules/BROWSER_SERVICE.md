# Browser Service Context

<!-- AUTO_START -->
[auto] Manual context only. Browser service is introduced in M2 to keep browser/CDP details outside JobRunner.
<!-- AUTO_END -->

<!-- MANUAL_START -->
## [manual] Design Decisions

Browser automation must sit behind a BrowserService boundary. M2 starts with CDP health only, not live page automation.

The first adapter uses the Chrome DevTools HTTP endpoint:

```text
GET <CDP_URL>/json/version
```

This avoids installing Playwright or launching a browser while still validating whether a browser CDP target is reachable.

## [manual] Invariants & Constraints

JobRunner must not import browser automation, CDP clients, Playwright, browser launchers, or provider-specific browser details.

Browser CDP failure must degrade Gateway health, not crash Gateway.

The adapter must not write SQLite.

The adapter must not own Vbee credentials, provider protocol logic, or audio finalization.

## [manual] Test Strategy

Use Node built-in tests for adapter/service behavior.

Required cases:

- unreachable CDP URL returns unavailable health
- healthy CDP JSON returns available health
- `/health` can report CDP unavailable without throwing

Do not require a live browser for automated tests.

## [manual] Behavior chua implement (TODO)

Connecting to pages, evaluating scripts, intercepting network/WebSocket frames, and browser session reuse are not implemented yet.

Camoufox and Patchright adapters are future options, not M2 defaults.
<!-- MANUAL_END -->
