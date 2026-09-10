# AIDM Stream Inspector — Development Roadmap After Foundation

This document records the development direction after the foundation phase and the current evidence that should guide future work. It exists to prevent development from drifting away from what has actually been proven through testing.

## Current project state — 2026-09-10

The project is currently at a deliberate reflection/testing checkpoint.

The known-good implementation has reached:

- M0 — extension foundation and cross-browser startup;
- M1 — raw passive network observation;
- M2 — request-to-tab association;
- M3 — target-tab filtering;
- M3.1 — Chromium service-worker lifecycle/state reconstruction fix;
- M4 — obvious media-candidate detection from URL pathname;
- M4.1 — media evidence embedded inside query-parameter values while preserving the original outer request URL;
- M5 — basic candidate request-context observation, including User-Agent, Referer, Origin, and safe presence/absence handling for Cookie, Authorization, and Range where observable.

All of the above form the tested foundation.

`dev/01-foundation` should remain the known-good foundation snapshot. Deeper experimental work belongs on `dev/02-traffic-intelligence`.

However, no M5.1 implementation should begin merely because a single stream attempt fails. The project is currently prioritizing stronger regression testing of the existing foundation before adding deeper traffic-intelligence code.

### Important evidence correction: fboxtv

An earlier fboxtv test produced HTTP 403 failures even when yt-dlp was supplied with combinations of Referer, User-Agent, Origin, browser-cookie loading, and browser impersonation. At that time, this looked like evidence of a deeper browser-only reproduction requirement.

A later test, several days afterward, changed that conclusion. A structurally similar fboxtv stream began downloading successfully with a conventional yt-dlp command using browser-derived context such as User-Agent, Referer, and browser cookies.

The remaining errors were fragment read timeouts and retries, not manifest authorization failures. The download continued.

Therefore the earlier fboxtv result must **not** be treated as proof that M5 is missing a mysterious request-context field or that request-chain analysis is already required for that platform.

The safer classification is now:

> fboxtv is a volatile real-world regression target whose provider, player host, CDN host, media host, token behavior, or server policy may change over time.

This also reinforces an earlier lesson from Plex testing: one failed reproduction attempt is evidence for investigation, not evidence for architecture.

### New implementation rule

Before a real-world website is allowed to justify a new architectural milestone, the relevant failure should be reproducible across fresh captures and controlled retries.

Prefer evidence such as:

- repeated failure with fresh tokens/URLs;
- the same failure across multiple sessions or times;
- one-variable-at-a-time ablation;
- a clear difference between the browser's successful request and the external reproduction attempt;
- confirmation that the failure is not merely token expiry, provider rotation, CDN instability, or transient network behavior.

A site-specific observation should become a generic feature requirement only after the underlying pattern is demonstrated.

---

# Foundation checkpoint

The following capabilities form the known-good foundation:

- cross-browser Firefox + Chromium/Brave execution;
- passive `webRequest` observation;
- request-to-tab association;
- active target-tab filtering;
- Chromium service-worker restart robustness;
- obvious media detection from request pathname;
- detection of obvious media evidence embedded inside query-parameter values while preserving the original outer request;
- request-context observation for detected candidates, including User-Agent, Referer, Origin, and safe presence/absence reporting for sensitive fields where observable.

This foundation should remain stable while future traffic-intelligence work is developed separately.

---

# What current regression testing has proven

## Shaka Player

Detection succeeds but may produce many low-level `.mp4` segment candidates. This proves that detection quantity is not detection quality and that later manifest/segment relationship analysis and ranking will be useful.

This is a reproducible usefulness/ranking problem, not a failure to observe media traffic.

## averotv-style wrapped HLS request

The useful media request was hidden behind an outer worker/proxy URL whose query parameter contained an encoded `.m3u8` URL. Pathname-only detection missed it.

M4.1 solved this pattern generically by treating embedded query values as detection evidence while preserving the exact original outer browser request as the candidate.

