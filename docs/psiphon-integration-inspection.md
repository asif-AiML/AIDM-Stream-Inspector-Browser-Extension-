# Psiphon Firefox integration: code inspection and milestones

Inspection date: 2026-10-16. Branch: `feat/psiphon-firefox-integration` created from the `main` commit `a491dbf3d64524dd16cb2907a36d1b94eb78925d`. **Documentation only:** no implementation has started.

## Branch ancestry verified before branching

GitHub commit comparisons `main...dev/*` showed all four development branches have **zero commits ahead of main**:

| Branch | Ahead of main | Behind main |
| --- | ---: | ---: |
| `dev/01-foundation` | 0 | 30 |
| `dev/02-traffic-intelligence` | 0 | 16 |
| `dev/03-Raw-Engine-architecture` | 0 | 14 |
| `dev/04-ui-architecture` | 0 | 2 |

Thus all commits from those four published branches are contained in `main`. This proves Git ancestry, not that all Firefox and Chromium runtime regressions have been retested today. The newest two commits in `main` must remain part of this feature's baseline.

## Actual repository architecture

- `manifest.json`: Manifest V3, `webRequest` and `storage` permissions, HTTP/HTTPS host permissions; popup at `src/popup/popup.html`. **No proxy or nativeMessaging permission currently declared.**
- The manifest declares both `background.scripts` (Firefox) and `background.service_worker` (Chromium). Existing code treats those as different runtime models. Chromium may warn about the extra background.scripts field; this is a documented accepted behavior.
- `src/background/background.js`: shared entry point. Manages target-tab/window focus and browser-runtime message dispatch. The message listener currently handles `AIDM_GET_PLAYBACK_STATE`, `AIDM_SET_SELECTED_MEDIA`, and `AIDM_SET_SELECTED_SUBTITLE`; validates that messages originate from the extension's own popup. This is an established pattern to extend **without weakening origin checks**.
- `src/background/network-observer.js` and related modules: passive network observations and media detection. **Do not insert proxy lifecycle logic into the capture/detection pipeline.**
- `src/core/`: classification, ranking, and subtitle roles; remain browser-neutral.
- `src/popup/popup.html`, `src/popup/popup.js`, `src/popup/popup.css`: current popup displays detection status, selected media, subtitles, request context, and Copy for AiDM. Add an independent optional network section instead of refactoring selection/copy routines.
- Existing README says the extension is browser intelligence, **not the downloader**, with clipboard handoff to independent AiDM. Preserve this boundary.
- `docs/architecture-decisions.md` documents shared cross-browser behavior, background state restoration, and the manual handoff policy. New Psiphon decisions should be separately recorded first rather than rewriting historical tested decisions.

## Open implementation research questions

1. Confirm the exact Firefox versions and MV3 proxy API/permission semantics in the target installation, including proxy conflicts and extensions that already control proxy settings.
2. Choose an extension-to-local-controller transport (native messaging vs authenticated loopback) based on Linux installation burden, attack surface, restart behavior, and verifiable permissions. No implementation is selected yet.
3. Verify whether optional permissions can support the desired OFF-by-default semantics. Manifest-declared permissions can still prompt at install/update time; OFF must mean **no actions**, not that installed permissions cease to exist.
4. Design a durable saved user preference, recoverable status, explicit intentional stop, and safe ambiguous/crash behavior across Firefox extension restarts and Psiphon process restarts.
5. Define a control-owned connection state protocol; reject stale readiness notices and do not trust only an open port.
6. Determine how to restore the browser's previous proxy policy without overwriting another extension's policy; evaluate uninstall/disable cleanup and loss of control.
7. Test that Chromium startup, tab targeting, stream detection and clipboard export remain unaffected. Firefox-only paths must not throw on Chromium.

## Proposed small, testable milestones

### P0 — Research and test plan (no implementation)
- Validate Firefox proxy controls/permissions and communication choices in supported releases.
- Record decision on local controller protocol and prior-policy restoration.
- Define separate tests for deliberate stop vs process crash vs tunnel loss vs Firefox restart.
- **Pass:** a selected feasible mechanism and documented risks/rollback, with no behavior change.

### P1 — Optional feature foundation (no proxy changes)
- Add isolated Firefox capability detection, stored preference default OFF, and collapsed/hidden UI behavior.
- Chromium sees no new controls; OFF triggers no Psiphon work.
- **Pass:** existing streaming-capture and export regression tests in Firefox and Brave, including extension restart.

### P2 — Firefox proxy-setting control
- Add permission handling and reversible SOCKS5/remote-DNS activation and explicitly authorized restoration.
- First use a controlled manual test action; do not assume an active tunnel from proxy listener presence.
- **Pass:** proxy IP changes when activated with a verified tunnel; previous policy restores only by deliberate user action; unsupported browsers unaffected.

### P3 — Psiphon lifecycle messaging
- Implement the chosen minimal authenticated local bridge and controller state interface in the Psiphon-Linux repository, keeping the engine independent.
- Verify real tunnel readiness from current-session events plus an actual proxied request.
- **Pass:** start/stop/connect statuses demonstrably correspond to real tunnel state; no stale status or unintended process overlap.

### P4 — Integrated lifecycle and fail-closed safety
- Connect UI commands to Psiphon controller and proxy policies: intentional ON/OFF, failed launch, unexpected loss, controller disappearance.
- **Pass:** manually selected OFF returns to agreed direct browsing; crashes/loss do **not** silently fall back; browser restart and profile settings behave as documented.

### P5 — End-to-end regression and release readiness
- Test Firefox normal/bypassed browsing, blocked website access, DNS/WebRTC exposure and long-session/reconnect behavior; validate Chromium unchanged.
- Document minimal install/recovery and Firefox signing/add-on installation requirements.
- **Pass:** reproducible acceptance tests and explicit caveats; merge to `main` only after both browser families pass.

### Future, separate AiDM milestone
- AiDM chooses direct vs Psiphon proxy per download; test yt-dlp/aria2c/other engines independently, with browser-captured headers and expiring URLs. No downloader edits in this branch.

## Rules for development

Preserve the stable `main` and keep this branch isolated. Treat Firefox implementation as optional additive behavior, not a replacement for Stream Inspector. Separate documented intentions from tested results. No Chromium proxy switching, no unconditional global Firefox proxy setting at extension startup, and no unrequested system-wide routing.
