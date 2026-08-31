# AIDM Stream Inspector — Development Roadmap After Foundation

This document records the development direction after the foundation phase. It exists to prevent future work from losing the architectural separation already established through M0–M5 and M4.1 testing.

The foundation phase has proven that the extension can observe browser traffic, associate requests with the correct target tab, detect obvious media candidates, detect media URLs embedded inside query parameters, and associate basic request context with detected candidates.

The next phase is no longer primarily about finding obvious URLs. It is about understanding the browser request lifecycle deeply enough to explain why browser playback succeeds when an external downloader cannot reproduce the same media request.

## Foundation checkpoint

The following capabilities form the known-good foundation:

- cross-browser Firefox + Chromium/Brave execution;
- passive `webRequest` observation;
- request-to-tab association;
- active target-tab filtering;
- Chromium service-worker restart robustness;
- obvious media detection from request pathname;
- detection of obvious media evidence embedded inside query-parameter values while preserving the original outer request;
- request-context observation for detected candidates, including User-Agent, Referer, Origin, and safe presence/absence reporting for sensitive fields where observable.

This foundation should remain stable while deeper traffic-intelligence work proceeds on a new development branch.

## Why the next phase exists

Real-world regression testing produced several distinct failure classes:

### Shaka Player

Detection succeeds but produces too many low-level media-segment candidates. This proves that detection quantity is not detection quality and that later manifest/segment relationship analysis and ranking are required.

### averotv-style wrapped HLS request

The useful media request was hidden behind an outer worker/proxy URL whose query parameter contained an encoded `.m3u8` URL. Pathname-only detection missed it. M4.1 solved this pattern generically by treating embedded query values as detection evidence while preserving the exact outer request as the candidate.

### movi.pk-style reproduction requirement

Media detection succeeded, but replaying the raw URL externally failed. Controlled ablation showed that adding the actual browser Referer was sufficient for that specific test bed. This proved that detection and external reproduction are separate problems and that request-context capture is necessary.

### fboxtv-style deeper reproduction wall

Media detection succeeds and M5 exposes the obvious request context, but external replay still fails with HTTP 403 even after testing combinations including Referer, User-Agent, Origin, browser-cookie loading, and yt-dlp browser impersonation.

This establishes a new boundary:

> Basic candidate context is not always enough. Some protected playback flows require understanding more of the browser request lifecycle, response behavior, or request chain.

The project should therefore stop guessing individual headers and begin observing the browser transaction more completely.

---

# Phase 2 — Deep Traffic Intelligence

## M5.1 — Deep candidate request metadata

### Goal

For each already-detected media candidate, capture a much fuller browser-observable request picture without yet attempting to reproduce or modify the request.

M5.1 should answer:

> What exactly can the browser extension observe about this successful candidate request beyond the small M5 header subset?

### Intended evidence

Where the browser APIs expose it, associate the candidate with information such as:

- request ID;
- HTTP method;
- browser request/resource type;
- tab ID;
- frame ID / parent frame context;
- initiator, origin URL, or document URL where available;
- all observable request-header names;
- safe values for non-sensitive request headers;
- redacted/presence-only handling for Cookie, Authorization, and other sensitive values;
- request timing/context fields that are naturally available and materially useful.

Potentially useful headers may include, where actually exposed:

- Accept;
- Accept-Language;
- Accept-Encoding;
- Sec-Fetch-*;
- Sec-CH-UA / client hints;
- Cache-Control;
- Pragma;
- Range;
- Referer;
- Origin;
- User-Agent;
- other browser-observable fields discovered from real tests.

The implementation must not hardcode fboxtv, any site hostname, player provider, or one known header combination.

### Non-goals

M5.1 is not:

- request replay;
- downloader integration;
- candidate ranking;
- response analysis;
- redirect reconstruction;
- cookie-database access;
- automatic secret export;
- site-specific bypass logic.