## movi.pk-style reproduction requirement

Media detection succeeded, but replaying the raw URL externally failed. Controlled ablation showed that adding the actual browser Referer was sufficient for that specific test bed.

This proved that detection and external reproduction are separate problems and that request-context capture is necessary.

It did **not** prove that Referer is universally sufficient.

## fboxtv-style volatile provider behavior

The extension successfully detects HLS candidates and observes the obvious browser request context.

One testing period produced persistent HTTP 403 failures in external replay despite multiple added context variables. A later testing period produced successful downloading using an ordinary yt-dlp browser-context command.

The player/media infrastructure also changed between tests, including different Referer/player domains and different media/CDN hosts.

Therefore fboxtv currently demonstrates **environment/provider volatility**, not a proven extension capability gap.

Fragment read timeouts observed during a successful later download should be treated as delivery/network reliability symptoms rather than authentication failure while the downloader continues retrying and making progress.

---

# Current development decision

The project should **not rush into M5.1** based on the earlier fboxtv result.

The immediate phase is stress-testing the existing M4/M4.1/M5 foundation against increasingly difficult streams and classifying failures correctly.

The next implementation milestone should be selected by reproducible evidence.

Useful failure classes include:

### A — Detection gap

The media plays in the browser, but the extension detects no useful candidate.

This should drive another detection-layer improvement such as response/MIME-based or behavioral/opaque media detection.

### B — Request-context gap

The extension detects the candidate, but controlled reproduction repeatedly proves that an additional browser-observable field is required and M5 does not capture it.

This should drive deeper candidate request observation.

### C — Candidate usefulness/ranking gap

The extension detects technically valid media traffic, but floods the candidate set with segments or exposes multiple ambiguous candidates while a higher-level useful manifest exists.

This should drive relationship analysis, ranking, and deduplication.

### D — Subtitle discovery gap

Video playback/detection works, but browser-visible subtitles are not discovered or associated with the correct stream.

This should drive the subtitle-discovery layer.

Whichever reproducible class becomes the strongest concrete limitation should determine the next implementation work.

---

# Phase 2 — Deep Traffic Intelligence (planned, not yet activated)

The following milestones remain architecturally useful. They are preserved as the intended direction if testing proves that deeper transaction understanding is required.

## M5.1 — Deep candidate request metadata

### Goal

For each already-detected media candidate, capture a fuller browser-observable request picture without replaying or modifying the request.

M5.1 should answer:

> What exactly can the browser extension observe about this successful candidate request beyond the small M5 header subset?

### Intended evidence

Where browser APIs expose it, associate candidates with information such as:

- request ID;
- HTTP method;
- browser request/resource type;
- tab ID;
- frame ID / parent-frame context;
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

The implementation must remain generic and must not hardcode a specific website, provider, hostname, or header combination.

### Activation condition

M5.1 should begin when testing produces a reproducible request-context gap, or when a broader evidence model is needed for another clearly demonstrated feature.

It should not begin merely because one volatile website temporarily returns 403.

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

### Why this may matter

Response observation can support both reproduction diagnosis and future MIME-based detection of extensionless/opaque media URLs.

---

## M5.3 — Request-chain correlation

### Goal

Move from understanding one media request in isolation to understanding the playback flow around it.

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

Later logic may correlate requests using evidence such as:

- tab and frame identity;
- request timing;
- initiator/document context;
- redirect relationships;
- shared host/path/token structures;
- manifest-to-child-request behavior;
- repeated segment sequences;
- request IDs and browser lifecycle events.

Correlation must remain evidence-driven and explainable.

### Why this may matter

This layer can eventually help with both hard reproduction cases and candidate-usefulness problems such as Shaka segment floods and master/variant relationships.

---

# Controlled reproduction philosophy

AiDM remains outside the current diagnostic loop while downloader requirements are being isolated.

