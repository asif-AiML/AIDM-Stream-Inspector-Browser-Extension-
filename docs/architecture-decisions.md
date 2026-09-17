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

## AD-011 — Media detection must be layered; URL extensions are only the first evidence source

The final Stream Inspector must not assume that useful media requests always expose recognizable media extensions such as `.m3u8`, `.mpd`, `.mp4`, or `.webm` in the request URL.

Previous testing with third-party stream-detector extensions already showed why extension-only matching is insufficient: media playback could succeed while the detector showed no useful stream, or only unrelated resources such as PNG/TXT requests. Real streaming systems may use opaque CDN paths, API-style endpoints, signed routes, segmented-media URLs, byte-range requests, or other request patterns whose URLs do not visibly identify the media format.

Examples of valid media traffic that may not contain an obvious filename extension include:

- opaque CDN URLs such as `/v1/abc123xyz?...`;
- API-style endpoints such as `/stream?id=12345`;
- segment paths such as `/chunk/000123`;
- signed/tokenized routes where the useful evidence is in response metadata rather than the path;
- manifests or media delivered through routes whose visible URL does not end in `.m3u8`, `.mpd`, `.mp4`, or another recognizable suffix;
- media identified primarily by MIME/content type, byte-range behavior, repeated segment traffic, manifest/segment relationships, or frame/initiator context.

Therefore candidate detection is intentionally designed as a layered evidence pipeline rather than one hardcoded extension list.

### Detection layer 1 — obvious URL evidence

The first detection layer, beginning with M4, uses conservative URL/path evidence for clearly recognizable media requests, including HLS manifests, DASH manifests, direct video files, and common audio files.

This layer is intentionally simple and deterministic. Its purpose is to establish a reliable baseline, not to solve all real-world stream detection.

A request that does not match one of these obvious patterns must be treated as `not an obvious candidate yet`, not as permanently non-media.

### Detection layer 2 — response/MIME evidence

A later milestone should inspect browser-observable response metadata where available. MIME/content type can identify media even when the URL is opaque.

Relevant examples include HLS/DASH manifest MIME types, `video/*`, `audio/*`, and other response metadata that materially increases confidence that a request is media-related.

This layer should complement URL evidence rather than replace it.

### Detection layer 3 — behavioral and structural evidence

Some streaming traffic may still be ambiguous even after URL and MIME inspection. Later detection should consider relationships and request behavior, such as:

- repeated segmented-media requests;
- byte-range media traffic;
- manifest-to-segment relationships;
- related CDN request patterns;
- frame/iframe or initiator context;
- useful response metadata;
- grouping requests that appear to belong to the same playback session.

The objective is not to guess aggressively from any single weak clue. Multiple weak signals can eventually be combined into stronger evidence.

### Detection layer 4 — candidate ranking

Candidate detection and candidate ranking are separate responsibilities.

Detection answers:

> Is this request plausibly media-related?

Ranking answers:

> Among the candidates observed for this playback session, which ones are most likely to be useful to the user/AiDM?

Ranking may later consider factors such as manifest type, master-vs-media playlist role, direct-file characteristics, resolution/bitrate metadata, duplication, request relationships, freshness, and other evidence gathered by previous layers.

M4 must not perform ranking or claim that an obvious candidate is the final/best stream.

### Signed and tokenized URL rule

Detection logic may inspect URL components for classification, but the original captured media URL must always be preserved exactly for later handoff.

The extension must never strip, clean, normalize away, or rewrite signed query parameters such as `token`, `expires`, `signature`, `policy`, or `auth` merely to make classification easier. A signed media URL may stop working if even seemingly unimportant components are altered.

### Long-term checkpoint

The architectural checkpoint is:

> URL-extension matching is a useful first detector, not the definition of media.

If future development begins treating the M4 extension list as the complete detection model, this decision should be revisited before adding more hardcoded filename rules. The intended direction is layered evidence: obvious URL clues first, then MIME/response evidence, then behavioral/structural relationships, followed by candidate ranking.


## AD-012 — M8 canonical playback title evidence

M8.1's playback gate and emission/reset rules in AD-013 below supersede this
initial milestone's unconditional title promotion. Source selection is unchanged.

M8 adds title discovery as a separate page/background layer. It does not derive
names from media/subtitle URLs or modify those candidate models. The selected
title is a page-level hypothesis for the current target tab, not proof of a
playback association or an external movie identity.

