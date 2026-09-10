# AIDM Stream Inspector — Development Roadmap After Foundation

This document records the development direction after the foundation phase and the evidence that should guide future work. The purpose is to prevent the project from drifting toward site-specific fixes or conclusions based on one-off tests.

## Current project state — 2026-09-10

The project has now progressed beyond the original foundation and into traffic intelligence.

Completed and manually validated milestones:

- M0 — extension foundation and cross-browser startup;
- M1 — raw passive network observation;
- M2 — request-to-tab association;
- M3 — target-tab filtering;
- M3.1 — Chromium service-worker lifecycle/state reconstruction fix;
- M4 — obvious media-candidate detection from URL pathname;
- M4.1 — media evidence embedded inside query-parameter values while preserving the exact outer request URL;
- M5 — basic candidate request-context observation, including User-Agent, Referer, Origin, and safe presence/absence handling for Cookie, Authorization, and Range where observable;
- M6 — candidate ranking foundation;
- M6.1 — ranking presentation cleanup with readable HIGH / MEDIUM / LOW priority labels while preserving numeric scores and ranking evidence.

Branch roles:

- `dev/01-foundation` remains the known-good foundation snapshot;
- `dev/02-traffic-intelligence` is the active branch for ranking, subtitle intelligence, and later deeper traffic analysis.

The current next feature area is subtitle discovery.

---

# Testing rule that remains mandatory

Real-world streaming platforms can be volatile. Provider hosts, player domains, CDNs, signed URLs, tokens, and server policies may change between attempts.

The fboxtv and Plex tests demonstrated an important rule:

> A single failed stream attempt is evidence for investigation, not evidence for architecture.

Before a website is allowed to justify a new architectural milestone, prefer repeated evidence across fresh captures and controlled retries.

Useful evidence includes:

- repeated failure with fresh URLs/tokens;
- the same failure across multiple sessions or times;
- one-variable-at-a-time ablation;
- a clear difference between the browser's successful request and the external reproduction attempt;
- confirmation that the behavior is not just token expiry, provider rotation, CDN instability, or transient networking.

A website is a regression target, not an architecture rule.

---

# Foundation checkpoint

The tested foundation provides:

- Firefox + Chromium/Brave compatibility;
- passive `webRequest` observation;
- request-to-tab association;
- active target-tab filtering;
- Chromium service-worker restart robustness;
- obvious HLS/DASH/direct-media detection;
- query-embedded media evidence detection;
- exact signed URL preservation;
- basic request-context observation.

This foundation must continue working while higher-level intelligence is added.

---

# Proven regression classes

## Query-embedded media

A useful HLS request may have an outer pathname such as `/hls` while the `.m3u8` appears only inside an encoded query-parameter value. M4.1 solves this generically by using the embedded path as detection evidence while preserving the exact original outer request URL.

## Request-context dependency

The movi.pk ablation proved that a raw media URL can fail externally while the same URL plus the browser-observed Referer succeeds. This validated M5 and established that detection and reproduction context are separate concerns.

## Candidate usefulness

Shaka-style playback can produce many technically valid low-level media fragments. StreamWish-like playback can expose several HLS candidates of unequal usefulness. These cases proved that detection quantity is not detection quality.

## Volatile reproduction behavior

fboxtv initially appeared to require deeper browser-only context because repeated external tests returned 403 even with Referer, User-Agent, Origin, cookies, and browser impersonation. A later fresh test succeeded with conventional browser-derived context. Therefore fboxtv is currently treated as a volatile regression target rather than proof of a missing deep-context capability.

---

# M6 — Candidate ranking foundation — COMPLETE

M6 introduced ranking as a separate layer after detection.

Core rule:

> Detection asks “is this media?” Ranking asks “how useful is this candidate likely to be?”

The detector remains responsible for classification. The ranker assigns evidence-based usefulness scores without rewriting or removing the original candidate.

Current ranking direction favors higher-level adaptive manifests over child renditions and low-level media where available evidence supports that conclusion.

The initial ranking model uses conservative URL/path clues such as:

- HLS/DASH candidate type;
- delimited `master` filename evidence;
- playlist-like path evidence;
- video-rendition-like filename evidence;
- audio-rendition-like filename evidence.

These clues are evidence only. They do not prove a manifest role, and no site/provider hostname is hardcoded.

Lower-ranked unique candidates remain visible. Ranking does not become detection suppression.

### M6 real-world validation

A cinejoy playback exposed structurally:

```text
parent playlist candidate
video 720p rendition
video 1080p rendition
audio rendition
```

The ranking system assigned the parent/playlist-like candidate a higher score than the obvious child video/audio renditions.

The highest-ranked candidate was tested independently with yt-dlp. yt-dlp parsed the adaptive HLS structure and selected a combined format similar to:

```text
6000+audio-Track_1
```

The completed output was verified with both ffprobe and FFmpeg audio statistics. The final file contained working audio.

