# AIDM Stream Inspector — Subtitle Architecture and Future Handoff

This document records the subtitle-specific architecture so subtitle detection, naming, handoff, and AiDM post-processing do not become scattered across unrelated roadmap notes.

It is intentionally broader than the current implementation. Some sections describe tested behavior; others lock future design decisions that should guide later work.

---

# Current status

The subtitle work has reached:

- **M7 — Obvious subtitle candidate detection: PASS**
- **M7.1 — Subtitle role classification + basic metadata: PASS**

Current tested behavior includes direct subtitle/timed-text detection for obvious resources such as SRT and VTT.

Real-world testing confirmed two important facts:

1. Some players expose genuine subtitle resources directly in browser traffic.
2. `.vtt` is not automatically a subtitle.

A VTT may instead be used for seek-bar thumbnails/storyboards.

For example, testing found both of these patterns during real playback:

```text
.../thumbnails.vtt
```

and:

```text
.../cache/subs/<opaque>/<opaque>.vtt
```

Manual inspection with `curl` confirmed that the first contained thumbnail/image cue data, while the second contained real subtitle text cues.

Therefore subtitle detection and subtitle-role classification remain separate concerns.

---

# Core architectural principle

AIDM Stream Inspector is the browser-intelligence layer.

AiDM is the downloader/post-processing layer.

The extension should discover and describe subtitle assets. It should not download, encode, mux, or save final files itself.

Conceptually:

```text
Browser playback
      ↓
AIDM Stream Inspector
      ↓
main media candidate
subtitle candidate(s)
page/playback metadata
browser request context
      ↓
structured handoff
      ↓
AiDM
      ↓
download + naming + optional packaging
```

This separation must remain intact.

---

# Subtitle detection layers

Subtitle work is intentionally layered.

## M7 — Obvious subtitle candidate detection

Purpose:

> Detect subtitle/timed-text resources that are already plainly visible in browser network traffic.

Examples include:

- `.srt`
- `.vtt`
- `.ass`
- `.ssa`

Detection should preserve the exact browser request URL, including query strings, signatures, tokens, and outer wrapper URLs.

Query-embedded subtitle evidence should follow the same general philosophy already established for media detection: inner decoded paths may be used as evidence, but the original browser request remains the handoff candidate unless later evidence proves otherwise.

## M7.1 — Subtitle role classification

Purpose:

> Decide whether an obvious timed-text candidate is likely a real subtitle or another timed-text resource such as a thumbnail/storyboard track.

Useful role concepts include:

```text
likely subtitle
likely thumbnail/storyboard
unknown timed text
```

Filename/path clues are evidence, not absolute truth.

Examples of strong thumbnail/storyboard clues may include tokens such as:

```text
thumbnail
thumbnails
thumbs
storyboard
storyboards
sprite
sprites
```

Examples of positive subtitle clues may include path/name tokens such as:

```text
subs
subtitle
subtitles
caption
captions
```

These rules must remain generic. No test website or provider hostname should be hardcoded.

The extension should not silently erase thumbnail VTT traffic during development. It should classify it correctly so future user-facing UI can suppress/collapse it without losing diagnostic evidence.

---

# Future M7.2 — Deep subtitle discovery

## M7.2A — Passive response MIME evidence implemented

M7.2A adds a diagnostic response observer in
`src/background/subtitle-evidence-observer.js`. It listens to
`webRequest.onResponseStarted` with `responseHeaders`, using the existing HTTP(S)
host permissions and `webRequest` permission. This informational event exposes
response headers/status without body access or traffic modification.

The exact MIME allowlist is:

| Normalized Content-Type | Evidence strength |
| --- | --- |
| `text/vtt` | Strong declaration of timed text; may still be thumbnails/metadata |
| `application/x-subrip` | Strong declaration of subtitle data; contents unverified |
| `application/ttml+xml` | Strong declaration of timed text; contents unverified |