### Sources and selection

`src/content/playback-title.js` is a read-only content script, registered for
existing HTTP(S) host scope at `document_idle`, in the default isolated world,
with `all_frames: false`. Its new `src/content/` directory holds page-context
code, distinct from the background page and network observer. It reads only:

| Source | Selection priority | Strength |
| --- | --- | --- |
| `meta[property="og:title"]` | First | HIGH |
| `meta[name="twitter:title"]` | Second | HIGH |
| Exactly one visible `h1` | Third | MEDIUM |
| `document.title` | Fallback | LOW/FALLBACK |
| Outer-page `iframe[title]` attributes | Alternate evidence only | SUPPORTING ONLY |

`selectPlaybackTitle()` in `src/background/playback-title.js` implements this
small ordered model; it does not reuse or change media ranking. The first usable
value at the highest priority wins. Conflicting alternatives remain in the
bounded evidence list. Strength describes the source, not verified movie identity;
structured metadata may be stale, branded, or wrong on a particular page.

Iframe attributes are observable even when the iframe document is cross-origin,
but there is no evidence that any particular iframe owns playback. They therefore
cannot override page metadata or become the sole canonical title. The script does
not enter same-origin or cross-origin iframe documents, inspect player globals,
or traverse shadow roots. Embedded-document titles and provider-specific metadata
remain unobserved. JSON-LD inspection is deferred; no general crawler is added.

Empty/whitespace-only values are rejected. Exact `Home`, `Player`, and `Watch`
values are rejected for heading/document fallback selection, ignoring case.
Structured metadata can legitimately name a film `Home`, so that exclusion does
not apply there. The script trims outer whitespace only, retaining punctuation,
Unicode, spaces, branding, and year text as supplied. It never invents a cleaner
title or generates a filename. AiDM owns future filesystem sanitization.

### Isolation, lifecycle, and bounded state

The content script announces relevant metadata changes without sending titles
from background tabs. The background checks the extension sender ID, current
target tab ID, and top-level frame ID, then requests a fresh snapshot using
`tabs.sendMessage(..., { frameId: 0 })`. Responses are checked against current tab
URL and a request version, so delayed responses after target/navigation changes
cannot normally replace newer state. Browser-provided routing supplies tab/frame
identity; page fields cannot nominate another tab. A page URL is retained as
context but is not printed in title logs.

The existing target setter also resets title state. Initial module load and
subsequent target changes request the current document's metadata; tab navigation,
URL/title changes, and completion can refresh it. A loading navigation clears the
selected state and invalidates older requests. The Chromium import path and the
Firefox background-script loader both load the same new title observer. Media and
subtitle observers, including their existing reset behavior, remain unchanged.

`currentPlaybackTitle` contains `{ title, source, strength, evidence, tabId,
frameId: 0, pageUrl }`. It holds only the current selection/snapshot, not a map of
all visited pages. Repeated canonical title values in the same target selection
do not produce another full log; changed provenance/alternates still update the
internal state. A changed title or loss of usable title evidence is logged once.
Target reset or background restart may log the same title again.

Reads are limited to four tags per metadata source, four iframe attributes, and
one visible H1 (only examined when there are at most eight H1 elements). Values
longer than 2048 characters are skipped rather than truncated into a plausible
name. The background accepts at most 16 evidence items. No state is persisted.

### Dynamic metadata

A filtered `MutationObserver` schedules a coalesced read after 250 ms when title,
selected meta, H1, or iframe-title evidence may have changed or been removed.
It also responds to pageshow, popstate, and hashchange. Ordinary unrelated text
mutations do not cause metadata rescans. Only added/removed subtrees are checked
for relevant elements; no polling or arbitrary visible-text scraping is used.
The content script suppresses unchanged snapshots before notifying the background.

History API monkey-patching is not used. Same-document navigation can be refreshed
through tab URL updates or relevant metadata mutations. Pure CSS visibility
changes to headings are not independently watched; a later relevant refresh
rechecks visibility. If the page leaves old OG metadata in place, that higher
priority evidence can keep winning over a changed document title. This milestone
does not guess which stale fields a particular SPA intended to replace.

### Permissions and browser boundaries

