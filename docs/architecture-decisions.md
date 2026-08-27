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