Header names and MIME matching ignore case; MIME parameters such as charset are
ignored for matching. The original Content-Type is also printed. Missing,
non-string, or multiple Content-Type fields do not qualify. Generic
`application/xml`, `text/xml`, `application/octet-stream`, `application/json`,
`text/plain`, and manifest MIME types do not trigger subtitle evidence. Path,
request type, and frame clues alone do not trigger it either. No weak-evidence
URL heuristic is implemented in this increment.

Each MIME-only qualifying response produces `[AIDM Subtitle Evidence][MIME]` with the
exact response URL, evidence code/reason, strength, Content-Type, status,
request ID, tab ID, frame ID, parent frame ID, and browser request type. It
explicitly states that a usable subtitle URL is not established. An HTTP error
with a matching MIME can still produce evidence; the displayed status must be
considered. MIME proves only what the server declared, not successful retrieval,
cue contents, subtitle role, association, or external reproducibility.

MIME classification remains independent of M7/M7.1 and does not construct
candidates or invoke ranking. M7.2A.1 consolidates presentation: an obvious
subtitle/timed-text request receives one log containing URL, role, and response
evidence. A thumbnail VTT retains its M7.1 role even with `text/vtt`. An opaque
URL with strong MIME still produces evidence when M7 detected nothing.

### Request context and isolation

`network-observer.js` shares its existing M5 formatting through
`formatRequestContext()`. Target-tab sends retain this formatted subset, request
URL/tab/frame/parent-frame/type identity, and any M7 subtitle evidence plus M7.1
classification in an in-memory map keyed by request ID. Cookie/Authorization values and unrelated headers are never
retained in that map; response Set-Cookie is not logged or retained.

The response handler checks the current target tab independently. It matches
request context by request ID, exact URL, tab ID, and frame ID. Request IDs can
span redirects, so a previous hop's headers must not be attached to a later URL.
Every observed response removes its entry even if MIME is irrelevant or the
target changed. Redirect, completion, and error events remove pending entries
and emit any still-pending obvious subtitle with the available metadata. Completed
and redirect events request `responseHeaders` for this fallback. The map is capped
at 512 pending entries; eviction emits pending obvious subtitle evidence with an
explicit capacity-limit observation before releasing it.

There is no persistent storage. Background restart, eviction, unobserved send
events, or mismatched context can leave response evidence without request
headers. The log then says request context is unavailable and prints M5 fields
as `not observed`. At response start, URL evidence can be reconstructed with the
unchanged media-first detector; MIME-only evidence also remains visible. Hanging
requests wait for response, a terminal event, eviction, or background shutdown.
There are no timers or persistent records.

Frame 0 denotes the main frame; positive frame IDs identify subframes within
the logged tab, with the browser-provided parent frame ID alongside them. These
are request-frame facts, not a reconstructed playback/frame tree or page title.
No DOM inspection or iframe traversal is added.

### Browser/API boundaries investigated

- Both Firefox and Chromium expose response headers/status through
  [onResponseStarted](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onResponseStarted).
  The implementation uses the existing shared bootstrap paths and no new permissions.
- The shared webRequest events used here do not expose response bodies. HLS
  `EXT-X-MEDIA`, DASH text AdaptationSets, and subtitle data inside JSON cannot be
  inspected from these headers. A manifest MIME alone cannot establish that it
  contains subtitles. These sources were investigated but not implemented.
- Firefox has a separate
  [filterResponseData API](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/filterResponseData),
  requiring additional permissions and responsibility for forwarding/closing the
  response stream. It is outside this passive, shared implementation; no body
  filter or workaround is used.