The purpose is deeper observation and accurate association with the exact candidate request.

---

## M5.2 — Candidate response and redirect lifecycle

### Goal

Observe what happens after the browser sends a detected media-candidate request.

M5.2 should answer:

> How does the browser's successful candidate request resolve, redirect, and respond?

### Intended evidence

Where browser APIs expose it, correlate by request ID and record:

- HTTP response status;
- response headers relevant to diagnosis;
- redirect events;
- redirect target/final URL;
- content type / MIME information;
- content length where exposed;
- cache-related information where exposed;
- server IP where browser APIs expose it;
- request errors/failures;
- final completion state.

Sensitive response values must remain protected and must not be casually logged or persisted.

### Why this matters

A browser may succeed because of a redirect chain, response-issued state, MIME behavior, CDN transition, or other lifecycle detail that is invisible when only the original request URL and a few request headers are examined.

This milestone begins turning isolated candidate logs into transaction-level evidence.

---

## M5.3 — Request-chain correlation

### Goal

Move from understanding one media request in isolation to understanding the chain of requests that produced it.

M5.3 should answer:

> What browser/player requests led to this media candidate, and which later requests belong to the same playback flow?

A useful conceptual model is:

```text
page / embedded player
        ↓
bootstrap / API / token request
        ↓
signed or proxied media manifest
        ↓
variant playlists / renditions
        ↓
media segments
```

### Intended relationships

Later logic may correlate requests using browser-provided evidence such as:

- tab and frame identity;
- request timing;
- initiator/document context;
- redirect relationships;
- shared host/path/token structures;
- manifest-to-child-request behavior;
- repeated segment sequences;
- request IDs and browser lifecycle events.

The goal is not to invent causal relationships from weak guesses. Correlation should be evidence-driven and explainable.

### Why this matters

Some servers may authorize a media request only after a previous bootstrap/token/player request. If so, copying only the final manifest URL and common headers will never reproduce the browser's successful flow.

M5.3 is the milestone where the extension begins understanding playback as a graph rather than a list of URLs.

---

# Controlled reproduction after M5.1–M5.3

Once the extension can observe the successful browser transaction and request chain more completely, controlled external reproduction should resume.

The rule remains:

> Change one evidence-backed variable at a time. Do not blindly export every browser secret or randomly add headers.

For hard regression targets, compare the external request against the browser's observed successful flow and identify the minimum sufficient reproduction context.

A failure may ultimately belong to different layers:

- missing request headers;
- missing session/cookie state;
- token freshness;
- request-chain/bootstrap dependency;
- redirects;
- browser/network fingerprinting;
- downloader protocol behavior;
- server-side restrictions that cannot be reproduced by the extension.

The extension should gather evidence; it must not claim universal bypass capability.

---

# Later detection and product milestones

The deep-traffic phase does not replace the previously identified future work. It adds the evidence needed to implement it correctly.

## MIME / response-based media detection

Extend detection beyond URL/path/query-extension evidence by using browser-observable response MIME/content type.

This is necessary for opaque or extensionless media URLs.

Examples include:

- HLS/DASH MIME types;
- `video/*`;
- `audio/*`;
- other useful media response metadata.

A URL that lacks `.m3u8`, `.mpd`, `.mp4`, or other recognizable suffixes must still be eligible for detection when stronger response evidence exists.

## Opaque/behavioral media detection

Use evidence such as:

- repeated segmented requests;
- byte-range behavior;
- manifest/segment relationships;
- CDN request patterns;
- frame/initiator context;
- request timing and grouping.

This must remain layered and conservative rather than becoming a collection of site-specific regexes.

## Manifest and segment relationship analysis

Address the Shaka-class problem where technically correct `.mp4` segment detection floods the candidate set.

The extension should eventually distinguish or relate:

- manifests vs child segments;
- complete direct files vs fragmented media;
- video vs audio renditions;
- master vs variant/media playlists;
- repeated sequential chunks.