No entries were added to `permissions` or `host_permissions`. Static content-script
registration uses the existing HTTP(S) scope; there is no `scripting`, `tabs`,
`activeTab`, or new host permission. Tab URL access on eligible pages uses the
existing host access. There are no new fetches, injected page-world scripts, DOM
mutations, candidate associations, or UI changes.

Both browser families support the shared content-script/message approach. See
[content-script registration](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/content_scripts)
and [frame-targeted messaging](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/sendMessage).
Restricted browser pages, extension pages, and pages without granted host access
cannot supply this metadata. Already-open pages may need reloading after extension
reload so the script is present. Missing receivers produce a bounded unavailable
notice, not a fabricated title. An invalidated old content script stops observing
and requests a page reload in its console warning. Background restarts lose the
selection/log history; the current target is queried again when reconstructed.

### Manual Firefox checks, then Brave/Chromium

1. Reload the temporary extension in `about:debugging#/runtime/this-firefox`, open
   its background console, focus a playback tab, and reload that page. This is
   necessary to attach the new content script to an already-open document.
2. **A — structured metadata:** on a page with OG title, expect one
   `[AIDM Playback Title]` showing that title, source `og:title`, HIGH strength,
   target tab ID, and top-level frame. Document-title evidence remains listed.
3. **B/C — fallback/noisy title:** test a page without OG/Twitter metadata. A single
   visible H1 wins at MEDIUM; otherwise document.title is LOW/FALLBACK. Branding,
   punctuation, Unicode, and year text must remain as supplied. A page with
   stronger metadata must select it rather than guess-cleaning the noisy title.
4. **D — iframe:** inspect a page with a player iframe title attribute. It appears
   as supporting evidence and cannot override the page title, even if the iframe
   is cross-origin. No embedded-document title is claimed.
5. **E — dynamics:** navigate within an SPA, or change its document.title/OG
   content through the page DevTools for a controlled local check. Expect one
   new full log when the selected title changes. Reassigning the same title must
   not add a full log. Removing stronger metadata should reveal the next fallback.
   Changing document.title alone does not override an unchanged valid OG title.
6. **F — tabs:** switch between two playback tabs. Each selected title must belong
   to the current target. Metadata changes in the other tab must not be logged.
   Navigate quickly and confirm an older page title does not replace the new one.
7. Confirm HLS/DASH/media rankings, request headers, obvious subtitles, MIME
   promotion, and subtitle duplicate merge lines behave as before. Network should
   show no extension-generated replay/fetch requests; the manifest permissions
   remain unchanged.
8. **G — Brave:** reload in `brave://extensions` or `chrome://extensions`, reload
   playback pages, and repeat A–F. Also close worker inspection, allow idle/restart,
   and resume/switch tabs; a fresh title log after restart is expected. Existing
   cross-browser manifest warnings remain applicable.

Local validation: 18 controlled selection/DOM/message/lifecycle/bootstrap cases
passed, including priority, generic/empty values, Unicode, duplicate suppression,
metadata removal, context invalidation, tab/frame isolation, stale responses, and
both loading paths. Syntax and unchanged existing media/subtitle JavaScript and
permission lists were verified. No automation dependency was installed. Actual
Firefox/Brave playback validation remains pending owner testing.

M9 can consume this single current title state and its provenance for UI. Title
editing, final selection UI, media/subtitle association, filename generation,
JSON-LD, embedded-document inspection, persistence, and AiDM handoff remain
separate future work. M9 is not implemented here.

## AD-013 — M8.1 playback title gating and duplicate suppression

Title collection and promotion are separate. The existing M4/M4.1 detector still
classifies requests, M6 still ranks/logs media, and then `network-observer.js`
passes the detected candidate type and tab ID to `observePlaybackMedia()` in
`src/background/playback-title.js`. There is no second detector or media store.

The gate opens on **HLS, DASH, or DIRECT_VIDEO (VIDEO)** for the current target.
All scores qualify, including a direct MP4 at LOW/30. Audio-only, subtitle-only,
and MIME subtitle diagnostics do not open it. This is evidence of a detected
media candidate, not confirmation of successful playback or ownership by a
particular movie. A homepage trailer, video ad, or detected fragment can qualify;
identifying the intended main asset remains outside this milestone.