This is the strongest validation so far that prioritizing a higher-level manifest can solve several user-facing problems at once:

- avoid selecting a silent video-only rendition;
- preserve access to separate audio renditions;
- allow the downloader to understand the adaptive structure itself;
- reduce ambiguity among several technically valid HLS candidates.

### M6.1 — Ranking presentation cleanup — COMPLETE

The old wording repeated:

```text
Priority score: N (higher = likely more useful)
```

for every candidate, which was technically correct but visually misleading.

M6.1 keeps the numeric score and evidence but adds readable priority interpretation such as HIGH / MEDIUM / LOW.

This affects presentation only. Ranking weights and candidate detection remain unchanged.

### Future ranking work

Ranking can later become stronger using evidence such as:

- parsed manifest role;
- parent-child relationships;
- request order;
- MIME/content type;
- resolution and bitrate;
- audio/video completeness;
- repeated fragment behavior;
- request-chain relationships;
- duplicate detection.

Exact duplicates caused by repeated byte-range requests should eventually be deduplicated, but low-ranked unique candidates should not simply disappear. A future UI can spotlight the best candidate and collapse alternatives under an “Other detected streams” section.

---

# NEXT FEATURE AREA — Subtitle Intelligence

Real-world testing has exposed two subtitle classes.

## Subtitle class 1 — explicit subtitle resources

Some players show subtitles and also expose recognizable subtitle network requests such as `.srt` or `.vtt`. Existing media detection does not yet classify these as subtitle candidates.

This is the basic, deterministic subtitle problem and should be solved first.

## Subtitle class 2 — subtitles visible in the player but no obvious subtitle resource is exposed

Other players provide subtitle choices in the UI, but neither AIDM Stream Inspector nor the older Stream Detector exposes an obvious `.srt` entry.

Possible sources may include:

- `.vtt` or another subtitle format rather than `.srt`;
- an extensionless subtitle endpoint;
- a subtitle URL returned inside API/JSON data;
- HLS master-manifest subtitle renditions;
- DASH text adaptations;
- HTML `<track>` elements;
- player configuration/JavaScript data;
- a subtitle request triggered only after the user selects a language;
- cues transformed/generated inside the player.

The project should first solve the deterministic explicit-resource case, then attempt deeper discovery generically.

---

# M7 — Obvious Subtitle Candidate Detection — NEXT

## Goal

Teach the extension to recognize obvious subtitle network resources while preserving the architecture already established for media candidates.

Initial strong subtitle formats may include, where justified by implementation/testing:

- `.srt`;
- `.vtt`;
- `.ass`;
- `.ssa`;
- other clearly identifiable subtitle resources added conservatively.

M7 should also consider the existing M4.1 lesson: subtitle evidence may appear inside query-parameter values while the exact original outer request still needs to be preserved.

## Expected output concept

```text
[AIDM Subtitle][SRT]
URL: <exact captured request>
Referer: ...
Origin: ...
Language: unknown
```

Exact formatting is implementation-dependent.

## Architectural rules

- Subtitle detection is separate from primary media detection/ranking.
- The extension does not download subtitles.
- Exact signed/tokenized URLs remain unchanged.
- Request context should follow the same safe handling principles already established by M5.
- No site-specific hostname/provider rules.
- A successfully detected video stream must never imply that its subtitles have also been captured.

## Non-goals

M7 does not yet need to:

- infer subtitle language reliably;
- associate multiple subtitle tracks with a playback group;
- parse manifests;
- scrape player JavaScript;
- inspect arbitrary API JSON;
- mux subtitles into video;
- integrate with AiDM.

Those belong to later subtitle milestones.

---

# M7.1 — Subtitle Metadata and Association

After obvious subtitle resources are reliably detected, associate useful metadata where the browser/player exposes it.

Potential metadata:

- language;
- human-readable label;
- default status;
- forced status;
- playback/page relationship;
- association with the selected/high-priority media candidate.

The goal is to evolve from isolated subtitle URLs toward a playback asset model such as:

```text
Playback Asset
├── preferred/master media candidate
└── subtitles
    ├── English
    ├── Hindi
    └── Arabic
```

Association must be evidence-driven. Do not guess solely from timing or filenames if stronger browser/manifest evidence is available.

---

# M7.2 — Deep Subtitle Discovery

M7.2 targets the harder class: subtitles that exist in the browser player but are not exposed as obvious `.srt`/`.vtt` requests.

Use layered evidence rather than site-specific patches.

Conceptual discovery layers:

```text
Layer 1 — obvious subtitle URL
.srt / .vtt / .ass / ...

Layer 2 — response/MIME evidence
extensionless subtitle responses

Layer 3 — manifest-declared subtitles
HLS EXT-X-MEDIA subtitle groups / DASH text adaptations

Layer 4 — page/player/API evidence
HTML track elements, player config, JSON/API responses, user-triggered subtitle requests
```

