# AIDM Stream Inspector — Subtitle Architecture and Future Handoff

This document records the subtitle-specific architecture so subtitle detection, naming, handoff, and AiDM post-processing do not become scattered across unrelated roadmap notes.

It is intentionally broader than the current implementation. Some sections describe tested behavior; others lock future design decisions that should guide later work.

---

# Current status

The subtitle work has reached:

- **M7 — Obvious subtitle candidate detection: PASS**
- **M7.1 — Subtitle role classification + basic metadata: PASS**
- **M7.2A — MIME discovery: validated by owner testing**
- **M7.2B — MIME candidate promotion: validated by owner testing**
- **M7.2B.1 — Exact-resource deduplication: implemented; browser validation pending**

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

Before M7.2B promotion, each MIME-only qualifying response produces
`[AIDM Subtitle Evidence][MIME]` with the
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
- At M7.2A there was no page/content-script bridge. M8 now adds a title-only
  bridge (see architecture decision AD-012); DOM tracks, player state,
  generated cues, and inline bootstrap configuration remain unobserved,
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

M7.2A.1 deferred promotion to M7.2B, implemented below. Language, association,
extraction, body parsing, downloads, UI, and AiDM handoff remain outside both
milestones.

## M7.2B — Promote successful MIME-discovered candidates

The existing observer now builds the same enriched subtitle candidate object for
M7 URL evidence and MIME-only discovery. It does not introduce another detector,
ranker, candidate store, export schema, or response-body reader.

### Promotion gate and timing

MIME-only promotion requires all of:

- one unambiguous Content-Type in the existing strong allowlist;
- `webRequest.onCompleted` observed with HTTP status 200–299;
- the matching retained send record, validated by request ID, exact URL, tab ID,
  and frame ID;
- the request still belongs to the current target tab.

`onResponseStarted` only establishes first-byte receipt, not completed transfer.
For a potential MIME-only promotion, the observer retains Content-Type/status
and the safe request context in the existing 512-entry map until completion.
A subsequent network error produces diagnostic MIME evidence, not promotion.
Non-2xx responses, redirects, and responses without matching context likewise
remain diagnostics. No external reproducibility test runs in the extension.
The existing completion listener also handles a retained request whose response
start was not observed, using the completion event's response metadata.

Obvious M7 subtitles keep their existing response-start/fallback log timing and
request-level consolidation. They remain URL-based candidates even on failure;
that is existing detection, not a claim of successful retrieval or new MIME
promotion. Generic MIME cannot suppress them. Different request IDs remain
separate, and media ranking/log timing is unchanged.

### Representation and role

The exact mappings, derived from the existing MIME allowlist, are:

| MIME (case-insensitive, parameters ignored) | Candidate format |
| --- | --- |
| `text/vtt` | `VTT` |
| `application/x-subrip` | `SRT` |
| `application/ttml+xml` | `TTML` |

Uppercase format values follow the existing `AIDM_SUBTITLE_FORMATS` convention.
TTML is a new format constant for an already-supported MIME; `.ttml` URL detection
was not added. Broad XML, octet-stream, JSON, and plain-text MIME do not promote.

Strong MIME determines the delivered format even if a URL/embedded suffix says
something else. Original URL evidence remains in the candidate evidence list;
for example, a URL-detected SRT served as `text/vtt` has format `VTT` and retains
its SRT URL evidence. An API URL containing an encoded `.gz` upstream path stays
byte-for-byte the candidate URL; it is never replaced by the upstream resource.

Existing M7.1 role evidence is preserved for obvious candidates, including
thumbnail/storyboard roles. MIME-only candidates reuse the same classifier on
the outer request pathname. VTT filename matching strips `.vtt` only if present,
so extensionless names can use the existing preview/subtitle tokens and directory
clues. No query/upstream path supplies a MIME-only semantic role. VTT without
supported clues remains `UNKNOWN`; SRT MIME gives likely subtitle from its format;
TTML currently remains `UNKNOWN`. MIME alone never establishes a VTT subtitle role.
Unknown and thumbnail candidates use `[AIDM Timed Text][FORMAT]`, while likely
subtitles use `[AIDM Subtitle][FORMAT]`. Promoted entries show
`Discovery: response MIME` and do not use the MIME-only diagnostic heading.

### Shared transient candidate shape

`buildSubtitleCandidate()` in `subtitle-evidence-observer.js` enriches both
sources into this development model:

- `type: SUBTITLE`, `format`, detector `pathname` and `source`;
- exact `url`, `mime`, `discovery: url | mime-response`;
- `role`, `roleEvidence`, and `evidence` containing URL and/or MIME provenance;
- `requestContext` with User-Agent, Referer, Origin, Range, and Cookie/Authorization
  presence only (or null when unavailable for an obvious candidate);