`currentTitleEvidence` retains the bounded M8 selection and alternate evidence
even before media. `currentPlaybackTitle` stays null until the gate opens and a
usable title exists. The first qualifying media observation immediately promotes
the cached selection, then requests one fresh top-level metadata snapshot. Media
arriving before metadata waits for the snapshot callback. Repeated media requests
do not initiate repeated title reads. Existing document/metadata updates continue
to refresh evidence before and after promotion, using the unchanged M8 priorities.

Full-log identity is `JSON.stringify([tabId, selectedTitle])` within the current
target/navigation window. Source, strength, and alternate evidence update
internally without another full block when the selected title string is unchanged.
A changed title logs once. Empty evidence clears the promoted value without
inventing a title; loss/recovery of metadata does not erase the last emitted title
key. The missing-receiver diagnostic is emitted at most once per window and only
after media evidence exists. There are no ignored-page diagnostics.

### Reset and browser lifecycle

- The existing target-change hook clears the gate, evidence, promoted title, and
  log history, including when the target becomes unavailable. Returning to a
  previously selected tab requires fresh qualifying traffic. There is no cross-tab
  candidate cache or playback-session inference.
- The existing `tabs.onUpdated` listener clears these values on `loading` or URL
  changes, invalidates older asynchronous reads, and recollects on completion or
  URL/title updates. Metadata-only title changes preserve the gate. URL changes
  observed first in a validated metadata snapshot also clear the previous gate.
  Same-URL reloads reset, and same-document URL changes conservatively reset too.
- Movie A → homepage therefore loses Movie A's gate; Movie B must supply new media
  evidence. A same-document playback change that alters neither URL nor navigation
  status has no explicit asset boundary in these APIs. Its changed metadata can
  update the title, but this milestone does not infer when playback stopped.
- Navigation properties may arrive in multiple events. A later reset can require
  another candidate even if one was observed earlier in loading. Do not recover
  old gates by guessing that two pages belong to the same playback.
- Target/frame checks, current tab URL validation, and request-version checks
  remain in place. No iframe document inspection is added. Missing host access or
  content-script receivers still prevents title collection.
- Firefox now loads the title coordinator before starting the network observer,
  matching Chromium's existing ordering, so the gate hook exists for the first
  observed candidate. Subtitle listener behavior/reset rules remain unchanged.
- State holds one target's bounded snapshot, a boolean gate, and scalar log/read
  bookkeeping. No maps, persistent storage, permissions, or network requests were
  added. Background restart loses the gate/history in either browser model.
  Chromium MV3 can therefore require new qualifying traffic and later emit the
  same title again; already-buffered playback may stay silent until new traffic.