Higher-level meaningful manifests should generally become more useful user-facing candidates than hundreds of child segments.

## Candidate ranking and deduplication

Only after enough evidence exists should the extension decide which candidates are most useful.

Ranking may consider:

- manifest role;
- master vs media playlist;
- direct-file characteristics;
- audio/video completeness;
- resolution;
- bitrate;
- codec;
- duplicate/related candidates;
- freshness;
- request-chain position;
- playback relationships.

Detection and ranking remain separate responsibilities.

## Subtitle discovery

Discover subtitles independently of the video stream, including where available:

- WebVTT `.vtt`;
- subtitle manifests/URLs;
- language;
- label;
- default/forced status;
- association with the correct playback/candidate.

Successful video detection must never imply that player subtitles are already captured.

## Page and player context

Collect useful context such as:

- top-level page URL;
- page title;
- embedded player/frame URL;
- tab/frame identity;
- relation between outer page and media-serving iframe/player.

This metadata supports both candidate ranking and later structured handoff.

## Cookie/session capability

Cookie support remains part of the architecture even though one test bed proved Referer alone sufficient.

Different servers may require different context.

The preferred architecture is capability-based rather than browser-name-based:

- do not hardcode `chrome`, `brave`, or `firefox`;
- do not make AiDM guess browser profile paths;
- do not blindly dump all browser cookies;
- later retrieve/export only relevant session context using browser APIs and explicit permissions/user action where appropriate.

## Structured handoff

Once detection, context capture, ranking, subtitles, and session handling are mature enough, export structured machine-readable data rather than shell commands.

The handoff should eventually represent concepts such as:

```text
candidate type
exact media/request URL
page URL
frame/player URL
page title
User-Agent
Referer
Origin
relevant headers
session/cookie context where needed
subtitles
useful metadata
```

The exact schema is deliberately deferred until the evidence model stabilizes.

## AiDM integration

AiDM remains outside the current extension investigation loop while downloader requirements are being isolated with direct tool experiments.

Once a reproduction method is proven independently, AiDM can implement that known requirement deliberately.

The extension must remain the browser-intelligence/session-handoff layer. AiDM remains responsible for downloading, routing to aria2c/yt-dlp, FFmpeg, merging, naming, and post-processing.

---

# Regression-test philosophy

The project should keep multiple classes of regression targets because no one website exercises every problem:

- controlled standards/demo streams for deterministic HLS/DASH behavior;
- Shaka-class targets for segment-flood/manifest relationships;
- wrapped/proxy URL targets for embedded media detection;
- Referer-dependent targets for basic request-context reproduction;
- hard protected targets where basic headers/session/impersonation remain insufficient;
- future opaque/extensionless targets for MIME and behavioral detection;
- subtitle-rich players for subtitle association.

A target website is evidence, not architecture. No implementation should be hardcoded to a regression site's hostname or provider.

---

# Branch checkpoint

`dev/01-foundation` is the known-good foundation line.

Starting with M5.1, deeper traffic-intelligence development should occur on a new branch created directly from the completed foundation checkpoint.

The purpose of this branch split is to protect the tested foundation from higher-risk work involving deeper request metadata, response lifecycle correlation, and request-chain analysis.

If the new phase becomes unstable, the project must always be able to return to `dev/01-foundation` as the last known-good implementation of the foundational capabilities.

---

# Long-term architectural checkpoint

The project has now graduated through three levels of understanding:

```text
URL detection
        ↓
request-context observation
        ↓
traffic/request-chain understanding
```

The next goal is not merely to capture more URLs.

> AIDM Stream Inspector should understand enough of the browser's successful media transaction to explain what the useful candidate is, how it was reached, what context accompanied it, and what evidence AiDM later needs to reproduce it.

This intelligence must remain generic, cross-browser, evidence-driven, privacy-conscious, and independent of any single streaming website.