- Chromium's
  [webRequest API](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
  exposes only permitted requests, may omit some cache-served traffic, and has
  no equivalent body field on this response event. Existing request-header
  exposure/fallback differences remain applicable. No DevTools protocol is used.
- The repository has no page/content-script bridge. DOM tracks, player state,
  generated cues, and inline bootstrap configuration are currently unobserved,
  not proven inaccessible to every possible extension architecture. A later
  scoped content script would need separate frame/permission design; the
  background page's DOM is not the playback page's DOM.
- Generic/mislabelled MIME, previously loaded resources, and data only inside
  bodies or player state remain unresolved by this increment. Absence of evidence
  does not prove absence of subtitles or identify the hidden delivery mechanism.

### Manual Firefox test

1. Reload the extension in `about:debugging#/runtime/this-firefox` and open its
   background console with **Inspect**. Then focus the intended playback tab.
2. Reload the hidden-subtitle player from initialization with subtitles off.
   Watch for `[AIDM Subtitle Evidence][MIME]` before toggling subtitles.
3. Start playback, enable subtitles, and switch languages if available. Compare
   evidence timing, URL, Content-Type/status, and tab/frame IDs with the page
   Network panel. Frame IDs distinguish top-level and embedded-frame requests;
   the evidence source in this implementation is always network MIME.
4. When an extensionless response declares an allowlisted MIME, expect a new
   evidence log even though it has no `.srt`/`.vtt` suffix. Check exact query
   encoding/order and same-request User-Agent/Referer/Origin/Range. Cookie and
   Authorization remain presence-only. If the tested server supplies no such
   response, record the MIME discovery result as unresolved rather than failure
   of existing M7 or proof of a specific hidden mechanism.
5. Repeat with known direct SRT/VTT controls, including a thumbnail VTT. Existing
   M7/M7.1 logs must remain, and media scores/reasons/priorities must be unchanged.
   Matching response MIME must appear in the same entry for that request ID.
6. Switch target tabs while traffic continues. Evidence must be logged only for
   the current target; missing request context must never borrow another request's
   headers. Compare page traffic with the extension enabled/disabled to check
   that observation adds no extension-initiated fetches or replays.

### Brave/Chromium sanity test

Reload the unpacked extension in `brave://extensions` or `chrome://extensions`,
inspect the service worker, and repeat the Firefox playback/control checks with
the playback tab focused. Also close worker DevTools, allow it to idle, then
switch tabs/reload playback and check that listeners recover. If the background
restarts between send and response, MIME evidence may legitimately report missing
request context. Existing documented MV3 manifest warnings remain applicable.

### Validation and next evidence checkpoint

Local syntax and in-memory validation passed: positive MIME/parameter/case
handling; broad-MIME and ambiguous-header exclusions; concurrent same-URL
request correlation; redirects/errors/completion cleanup; missing context;
status/frame/tab isolation; the 512-entry bound; and both mocked browser startup
and request-header fallback paths. All 272 existing M4–M7.1 log comparisons
matched the pre-change output. Detector, ranker, role classifier, type definitions,
and manifest were verified unchanged. No test framework was added.

Actual Firefox/Brave and hidden-player playback were not tested by the coding
agent. Subsequent owner testing validated M7.2A: an opaque API request declared
`text/vtt; charset=utf-8`, status 200, type `xmlhttprequest`; manual curl reproduction
of the exact captured URL returned real WebVTT. This establishes MIME discovery
for that observed response, not every server/player or universal reproducibility.

M7.2B should be selected from the resulting evidence: strong opaque-response
MIME may support later candidate construction and role/reproduction validation;
if MIME stays silent, a narrowly scoped DOM-track investigation may be more
useful. Body-only mechanisms need a separately justified approach within the
browser boundaries. No extraction, refetching, content scripts, body parsing,
association, downloads, or AiDM handoff were implemented here.

## M7.2A.1 — Same-request presentation consolidation

The request observer still runs M7 detection immediately, but defers subtitle
console output to `onResponseStarted`. Media ranking/output remains immediate
and unchanged. The response observer combines the stored URL evidence and M7.1
role with MIME evidence, raw Content-Type, status, exact URL, request/frame/tab
identity, and the shared safe M5 context in one entry. Generic or conflicting
Content-Type fields remain visible without becoming positive MIME evidence.

No MIME value overrides the role classifier: `/subs/english.vtt` is likely
subtitle, `thumbnails.vtt` is likely thumbnail/storyboard, and `english.vtt`
alone remains unknown timed-text. All three stay visible. MIME-only opaque
responses retain `[AIDM Subtitle Evidence][MIME]`, including the qualification
that a usable subtitle URL is not yet established by the extension.

Identity is browser request ID plus exact URL, tab ID, and frame ID validation.
Different request IDs remain separate even for byte-identical URLs. Redirect
hops are separate observations; old-hop headers never enrich the new hop.
No general deduplication or candidate promotion is implemented.

One-entry consolidation assumes the send/response lifecycle remains observable
within the retained state. On capacity eviction, pending obvious evidence is
printed rather than silently dropped. If its response arrives later, another
entry can appear with unavailable request context. Background shutdown can lose
pending evidence/context; response-start recovery cannot restore request headers,
and a failure after restart cannot recover a lost pending candidate. This is
an explicit bounded, non-persistent diagnostic limitation in both background
models, particularly relevant to Chromium MV3 suspension. A target change before
emission also prevents logging the former target's evidence, preserving current
target-tab isolation. No persistence or broad duplicate-suppression system is added.

### Manual consolidation checks — Firefox, then Brave/Chromium

1. Reload the extension in `about:debugging#/runtime/this-firefox`, inspect the
   background console, and focus the playback tab. Reload the player so requests
   occur after observation starts. Keep the page Network panel available.
2. **A — VTT:** trigger a known subtitle VTT. Expect one entry per request ID,
   with URL evidence, unchanged role, MIME evidence and Content-Type/status.
   There must be no second MIME-only entry for the same normal request lifecycle.
   Use a `/subs/` VTT for a positive role; `english.vtt` alone stays unknown.
3. **B — thumbnails:** trigger `thumbnails.vtt` with `text/vtt`. Expect one
   `[AIDM Timed Text][VTT]`, still likely thumbnail/storyboard, with both evidence
   sources. MIME must not promote the role.
4. **C — hidden API:** reload the MIME-positive hidden-subtitle player from
   initialization, enable subtitles and switch languages if available. Expect
   `[AIDM Subtitle Evidence][MIME]` for an opaque URL with strong MIME, preserving
   its exact URL, Content-Type/status, request context, and frame/tab IDs.
5. **D — SRT:** trigger an obvious SRT request. Expect one subtitle entry even
   with missing/generic MIME; `application/x-subrip`, when present, enriches it.
   A failed request before response start should still produce a fallback entry.
6. Compare request headers/URL with Network: User-Agent, Referer, Origin, Range
   remain as exposed; Cookie and Authorization are presence-only. Reload/request
   the same resource again: different request IDs should remain separate. Verify
   ordinary media scores/evidence and wrapped URL detection, then switch target
   tabs and confirm background-tab traffic does not appear.
7. Repeat A–D and the context/isolation checks after reloading the unpacked
   extension in `brave://extensions` or `chrome://extensions`. Close worker
   DevTools, let it idle, resume/reload playback, and inspect again. Missing
   request context after restart is a documented limitation, not borrowed data.

Local validation used in-memory event mocks, with no test framework or artifacts:
37 lifecycle/evidence cases and 40 exact pre/post media-log comparisons passed;
all JavaScript parsed, and detector/ranker/role classifier/bootstrap/manifest
were verified unchanged. Actual browser validation remains for the owner.

M7.2B remains deferred: evaluate promotion of strong MIME observations into
subtitle candidates with explicit format/role uncertainty and reproduction
limits. Language, association, extraction, body parsing, downloads, UI, and AiDM
handoff are not part of this cleanup.

## Remaining deeper sources

M7/M7.1 only cover resources that are already obvious enough to classify from browser-visible network evidence.

Some websites show subtitles in the player but do not expose an obvious `.srt` or `.vtt` request to ordinary stream detectors.

M7.2 should investigate these harder cases.

Potential subtitle sources include:

- HLS master-manifest subtitle renditions;
- DASH text adaptation sets;
- extensionless subtitle endpoints;
- subtitle URLs embedded in API/JSON responses;
- HTML `<track>` elements;
- player configuration/state;
- subtitle requests triggered only after a language is selected;
- other browser-observable relationships.

This milestone should remain evidence-driven. It must not assume every website exposes subtitles in the same way.

Failure is acceptable when the browser itself does not expose sufficient information or when server-side restrictions prevent safe reproduction. The project goal is stronger browser intelligence, not guaranteed bypass capability.

---

# Subtitle association is a playback-level problem

A subtitle should not be treated as an isolated file forever.

The long-term model is a **playback asset group**.

Conceptually:

```text
Playback asset
├── canonical title
├── main media/master candidate
├── audio track(s)
└── subtitle track(s)
    ├── language
    ├── format
    ├── role
    ├── default/forced state where observable
    └── browser request context
```

The extension should eventually associate subtitle candidates with the relevant page/playback group rather than simply emitting unrelated URLs.

This does not mean M7/M7.1 must solve association immediately. It is a future handoff requirement.

---

# Canonical title is shared playback metadata

Movie/page title discovery is not merely cosmetic.

It becomes the shared identity used for both the media file and subtitle sidecar files.

Raw stream/subtitle URLs often have useless names such as:

```text
4bXMPHUAXY1oime5tw26zw.mp4
1962573143.vtt
```

The future architecture should instead derive one canonical playback title and attach it to the whole playback group.

Conceptually:

```text
Page / player context
        ↓
canonical playback title
        ↓
        ├── media
        └── subtitle(s)
```

Example final naming:

```text
The Matrix.mp4
The Matrix.en.srt
The Matrix.hi.srt
```

or, if the original subtitle format is retained:

```text
The Matrix.mp4
The Matrix.en.vtt
```

The extension should discover/title the playback asset. AiDM should own filename sanitization and final filesystem naming.

The extension should not independently guess one title from the media URL and another title from the subtitle URL.

---

# Title-source strategy

The raw browser tab title should be treated as evidence, not blindly used verbatim.

For example, a page title may look like:

```text
Watch The Matrix (1999) Online Free - ExampleSite
```

while the desired canonical title may be closer to:

```text
The Matrix (1999)
```

Future title intelligence may prefer stronger sources when available, for example:

```text
player/API metadata
        ↓
structured page metadata
        ↓
document/page title
        ↓
sanitary fallback
```

The exact priority order remains future work and should be validated against real sites.

---

# Subtitle language and naming

When reliable language metadata is available, it should become part of the subtitle handoff rather than being inferred later from arbitrary filenames.

Example:

```text
Movie.mp4
Movie.en.srt
Movie.hi.srt
Movie.ar.srt
```

If language is genuinely unknown, AiDM should avoid inventing one.

A reasonable fallback may be:

```text
Movie.srt
```

for one unknown subtitle, or collision-safe names such as:

```text
Movie.subtitle-1.srt
Movie.subtitle-2.srt
```

for multiple unknown tracks.

Language/label/default/forced metadata should come from browser-observable evidence where possible, not from uncontrolled filename guessing.

---

# AiDM subtitle-output architecture

Once the extension hands subtitle metadata to AiDM, AiDM should support subtitle packaging without expensive video re-encoding.

The following rule is locked:

> **AiDM must not re-encode video/audio merely to attach subtitles.**

Full video re-encoding is inappropriate for ordinary subtitle attachment because it can:

- consume substantial CPU;
- take close to the movie duration or longer;
- increase file size;
- risk quality loss;
- unnecessarily modify already-valid video/audio streams.

Subtitle handling should therefore use low-cost paths.

---

# Recommended default — sidecar subtitles

The preferred default is to save the subtitle beside the media file with a matching canonical basename.

Example:

```text
The Matrix.mp4
The Matrix.en.srt
```

or:

```text
The Matrix.mp4
The Matrix.en.vtt
```

Advantages:

- essentially no post-processing computation;
- original movie file remains untouched;
- no second rewrite of a multi-gigabyte media file;
- original metadata/cover art remains untouched;
- subtitle can be replaced or removed easily;
- multiple languages are simple to represent;
- many media players can automatically discover sidecar subtitles when naming matches.

This is superior to requiring the user to search a separate subtitle website because the subtitle was captured from the same playback context and is therefore more likely to match the exact media version/timing.

Manual drag/add in a player remains a fallback when automatic sidecar discovery is unavailable.

---

# Optional mode — stream-copy muxing

AiDM may later offer an optional self-contained-file mode.

The correct approach is **muxing/stream copy**, not video re-encoding.

Conceptually:

```text
video    → copy
audio    → copy
subtitle → copy or lightweight subtitle-format conversion if the container requires it
```

For example, MKV can hold many subtitle formats naturally. MP4 may require conversion of an SRT subtitle stream to a container-compatible subtitle codec such as `mov_text`, but the expensive video/audio streams should still be copied unchanged.

This mode should normally complete far faster than re-encoding because FFmpeg is primarily remuxing streams rather than recompressing the movie.

---

# Cover art / thumbnail preservation during muxing

Loss of an embedded thumbnail/cover image is not an unavoidable property of muxing.

A source file may contain streams/metadata such as:

```text
video
audio
attached picture / cover art
chapters
container metadata
```

A simplistic FFmpeg mapping may omit some of these when producing the output.

Future AiDM muxing should deliberately preserve compatible:

- video;
- audio;
- chapters;
- metadata;
- attached cover art/thumbnail;
- other useful streams;

while adding subtitle tracks.

Container limitations still apply, but thumbnail loss should be treated as an implementation/mapping issue rather than accepted as the normal cost of muxing.

---

# Proposed future user choices in AiDM

A future subtitle workflow may expose choices conceptually like:

```text
Subtitle handling:

1 - Save with video (Recommended)
2 - Embed in video
3 - No subtitles
```

Meaning:

### 1 — Save with video

Create matching sidecar files.

Example:

```text
Movie.mp4
Movie.en.srt
```

This should be the recommended/default low-cost path.

### 2 — Embed in video

Use FFmpeg stream-copy muxing where container compatibility permits.

Do not re-encode video/audio merely for subtitle attachment.

### 3 — No subtitles

Ignore subtitle candidates during the AiDM download workflow.

The exact UI/CLI wording remains future work.

---

# Subtitle download engine and format authority

Some subtitle resources do not have a useful filename or suffix even though the browser receives a valid subtitle representation.

A real tested pattern is an API request whose query contains an upstream `.gz` source while the HTTP response itself declares:

```text
Content-Type: text/vtt
```

Manual reproduction confirmed that the outer API response contains real WebVTT subtitle content. A generic downloader may nevertheless infer an unusable name such as `unknown_video` because the request URL does not end in `.vtt`.

The following future decision is therefore locked:

> **For subtitle handoff, the delivered representation is authoritative; the URL filename is only one source of evidence.**

When strong response metadata identifies the delivered subtitle format, AiDM should use that format for the output filename even if the URL is extensionless, contains an unrelated inner filename, or causes another downloader to guess an unknown extension.

Examples:

```text
text/vtt
    → .vtt

application/x-subrip or another confirmed SubRip representation
    → .srt
```

The MIME-to-extension table should remain conservative and evidence-driven rather than speculative.

If URL evidence and response evidence disagree, both should be preserved in the handoff, but the format of the browser-delivered representation should normally determine the final subtitle suffix.

Example conceptual handoff:

```json
{
  "url": "https://api.example/subtitles/vtt?url=<encoded-upstream-resource>",
  "kind": "subtitle",
  "format": "vtt",
  "mime": "text/vtt",
  "discovery": "response-mime",
  "headers": {
    "referer": "https://example/",
    "origin": "https://example"
  }
}
```

For direct subtitle resources of this kind, the preferred AiDM download engine is **aria2c**, not yt-dlp.

The responsibility split is:

```text
AIDM Stream Inspector
    → discover exact subtitle URL
    → identify delivered format/MIME
    → preserve required browser request context

AiDM
    → choose safe final filename/extension
    → invoke aria2c for the direct HTTP resource

aria2c
    → fetch the response bytes exactly as delivered
```

Conceptually, AiDM may invoke aria2c with the required browser-observed context and an explicit output filename:

```text
aria2c
  + exact subtitle URL
  + Referer / Origin / User-Agent / other required context
  + explicit --out="Movie.en.vtt"
```

AiDM must not depend on yt-dlp filename inference for these subtitle endpoints.

An upstream `.gz` reference embedded inside the outer API URL does not mean AiDM should save a `.gz` file if the browser-facing endpoint already transforms/decompresses that source and returns `text/vtt`.

This decision applies to future direct subtitle handoff only. HLS/DASH media handling remains in its existing media-specific path.

---

# Future structured handoff

The extension should eventually hand AiDM a playback-level structured object rather than shell commands.

Conceptually:

```json
{
  "title": "The Matrix",
  "media": {
    "type": "hls",
    "url": "https://...",
    "headers": {
      "referer": "https://...",
      "origin": "https://..."
    }
  },
  "subtitles": [
    {
      "url": "https://...",
      "format": "srt",
      "mime": "application/x-subrip",
      "language": "en",
      "label": "English",
      "role": "subtitle",
      "default": false,
      "forced": false
    }
  ]
}
```

This schema is illustrative, not final.

Important principles are:

- one canonical playback title;
- one or more media/audio candidates;
- one or more subtitle candidates;
- subtitle format represented independently from URL filename;
- response MIME preserved when available;
- language/role metadata where proven;
- exact URLs preserved;
- relevant browser request/session context preserved;
- no Bash quoting as the primary handoff representation.

---

# Separation of responsibilities

## AIDM Stream Inspector

Responsible for:

- subtitle discovery;
- subtitle role classification;
- subtitle metadata where observable;
- delivered subtitle format/MIME evidence where observable;
- subtitle/media/page association;
- canonical playback title discovery;
- preservation of exact request URLs/context;
- structured handoff to AiDM.

Not responsible for:

- downloading final subtitle files;
- writing media files;
- FFmpeg muxing;
- video re-encoding;
- final filesystem naming.

## AiDM

Responsible for:

- downloading media and selected subtitles;
- selecting the appropriate downloader for each handed-off resource;
- using aria2c for direct HTTP subtitle resources where appropriate;
- sanitizing the canonical title into safe filenames;
- assigning subtitle extensions from the strongest confirmed representation evidence rather than blindly trusting URL suffixes;
- assigning matching media/subtitle basenames;
- sidecar subtitle output;
- optional stream-copy muxing;
- preserving compatible cover art/metadata during muxing;
- final output and post-processing.

---

# Long-term subtitle path

The intended progression is:

```text
M7
obvious subtitle/timed-text detection
        ↓
M7.1
subtitle vs thumbnail/storyboard role classification
        ↓
M7.2
deep subtitle discovery
(manifest / API / DOM / opaque endpoint evidence)
        ↓
subtitle metadata
(format / MIME / language / label / default / forced)
        ↓
playback association
(media + audio + subtitle grouping)
        ↓
canonical title discovery
        ↓
structured extension → AiDM handoff
        ↓
AiDM chooses resource-specific engine
        ↓
direct subtitle HTTP resource → aria2c
        ↓
sidecar subtitles by default
or optional stream-copy muxing
```

The important architectural rule is that subtitles are part of the playback asset, not an unrelated download.

The final goal is a low-cost, user-friendly workflow where the browser extension discovers the correct subtitle for the exact playback and AiDM names/packages it without unnecessary media re-encoding.