Browser references: [tab update events](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/onUpdated)
and [Chromium worker lifetime](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

### Manual Firefox checks, then Brave/Chromium

1. Reload the extension, open its background console, and reload the test pages
   so their title content scripts are current. Keep the tested page as target.
2. **A — homepage:** with no HLS/DASH/video candidate, expect no playback-title
   output. `currentTitleEvidence` may contain metadata; `currentPlaybackTitle`
   should be null. Subtitle-only traffic must not qualify it.
3. **B — movie:** select/start playback. Expect the first qualifying media log
   followed by the strongest current title once, with M8 source/strength/evidence.
   Metadata already observed before playback should not need another mutation.
4. **C — duplicates:** re-observe the same metadata or continue repeated media
   requests. Expect no duplicate full title block while the selection is unchanged.
5. **D — improvement:** let the player update metadata, or edit the selected OG
   title in page DevTools for a controlled check. A different selected title logs
   once; reassigning the same value stays silent. Changing a weaker document title
   alone must not beat unchanged OG metadata.
6. **E/F — tabs:** switch to a non-media documentation tab; expect no playback
   title. Select another playback tab and start/reload media; only its title can
   promote. Returning to the first tab requires fresh media after the reset.
7. **G — MP4:** test direct-video playback without manifests or subtitles. LOW/30
   still qualifies. Also navigate movie → homepage → another movie: the homepage
   remains silent without new media, and the second movie must use fresh evidence.
8. Confirm existing media rankings/context, subtitle roles, URL/MIME consolidation,
   MIME promotion, and subtitle merge lines remain unchanged. Compare Network for
   absence of extension-generated requests; manifest permissions are unchanged.
9. **H — Brave/Chromium:** repeat after reloading the unpacked extension and pages.
   Close worker inspection, allow idle/restart, then resume/reload playback. The
   title must wait for fresh qualifying media if in-memory state was lost.

Validation: 26 controlled in-memory cases passed, including gate ordering, title
selection, duplicate suppression, target/frame isolation, delayed callbacks,
navigation, missing receivers, and both bootstrap paths. Twenty pre/post media
and subtitle observations produced identical candidate logs. Syntax passed;
detector, ranker, request-context extraction, subtitle code, content script, and
manifest were checked unchanged. No test infrastructure/artifacts were added.
Actual Firefox and Brave playback tests were not performed by the coding agent.

M9 may later present the gated title and provenance alongside candidates. UI,
playback grouping, subtitle association, persistence, export, naming, and AiDM
handoff remain deferred. M9 is not started here.

## AD-014 — M9.0 normalized playback-state bridge

`src/background/playback-state.js` is the single UI-facing read model and snapshot
API. It retains previously log-only media observations and reads authoritative
subtitle/title records through small internal accessors. It does not maintain
second copies of the subtitle store or title selection, consume console output,
or run detection/classification/ranking again. The popup only requests a snapshot.
This is an internal development model, not the M10 export/handoff schema.

### Producers and ownership

- `network-observer.js` passes each existing M4/M4.1 media result, its M6 score and
  evidence, M6.1 priority, and the same request's safe M5 context into
  `rememberPlaybackMedia()`. Console output remains unchanged. HLS, DASH, VIDEO,
  and AUDIO observations are retained; no media deduplication is added.
- `subtitle-evidence-observer.js` still owns its one logical-resource map and the
  existing URL/MIME candidate builder, role classifier, evidence consolidation,
  exact-resource key, and observation limits. The coordinator reads its retained
  resources through `getSubtitlePlaybackCandidates()`. Failed/unpromoted MIME
  diagnostics do not enter this list. Thumbnail and unknown roles remain explicit.
- `getPlaybackTitleState()` supplies only the M8.1-promoted title, the current
  observed top-level page URL, and the existing media-gate boolean. Collection,
  source priorities, title gating, and duplicate-title rules are unchanged. Raw
  page-title evidence remains private before promotion. Page URL may be known on
  a non-playback page; it is null when the title metadata bridge has no snapshot.
- Request context belongs to each media candidate or subtitle observation, never
  to a global last-header/session cache. Cookie/Authorization remain `present`
  or `not observed`. No cookie values, Set-Cookie, or new secret sources are added.

### Exact snapshot structure

The root object returned by `getPlaybackStateSnapshot()` is:

```js
{
  generation: Number,
  tabId: Number | null,
  pageUrl: String | null,
  title: null | {
    title, source, strength, evidence, tabId, frameId: 0, pageUrl
  },
  status: {
    playback: "target-unavailable" | "not-detected" | "detected",
    mediaAvailable: Boolean,
    timedTextAvailable: Boolean
  },
  media: {
    bestCandidateId: Number | null,
    candidates: [MediaObservation],
    omittedCandidateCount: Number
  },
  subtitles: { candidates: [SubtitleResource] }
}
```

The notation above describes types, not literal export JSON. Status `detected`
comes from the existing M8.1 gate; audio-only or subtitle-only observations do not
open it. `timedTextAvailable` includes likely subtitles, thumbnails, and unknown
timed text; false means none retained/observed, not proof of absence. No session
readiness or reproducibility claim is inferred. There is no user-selection state.

Each `MediaObservation` contains:

```js
{
  id, url, type,
  detection: { pathname, source },
  ranking: { score, evidence, priority },
  requestContext: { userAgent, referer, origin, cookie, authorization, range },
  requestId, tabId, frameId, parentFrameId, requestType,
  response: null
}
```

`url` is the exact captured string. `detection.pathname` is classification evidence
only, including M4.1 embedded paths; it never replaces that URL. Missing M5 values
retain the existing `not observed` convention. Missing optional media frame/type
fields are null. Media response metadata is not currently correlated/retained by
the media pipeline, so `response` is explicitly null, not invented from subtitle
responses or another request.

Each `SubtitleResource` is the existing logical M7.2B.1 resource:

```js
{
  id, tabId, url, format, role, roleEvidence, evidence, discoveries,
  observationCount, observations, omittedObservationCount,
  firstStatus, latestStatus
}
```

Each entry in `observations` retains the existing M7.2B candidate shape:
`type`, `format`, detector `pathname`/`source`, exact `url`, `discovery`, `mime`,
`role`, `roleEvidence`, `evidence`, `requestContext`, `requestId`, `tabId`,
`frameId`, `parentFrameId`, `requestType`, and
`response: { status, contentTypes, completed }`. Unavailable optional browser
fields are omitted during JSON serialization; context is null when unobserved.
Language and label are not inferred. Use the resource's merged role/evidence for
presentation; observation roles retain their individual provenance. The first and
latest request contexts remain attached to those specific observations rather
than being combined into synthetic headers. MIME confirmation remains in evidence
and observations even if a later observation lacks MIME.

The coordinator makes a deep JSON copy on every read. Maps, DOM objects, raw
browser request/header objects, functions, and mutable engine references never
cross the API. Direct background-console callers also receive an independent copy.

### Best candidate and bounds

Best means the highest already-computed M6 score among retained media. Equal
scores keep the first observed candidate; there is no new role/type tie-breaker.
`bestCandidateId` references one entry in `media.candidates`, or null when empty.
It is an engine default, not a user selection or confirmation of usability.

At most 128 media observations are retained. On overflow, the oldest observation
other than the current best is released. Thus an early master survives a later
fragment flood; other recent alternatives remain visible, regardless of score.
`omittedCandidateCount` reports capacity loss. Console detection is not suppressed.
Same URL/range repeats still occupy distinct observations with distinct IDs.

Existing subtitle bounds remain 128 resources and 64 detailed observations per
resource (first plus latest 63), with total/omitted counts. There is one current
target's state, no browser history or persistent storage.

### Lifecycle and late responses

M8.1's existing `clearPlaybackTitle()` now also calls `resetPlaybackState()`,
clearing media/subtitle retention and advancing a local generation. It already
runs on target changes, loading/URL changes, and a changed URL first seen in a
validated title snapshot. All UI components therefore share the title's reset
boundary. The old independent target-only subtitle reset is replaced by this
common hook. This supersedes M7.2B.1's earlier same-tab-navigation retention rule.

Pending subtitle requests record their generation at the observed send event.
Their existing bounded context map remains responsible for completion/error/
redirect cleanup. A late response from an earlier generation or one without
matching send context may still produce its existing diagnostic candidate output,
with `Playback retention: diagnostic only ...`; it cannot enter or merge into the
current logical-resource map. This prevents late Movie A responses from restoring
old URLs or headers after navigation to Movie B. The dedupe key and merge/role
rules for current correlated observations are unchanged. Uncorrelated fallback
logs are not resource-deduplicated, because current playback ownership is unknown.

Both bootstrap paths install the coordinator before network observation. Title
callbacks retain their version/tab/URL guards. Background restart loses media,
subtitle, generation, title, and emission history; the target is reconstructed,
and candidate state rebuilds only from fresh observations. A popup request does
not replay traffic or recover old candidates from browser history. Early startup
can return an empty/target-unavailable snapshot; reopen after initialization.
Firefox's asynchronously loaded modules may briefly lack a message receiver.

Existing M8.1 limits remain: a navigation update can reset an early observation;
same-document playback changes without a URL/loading boundary are not distinct
assets; title metadata may remain stale; ads/trailers can satisfy the media gate.
No new playback grouping or document/frame ownership inference is introduced.

### Popup message and developer proof

The minimal action popup is `src/popup/popup.html`. `popup.js` calls:

```js
chrome.runtime.sendMessage({ type: "AIDM_GET_PLAYBACK_STATE" }, callback);
```

The background replies synchronously with the snapshot. The handler accepts only
the extension's own popup URL and extension ID, with no content-script `sender.tab`.
Page/content-script senders cannot obtain the snapshot through this API. There is
no push subscription, polling, export, or copy action. Standard callback messaging
works through the existing shared Firefox/Chromium paths; see
[runtime.onMessage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/runtime/onMessage)
and [Chromium messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

The developer popup displays status and counts only. `currentPlaybackSnapshot`
holds its one received snapshot for explicit DevTools inspection; signed URLs and
request contexts are not automatically rendered or logged. Reopening requests a
new snapshot. No CSS, media cards, checkboxes, selection, or final UI is implemented.
The manifest adds only `action.default_popup`; permission/host/content-script and
background declarations are unchanged.

### Manual tests — Firefox first, then Brave/Chromium

1. Reload the extension and test pages; keep the intended page as the target.
   Click the extension action. Expect the development bridge's status/counts.
   Inspect the popup console and evaluate `currentPlaybackSnapshot` for the full
   response. In the background console, `getPlaybackStateSnapshot()` gives a
   separate copy. Inspecting/focusing DevTools may affect the existing target
   policy; refocus playback and reopen the popup when needed.
2. **A — no media:** use documentation without media. Expect `not-detected`,
   null title/best ID, and empty lists. A known current page URL is acceptable.
3. **B/E — HLS/multiple candidates:** start a working player with parent and child
   playlists, then reopen the popup. Check exact captured URLs, original ranking
   scores/priorities/evidence, and that the best ID references the highest score.
   Verify each candidate's own Referer/Origin/User-Agent/Range against Network.
   LOW direct MP4 also remains retained and qualifies the M8.1 title gate.
4. **C — subtitles:** enable known VTT/SRT. Confirm logical resources, URL+MIME
   evidence, and distinct SUBTITLE/THUMBNAIL/UNKNOWN roles. Repeated exact requests
   increment observation count and retain their IDs/context in one resource.
5. **D — hidden MIME:** use the validated extensionless VTT endpoint. After a
   completed 2xx request with matched context, expect its exact outer API URL in
   the same list with format VTT and `mime-response` discovery. Failed MIME-only
   responses remain diagnostics, not UI candidates.
6. **F/G — reset:** navigate Movie A → homepage → Movie B and switch target tabs.
   Reopen each time. Old media, subtitle resources, title, and headers must not
   survive. Late old requests must not reappear in the new snapshot. Returning to
   an earlier target requires fresh observations. Snapshot generation advances.
7. **H — Brave/Chromium:** reload the unpacked extension and repeat the popup API
   checks. Close worker inspection, allow idle/restart, then reopen the popup:
   state may be empty until fresh traffic. No new permissions or active requests
   should appear. Existing manifest-development warnings remain applicable.

Validation: 34 in-memory cases passed, including both browser bootstrap paths,
header fallback, popup success/error, restricted message senders, deep snapshot
isolation, retention limits, MIME/role/dedupe behavior, and late-response/reset
races. Forty-four pre/post observations produced identical normal media/subtitle/
title console output. All JavaScript parsed; detection/ranking/role/content-script
code and permission lists were verified unchanged. Actual Firefox/Brave playback
and popup testing was not performed by the coding agent. No test dependencies or
generated test artifacts were added.

M9.1 remains the popup shell milestone. Candidate presentation, user selection,
quick copy, export, session readiness, YouTube intelligence, and AiDM handoff are
deferred. No next milestone is implemented here.


## AD-015 — M9.1.1 current-tab session retention and capture age

This supersedes AD-014's in-memory-only lifetime and synchronous popup reply.
The product rule is: retain only the current target's capture while staying on
that tab/page; flush on target loss/change or the existing navigation/SPA reset.
Returning to a previous tab never restores its old capture. Fresh traffic may
immediately build a new capture there. This is not a playback-history store.

### Storage and ownership

The existing playback coordinator writes one `chrome.storage.session` key:

```js
{
  aidmCurrentPlayback: {
    version: 1,
    snapshot: {
      generation, capturedAt, tabId, pageUrl, title, status, media, subtitles
    }
  }
}
```

The fields retain AD-014's shapes; `capturedAt` is milliseconds since epoch or
null before the existing HLS/DASH/VIDEO gate opens. It marks the beginning of the
capture, not the latest request, popup open, or proof that a URL remains usable.
Duplicate requests, metadata improvements, and background restoration preserve it.
A lifecycle reset clears it; the next qualifying capture gets a new timestamp.
The popup never reads storage and continues requesting `AIDM_GET_PLAYBACK_STATE`.

Session storage requires the new `storage` permission; host permissions are
unchanged. It remains restricted to trusted extension contexts by default. No
local/sync storage, secrets beyond the existing snapshot, credentials, history,
network replay, timers, or expiry decisions are added. Cookie/Authorization remain
presence flags, and exact URLs are copied without normalization. See
[MDN session storage](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/storage/session)
and [Chrome storage](https://developer.chrome.com/docs/extensions/reference/api/storage).

There is still one media store, one subtitle dedupe map, and one title/gate owner.
Restoration repopulates those existing owners, including candidate IDs and safe
per-request context. It does not create a competing UI store. Fresh observations
received while storage loads are merged through the existing bounded retention
and subtitle evidence/dedupe functions. Pending network requests are not persisted.

### Startup, validation, and flushes

The popup message listener is registered synchronously in `background.js`, before
Firefox's asynchronous module loading. It keeps the response channel open until
module startup, target discovery, and the restore attempt finish. Sender checks
still limit this snapshot API to the extension's popup.

Initial target discovery is distinguished from an actual target transition so it
does not erase the session copy before validation. Restore requires a supported
record version, detected playback, valid timestamp and candidate lists belonging
to the same target, an active/fully loaded tab, and exact equality of stored
`pageUrl` and the browser's current tab URL. Tab identity or URL unavailable,
loading, mismatch, or a lifecycle reset during initialization rejects the record.
Activation/focus/navigation events observed during startup conservatively veto
restoration; ambiguous startup favors fresh evidence over stale data.

Current page identity normally comes from the title bridge. If metadata is
unavailable, a generation-guarded `tabs.get` read can supply the current HTTP(S)
page URL without inventing a title or fetching the page. If identity cannot be
obtained, the in-memory capture is not retained for restoration.

The existing title reset clears media, subtitle resources, page identity, and
capture time, and schedules removal of the session key. This includes tab changes,
target unavailable, same-URL reload, tab URL changes, and SPA URL changes first
seen by the existing validated title path. Storage writes/removals are serialized
with only the newest pending snapshot retained, preventing an earlier save from
overtaking a later flush. Existing limits remain 128 media observations, 128
subtitle resources, and 64 detailed observations per subtitle resource.

Session storage is not disk-backed playback history and does not intentionally
survive full browser restart or extension reload/update. Unsupported storage,
API errors, or quota exhaustion are reported without logging snapshot contents;
in-memory observation continues, with no permanent-storage fallback. On a failed
save the coordinator also attempts to remove the older stored copy. Actual
storage failures cannot guarantee retention/removal. No unlimited-storage
permission is requested. Existing focus-loss target rules still apply: if the
browser reports the target unavailable, the capture is flushed even if playback
continues in the background. Same-document asset changes without an observable
URL/navigation boundary retain the existing M8.1 limitation.

### Popup and validation

The detected-playback view adds one secondary capture-age line. At popup render:
under one minute is `Captured just now`, 1–59 minutes is `Captured N min ago`,
and 60+ minutes uses whole hours (`1 hr`, `2 hrs`). Missing timestamps hide the
line. No interval, polling, automatic expiry, or validity claim is introduced.
Existing CSS supplies the styling.

Controlled in-memory tests cover both bootstrap paths, a popup message before
restore completes, exact same-tab restoration, ID/context/timestamp retention,
fresh observations during restore, subtitle duplicate merging after restart,
tab switch/return, focus loss, navigation and SPA resets, startup invalidation,
write/remove races, absent page metadata, storage failure, and age boundaries.
These are API mocks, not actual Firefox/Chromium execution.

Manual validation (Firefox first, then Brave/Chromium):

1. Reload the extension once to apply the storage permission, then reload/start
   a known playback page. Keep that tab selected. Expect the existing title,
   media/session/subtitle summary and `Captured just now`.
2. Close/reopen the popup on that same tab, then wait a few minutes and reopen.
   Expect the same capture and increasing age; no page reload is required.
3. With background inspection closed, allow/reproduce background suspension and
   reopen the popup on the same page. Compare `capturedAt` from the popup snapshot
   before/after: it must be unchanged. Extension reload is not worker suspension
   and is not a substitute for this test.
4. Switch to an unrelated tab and reopen: no playback details/age. Return to the
   old tab: only fresh observations can create a new capture. Inspect the single
   session key, if desired, without copying/logging its sensitive contents.
5. Navigate Movie A to another page/Movie B, including same-URL reload and SPA URL
   changes: no old title/media/subtitles/context may restore.
6. Confirm subtitle roles/counts, best-candidate priority, and console diagnostics
   remain unchanged. Repeat in Brave/Chromium. Capture age is informational only.

Actual Firefox/Brave manual tests remain pending owner validation. M9.2 candidate
list presentation/selection, exports, and AiDM integration remain unimplemented.