This milestone is deliberately ambitious. The goal is to exceed the limitations of simple network-extension matching where browser APIs expose enough evidence, but the project should accept genuine browser/server-side limits rather than invent unsupported bypass logic.

---

# Why master manifests remain strategically important

The cinejoy ranking test proved that a parent HLS playlist can expose multiple video qualities plus a separate audio rendition to yt-dlp.

A proper HLS master manifest can also declare alternate audio and subtitle renditions. Therefore higher-level manifest understanding may eventually support:

```text
Master playback asset
├── video
│   ├── 1080p
│   ├── 720p
│   └── 360p
├── audio
│   ├── English
│   └── Hindi
└── subtitles
    ├── English
    └── Arabic
```

The master is therefore not merely “another m3u8 link”; it can be a map of the whole adaptive playback asset.

Manifest parsing is not required for M7 unless evidence shows it is the smallest correct next step. It remains a strong later source for audio/subtitle relationship intelligence.

---

# Later media metadata and page context

After basic subtitle discovery, the extension should also gather useful playback metadata where reliably available:

- page/movie title;
- top-level page URL;
- embedded player/frame URL;
- audio languages;
- subtitle languages/labels;
- resolution;
- bitrate;
- codec;
- MIME/content type;
- master vs media playlist role.

Movie/page title should normally come from page/player context rather than being assumed to exist in the media manifest.

---

# Planned deeper traffic-intelligence milestones

These remain valid but should activate only when reproducible evidence requires them.

## M5.1 — Deep candidate request metadata

Capture a fuller browser-observable request picture such as request ID, method, resource type, frame/initiator context, and additional safe request headers.

Activation condition: a reproducible feature or reproduction gap demonstrates that the basic M5 context is insufficient.

## M5.2 — Candidate response and redirect lifecycle

Correlate status, response headers, MIME/content type, redirects, final URLs, errors, and completion state where browser APIs expose them.

This may also support extensionless media/subtitle detection.

## M5.3 — Request-chain correlation

Understand relationships among page/player requests, bootstrap/token requests, parent manifests, child renditions, and segments.

Conceptually:

```text
page / player
    ↓
bootstrap / API
    ↓
master or signed manifest
    ↓
video / audio / subtitle renditions
    ↓
segments
```

Correlation must remain evidence-driven and explainable.

---

# Controlled reproduction philosophy

AiDM remains outside the diagnostic loop while downloader requirements are being isolated. Use direct tools such as yt-dlp for controlled experiments first.

Only after a requirement is independently proven should AiDM implement it.

For reproduction testing:

> Change one evidence-backed variable at a time.

Do not blindly export browser secrets or infer universal rules from one success/failure.

---

# Structured handoff — later

The eventual extension output should be structured machine-readable data rather than shell commands.

It should be able to represent concepts such as:

```text
preferred candidate
alternative candidates
media type / manifest role
page URL / title
player/frame URL
User-Agent / Referer / Origin
relevant request context
audio tracks
subtitle tracks
useful media metadata
```

The exact schema remains deferred until ranking, subtitle discovery, and playback relationship models stabilize.

---

# AiDM integration — later

The extension remains the browser-intelligence/session-handoff layer.

AiDM remains responsible for downloading and post-processing using aria2c, yt-dlp, and FFmpeg as appropriate.

For adaptive media, the preferred design is to hand AiDM enough structured information that the downloader can choose/download the correct video/audio/subtitle tracks and produce a normal playable output without requiring users to manually combine components.

---

# Active development order

The current evidence-backed order is:

```text
M0–M5 foundation                         ✅
M6 candidate ranking                     ✅
M6.1 ranking presentation cleanup        ✅

M7 obvious subtitle candidate detection  ← NEXT
M7.1 subtitle metadata + association
M7.2 deep subtitle discovery

then, as evidence requires:
page/movie title + richer media metadata
manifest/audio/subtitle relationship intelligence
MIME / response-based detection
deduplication and stronger ranking
request/response lifecycle analysis
request-chain correlation
structured handoff
AiDM integration
```

This ordering is intentionally evidence-driven. If testing exposes a stronger reproducible blocker, the roadmap can be revised, but working layers should not be destabilized merely to chase one volatile website.

---

# Long-term architectural checkpoint

AIDM Stream Inspector is evolving through increasingly useful levels of understanding:

```text
observe traffic
      ↓
detect media
      ↓
preserve request context
      ↓
rank candidate usefulness
      ↓
discover playback components
      ↓
understand relationships
      ↓
structured handoff
```

The goal is not to collect the largest possible list of URLs.

> The goal is to identify the most useful playback asset, preserve the browser context needed to reproduce it, discover its associated audio/subtitle components, and hand that structure cleanly to AiDM.

That intelligence must remain generic, cross-browser, evidence-driven, privacy-conscious, and independent of any single streaming website.