Use direct tools such as yt-dlp for controlled experiments. Only after a requirement is independently proven should AiDM implement it.

For reproduction testing:

> Change one evidence-backed variable at a time.

Do not blindly export every browser secret, randomly add headers, or conclude that a single successful/failed attempt establishes a universal rule.

Possible causes of external reproduction failure may include:

- missing request headers;
- relevant session/cookie state;
- token freshness;
- request-chain/bootstrap dependency;
- redirects;
- browser/network fingerprinting;
- downloader protocol behavior;
- provider/CDN rotation;
- temporary server policy;
- network instability;
- server-side restrictions that cannot be reproduced by the extension.

The extension should gather evidence. It must not claim universal bypass capability.

---

# Later detection and product milestones

## MIME / response-based media detection

Extend detection beyond URL/path/query-extension evidence using browser-observable response MIME/content type.

This is necessary for opaque or extensionless media URLs.

Potential evidence includes:

- HLS/DASH MIME types;
- `video/*`;
- `audio/*`;
- other useful media response metadata.

A URL lacking `.m3u8`, `.mpd`, `.mp4`, or another recognizable suffix must still be eligible for detection when stronger response evidence exists.

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

Address the Shaka-class problem where technically correct segment detection floods the candidate set.

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

Cookie support remains part of the architecture because different servers may require different context.

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

The exact schema remains deferred until the evidence model stabilizes.

## AiDM integration

AiDM remains the downloader layer, not the experimental reproduction test bed.

Once a reproduction method is proven independently, AiDM can implement that known requirement deliberately.

The extension remains the browser-intelligence/session-handoff layer. AiDM remains responsible for downloading, routing to aria2c/yt-dlp/FFmpeg, merging, naming, and post-processing.

---

# Regression-test philosophy

The project should keep multiple classes of regression targets because no one website exercises every problem:

- controlled standards/demo streams for deterministic HLS/DASH behavior;
- Shaka-class targets for segment-flood/manifest relationships;
- wrapped/proxy URL targets for embedded media detection;
- Referer-dependent targets for basic request-context reproduction;
- volatile multi-provider platforms for robustness testing without overfitting;
- future reproducibly protected targets where basic context is demonstrably insufficient;
- future opaque/extensionless targets for MIME and behavioral detection;
- subtitle-rich players for subtitle association.

A target website is evidence, not architecture.

No implementation should be hardcoded to a regression site's hostname or provider.

Most importantly:

> A single failed stream attempt is evidence for investigation, not evidence for architecture.

---

# Branch checkpoint

`dev/01-foundation` is the known-good tested foundation line.

`dev/02-traffic-intelligence` is reserved for the next deeper phase, but its existence does not force immediate M5.1 implementation.

The purpose of the split is to protect the working foundation while leaving a safe place for higher-risk traffic-intelligence experiments when the evidence justifies them.

At the current checkpoint, the recommended workflow is:

```text
keep dev/01-foundation stable
        ↓
stress-test M4 / M4.1 / M5
        ↓
classify reproducible failure
        ↓
choose the smallest evidence-backed next milestone
        ↓
implement on dev/02-traffic-intelligence
```

---

# Long-term architectural checkpoint

The project has already progressed through:

```text
raw traffic observation
        ↓
tab-aware filtering
        ↓
media-candidate detection
        ↓
embedded media evidence detection
        ↓
basic request-context observation
```

The next goal is **not automatically** to capture more data.

The next goal is to determine, through reproducible testing, which missing capability provides the most useful generic improvement.

Possible future progression remains:

```text
response/MIME evidence
        ↓
deep request metadata
        ↓
request/response lifecycle
        ↓
playback relationship graph
        ↓
ranking + subtitles + structured handoff
```

AIDM Stream Inspector should become more intelligent by learning from reproducible browser evidence, not by accumulating site-specific fixes or reacting to transient failures.

That principle is now part of the project's architecture.