- `requestId`, `tabId`, `frameId`, `parentFrameId`, and `requestType`;
- `response: { status, contentTypes, completed }` with original Content-Type
  values retained, including ambiguous declarations on obvious candidates.

The candidate is built for the existing console consumer and is not persisted.
This is not a final handoff contract. `network-observer.js` extracts the same safe
M5 fields once into an object; both media formatting and subtitle context reuse
that extraction. Missing individual headers remain `not observed`; no header is
assumed universally required for reproduction. A matched observed send is the
minimum context gate, not proof that another client can reproduce the resource.
Cookie/Authorization values and response Set-Cookie are never retained or logged.

### State and browser limits

Completion, errors, and redirects release pending state. Capacity eviction emits
retained subtitle/MIME evidence before releasing it, without promotion when
completion has not been observed. A background restart or eviction can prevent
promotion because request context is lost; missing-context responses remain
diagnostic where observed. Existing late-response duplicate limitations from
M7.2A.1 remain. A hanging MIME-only request can wait until completion, failure,
eviction, or shutdown. No timers, persistence, permissions, or active requests
were added. Both Firefox's background path and Chromium's worker use the same
implementation; lifecycle and header-exposure differences still apply.

### Manual Firefox test, then Brave/Chromium

1. Reload the extension through `about:debugging#/runtime/this-firefox`, inspect
   its background console, then focus and reload the playback page. Open the
   page Network panel for comparison. Observe from player initialization.
2. **A — hidden MIME-only:** use the previously validated API subtitle playback,
   enable subtitles, and wait for the request to complete. Expect one candidate
   with format `VTT`, `Discovery: response MIME`, MIME/status, the exact outer API
   URL, and matched M5 context. Its role may be unknown or likely subtitle based
   on the supported outer-path clues. An embedded `.gz` must not affect format.
3. **B — obvious VTT:** trigger a known VTT. Expect one consolidated candidate
   with URL, MIME, and unchanged role evidence, not a second MIME candidate.
4. **C — thumbnails:** trigger `thumbnails.vtt`; expect likely thumbnail/storyboard
   under Timed Text, even with `text/vtt`.
5. **D — failure:** inspect a MIME-only response with a non-2xx status, or a
   request that fails after response start. Expect diagnostic MIME evidence only,
   no promoted candidate. Use the existing playback/network controls; do not
   store signed URLs or credentials in test files. If no such response is
   available, record this live test as not exercised.
6. Verify SRT and wrapped URL controls, media priorities/evidence, exact query
   encoding, exposed headers and presence-only credentials. Switch target tabs
   and confirm background-tab evidence cannot attach to the new target.
7. Reload the unpacked extension in `brave://extensions`/`chrome://extensions`
   and repeat A–D with the playback tab focused. Also close worker inspection,
   allow idle/restart, resume playback, and inspect again; missing-context
   diagnostics after restart are expected. Confirm there are no new permissions
   and no extension-generated replay/fetch traffic.

Local in-memory validation passed 57 evidence/lifecycle/model cases and 40 exact
pre/post media-log comparisons. JavaScript syntax passed; the detector, ranker,
bootstrap, and manifest were verified unchanged. Tests covered all mappings,
late errors, status boundaries, consolidation, role preservation, signed outer
URLs, safe context, identity mismatches, target changes, redirects, capacity,
and both request-header registration paths. No test infrastructure was added.
Actual Firefox/Brave playback testing remains for the owner; the prior manual
curl result is owner-provided evidence, not a runtime verification by the extension.

Language/labels, metadata, playback association, final selection, candidate
persistence, subtitle naming, structured handoff, and AiDM engine integration
remain later work. No next milestone is started here.

## M7.2B.1 — Subtitle-only exact-resource deduplication

After candidate construction and target filtering, `rememberSubtitleCandidate()`
in `subtitle-evidence-observer.js` groups subtitle/timed-text observations. MIME
promotion requirements, obvious URL detection, and request-level consolidation
remain unchanged. Diagnostic MIME evidence that was not promoted bypasses this
store and remains visible as before. Media candidates never enter this store.

The key is `JSON.stringify([tabId, exactFullUrl, format])`. Tuple serialization
only makes a collision-safe map key; it does not parse, normalize, decode, or
rewrite the URL. Tokens, parameter order, encoding, and fragments remain part of
identity. Different formats do not merge. Frame/context differences do not split
a resource; each retained observation carries its own values.

There is no playback-session model. The dedupe window is the current target-tab
selection: the existing `setCurrentTargetTabId()` clears candidate state whenever
its value changes, including becoming unavailable. Returning to a previous tab
starts fresh. Focus transitions can also reset the window. Same-tab navigation
alone does not reset it. This deliberately does not infer playback groups or add
navigation APIs. The pending request-context lifecycle is unchanged.

