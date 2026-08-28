# AIDM Stream Inspector — Architecture Decisions

This document records implementation facts and decisions that are important for future development. It should describe tested behavior and locked architecture, not speculative features.

## AD-001 — Separate browser extension and downloader responsibilities

AIDM Stream Inspector is the browser intelligence and session-handoff layer. It observes browser activity, identifies useful media requests, and later exports browser/session context in a structured form.

AiDM remains the downloader and is responsible for download routing, aria2c, yt-dlp, FFmpeg, merging, and post-processing.

The extension must not gradually become a second downloader.

## AD-002 — One shared Firefox/Chromium codebase

The project targets Firefox/Mozilla derivatives and Chromium derivatives from one source tree.

Manifest V3 background execution differs between the browser families:

- Firefox loads background scripts/event-page style execution.
- Chromium loads a service worker.

The project therefore uses the same shared `src/background/background.js` entry point for both browser families rather than maintaining separate implementations.

Browser-specific behavior should be introduced only when a real incompatibility requires it.

## AD-003 — Background lifetime cannot be treated as permanent

Manual M0/M1 testing showed a visible lifecycle difference:

- Firefox's background context appeared continuously active during ordinary browsing while extension DevTools was attached.
- Brave/Chromium behaved more opportunistically: the service worker could appear idle and then resume when relevant activity occurred.

This is expected Manifest V3 behavior, not an extension bug.

Important future runtime state must therefore not depend on background global variables remaining alive indefinitely. When candidate/session persistence becomes necessary, session-lifetime browser storage should be evaluated rather than assuming permanent in-memory state.

## AD-004 — M0 cross-browser foundation verified

Milestone M0 was manually tested successfully in both Firefox and Brave/Chromium.

Verified behavior:

- extension loads successfully;
- Manifest V3 configuration is accepted;
- shared background context starts;
- startup console message appears.

Firefox may display a development warning that the background event page is not terminated while an extension DevTools toolbox is attached. This is expected during debugging.

## AD-005 — M1 passive raw network observation verified

Milestone M1 was manually tested successfully in both Firefox and Brave/Chromium.

Current observer behavior:

- uses passive `webRequest.onBeforeRequest` observation;
- observes ordinary HTTP/HTTPS requests;
- logs method and exact URL for development;
- does not block, redirect, or modify requests;
- does not capture headers, cookies, bodies, or response data;
- does not store requests;
- does not classify or rank media.

Firefox produced a very active stream of observed requests during normal browsing. Brave/Chromium could appear idle until relevant browser activity woke the service worker. Both behaviors are compatible with the current architecture.

## AD-006 — Tab association precedes target-tab filtering

The final product should operate on the user's intended media-playing tab rather than indiscriminately treating traffic from all open tabs as one stream source.

Development must separate two concerns:

1. first prove that each observed request can be associated with the correct browser tab using the request's tab context;
2. only later introduce target-tab selection/filtering.

This prevents target-selection logic from hiding bugs in basic tab association.

## AD-007 — M2 tab association verified across Firefox and Chromium

Milestone M2 was manually tested successfully in both Firefox and Brave/Chromium.

Observed behavior:

- normal requests from the same tab consistently carried the same `tabId`;
- requests from a different tab carried a different `tabId`;
- some requests reported `tabId = -1`, meaning they were not associated with a normal browser tab;
- Firefox displayed small tab IDs during testing, while Brave/Chromium displayed much larger numeric IDs.

Tab IDs are opaque browser-provided identifiers. The extension must not assume that they are sequential, small, stable across browser restarts, or otherwise meaningful beyond identifying a tab within the current browser runtime.

The current observer also logs HTTP request methods such as GET, HEAD, and POST. These are ordinary request methods and are useful development context, not separate media classifications.

## AD-008 — Cross-browser MV3 background manifest warning in Chromium

The shared Manifest V3 manifest currently declares both `background.scripts` and `background.service_worker` so one source tree can support Firefox and Chromium background models.

Current browser behavior:

- Firefox uses `background.scripts` and does not support the Chromium extension service-worker model for this purpose;
- Chromium uses `background.service_worker` for Manifest V3;
- Chromium 121 and later ignore `background.scripts` when it is present in a Manifest V3 extension, but Chromium-based browsers may still display a developer warning such as `'background.scripts' requires manifest version of 2 or lower.`

This warning was observed in Brave during M2 testing while the extension still loaded and worked correctly.

For the current development phase, the warning is accepted as a known cross-browser manifest-development warning rather than introducing separate browser-specific manifests or a build pipeline prematurely.

If packaging/store submission later requires cleaner browser-specific manifests, that decision should be revisited at release-engineering time rather than during early feature development.

## AD-009 — M3.1 target reconstruction after Chromium service-worker restart

M3 initially revealed a Chromium-specific lifecycle bug: `tabs.onActivated` was registered correctly at top level, but the handler depended on previously initialized in-memory `focusedNormalWindowId`. After a service-worker restart, that value could be `null`, causing the activation event that woke the worker to be rejected.

M3.1 changed target reconstruction so fresh browser state can establish the focused normal window and active target tab after a Chromium service-worker restart, while preserving Firefox behavior.

Manual testing after M3.1 showed:

- Firefox retained its immediate and reliable target-tab behavior;
- Brave/Chromium began updating target tabs immediately on ordinary tab switches;
- the prior need to unfocus/refocus Brave to recover the correct target was removed.

This confirms that important target state must be reconstructable from browser events/current browser APIs rather than assuming background global memory survived.

## AD-010 — Chromium focus-loss timing differs from Firefox and is not a current product blocker

After M3.1, one smaller cross-browser difference remains during application/window focus loss:

- Firefox immediately reports the target as unavailable when the user leaves the Firefox window;
- Brave/Chromium may temporarily retain the previous target when the browser loses application focus, then briefly report unavailable when focus returns before immediately reconstructing the active target tab.

Chromium's `windows.onFocusChanged` API documents `WINDOW_ID_NONE` for the absence of a focused Chrome window, but event timing can vary by platform/window manager. On Linux, Chromium also documents special focus-event sequencing around window switches.

For the Stream Inspector's main goal, this is not currently considered a blocking defect because request processing is still filtered by the correct target tab ID, and target reconstruction is immediate once Chromium processes the relevant focus/activation events. The extension does not need to treat 'browser application currently foregrounded' as authoritative media ownership; it needs a stable selected/target tab whose network requests can be associated correctly.

If later product behavior requires a strict UI state that instantly mirrors application focus, this difference can be revisited. It should not block progression into media-candidate detection.