Each logical resource contains a local diagnostic ID, exact URL, tab, format,
merged role/evidence, discovery sources, total `observationCount`, first/latest
status, and an `observations` array of enriched M7.2B candidates. Request IDs,
frame/parent-frame IDs, request type, safe M5 context, response Content-Type/status,
URL/MIME evidence, and role evidence stay attached to their observations. No
Cookie/Authorization values are introduced. Request IDs can be inspected via
`resource.observations.map(item => item.requestId)`.

Evidence summaries union distinct items rather than replacing earlier evidence.
MIME summary entries omit raw Content-Type spelling/parameters so repeated charset
or case variants cannot grow the summary indefinitely; raw values remain in the
bounded observations. With the current fixed detector/classifier, summary items
are limited to the finite URL, normalized MIME, and role clues for one exact
URL/format. Future evidence producers must preserve that bound or add an explicit
summary cap. Discoveries are the existing finite `url`/`mime-response` values.

Unknown roles cannot erase a supported role. Thumbnail/storyboard evidence keeps
M7.1 preview precedence over subtitle clues; all contributing role reasons remain
in the summary. Repetition itself supplies no role evidence.

### Console and memory bounds

The first observation logs the existing full block plus `Candidate ID` and
`Observations: 1`. Repeats print one compact line referencing that candidate ID,
with total observations, incoming request ID/status, aggregate role, retained
history size, and omitted-history count. There is no console-line mutation.
The existing candidate builder's individual observations are not overwritten.
For development, `subtitleCandidates` in the background console holds the map;
`Array.from(subtitleCandidates.values())` exposes its current records.

- At most **128 logical resources**, evicting the oldest inserted resource with
  an explicit console notice. A later observation of an evicted resource starts
  a new full entry and count.
- At most **64 detailed observations per resource**: the first and the latest
  63. Older middle observations are released, while total count, first/latest
  status, and merged evidence/role summaries remain. Compact logs report
  `Omitted older observations`; a complete request-ID/context history beyond the
  cap is not retained. This is bounded diagnostic retention, not an audit archive.
- A target change, extension reload, or background restart clears dedupe state.
  Chromium MV3 suspension/restart can therefore produce a fresh full entry for
  a previously seen URL. Firefox background lifetime must not be assumed either.
  No persistent storage, new permissions, or browser-specific APIs were added.

### Manual Firefox tests, then Brave/Chromium

1. Reload the extension in `about:debugging#/runtime/this-firefox`, open its
   background console, then focus and reload the playback tab. Avoid changing
   target selection between the two requests being compared.
2. **A — MIME-only:** use the validated player that requests the same exact API
   subtitle twice. Wait for both requests to complete. Expect one full candidate
   and a compact merge line with `Observations: 2`, the same candidate ID, and the
   second request ID. Inspect the map to confirm both request IDs and exact URL.
3. **B — obvious VTT:** repeat with a direct VTT. Expect one resource retaining
   URL/MIME evidence and two observations, without another full block.
4. **C — thumbnail VTT:** repeat with `thumbnails.vtt`. Expect one Timed Text
   resource, still likely thumbnail/storyboard, with count 2.
5. **D — signed URLs:** where playback provides two different tokenized URLs,
   expect two full candidates. Compare the full strings in Network, not only
   their displayed filenames. Do not save live tokens in repository test files.
6. **E — tabs:** trigger the same URL in tab A, then select tab B and trigger it
   there. Expect a fresh full candidate for B with count 1; no headers or frames
   from A should be attached. Returning to A also starts a new dedupe window.
7. Confirm repeated MP4/HLS/audio logs and ranking remain unchanged, SRT detection
   still works, and failed MIME-only requests stay diagnostic. Inspect Network
   for absence of extension-generated fetch/replay requests.
8. Repeat A–E after reloading in `brave://extensions`/`chrome://extensions`.
   Close worker DevTools, allow idle/restart, resume playback, and inspect again;
   a fresh count after restart is expected. There are no new permissions.

Local in-memory validation passed 25 dedupe/lifecycle cases and seven repeated
media-log comparisons. Both mocked Firefox and Chromium bootstrap paths passed
same-target retention and changed/unavailable-target reset checks. Syntax and
unchanged detector, ranker, classifier, context extraction, and manifest were
checked. Actual Firefox/Brave playback tests were not performed by the coding
agent. Metadata, language, association, playback grouping, UI, and handoff remain
deferred; no general media deduplication or network behavior was added.

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

M8 now exposes `currentPlaybackTitle` for the current target tab, with source and
alternate evidence. See [AD-012](architecture-decisions.md#ad-012--m8-canonical-playback-title-evidence)
for sources, lifecycle, limits, and manual tests. Candidate association and final
filename generation remain deferred.

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
