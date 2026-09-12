# AIDM Stream Inspector — Detection Notes

This document records real-world detection tests, observed behavior, failures, corrections, and lessons that should guide later candidate detection, ranking, and subtitle work.

Sensitive session values, signed tokens, and full live URLs containing credentials/tokens must not be preserved here. Test URLs are described structurally or redacted where necessary.

---

## M4 — Obvious media candidate detection

### Milestone purpose

M4 is the first conservative media-detection layer. It classifies obviously media-like target-tab requests from URL/path evidence such as HLS manifests, DASH manifests, direct video files, and common audio files.

M4 does **not** decide which candidate is best, understand master-vs-variant relationships, suppress media segments, or capture browser session context.

The main question for M4 is:

> Did the extension correctly recognize obvious media candidates while preserving the exact request URL?

### soap2dayhd.net / alternate mirrors

The extension detected HLS requests whose pathname contained `master.m3u8` followed by signed query parameters.

Structurally:

```text
https://<cdn-host>/<opaque-path>/master.m3u8?token=<redacted>
```

The extension correctly classified the request as HLS while preserving the exact signed URL.

The same user-visible media could also switch to a different CDN/server with a different physical HLS URL. This confirmed that detection must not depend on one hostname or URL shape.

Subtitles were available in the player, but the captured HLS URL did not itself provide subtitle files. This was early evidence that subtitle discovery needs its own layer.

### StreamTape / StreamWish

StreamTape exposed a direct-video request with a compound-looking filename such as:

```text
<Movie.Name>.mkv.mp4?stream=1
```

The extension classified it as VIDEO and the captured request was usable in testing.

StreamWish exposed multiple HLS candidates such as:

```text
.../master.m3u8
.../index-v1-a1.m3u8
.../index-a1.m3u8
```

All were correctly detected as HLS, but they were not equally useful. Later tests also reinforced that some child/variant-looking playlists can represent partial or less useful playback pieces.

Important lesson:

> Correct media classification does not mean every candidate is equally useful.

Do not hardcode a filename such as `v1-a1` as universally bad; it is regression evidence only.

### Shaka Player

Shaka playback exposed many direct `.mp4` fragment candidates resembling successive video/audio chunks.

These were technically media but poor user-facing choices compared with higher-level manifests.

This became the strongest early evidence that:

> Detection quantity is not detection quality.

It also demonstrated adaptive audio/video separation: a full-duration video candidate can still be silent if the audio rendition is separate.

### Plex correction

Earlier assumptions treated Plex as a likely session-dependent failure. Retesting showed useful Plex HLS candidates could play/download without manually supplied browser-session context.

This corrected an important testing mistake and established a project-wide rule:

> One failed reproduction attempt is not sufficient evidence for architecture.

### M4 verdict — PASS

M4 established the deterministic media-detection baseline:

- obvious HLS detection;
- signed-query preservation;
- direct-video detection;
- multiple candidates surfaced rather than prematurely chosen;
- Firefox + Brave compatibility;
- no site-specific detection logic.

---

## M4.1 — Query-embedded media evidence

Averotv-style playback exposed a useful HLS request whose outer pathname did not contain `.m3u8`.

Structurally:

```text
https://<worker-host>/hls?url=https%3A%2F%2F<upstream-host>%2F...%2Findex.m3u8&provider=<value>
```

The outer request itself was useful, but the media evidence lived inside an encoded query-parameter value.

M4.1 solved this generically by:

- inspecting query-parameter values for obvious media evidence;
- safely decoding for classification evidence;
- preserving the exact original outer browser request as the candidate URL;
- avoiding hostname/provider/parameter-name hardcoding.

### M4.1 verdict — PASS

The averotv regression target became detectable as HLS while M5 request context continued to flow naturally.

---

## M5 — Candidate request-context observation

### Milestone verdict — PASS

M5 associates browser-observed request context with media candidates.

Observed fields include:

- exact candidate URL;
- User-Agent;
- Referer;
- Origin when exposed;
- Cookie presence state;
- Authorization presence state;
- Range presence state.

### movi.pk reproduction ablation

A controlled reproduction study established:

```text
URL only                              → fail
URL + Referer + UA + cookies          → success
URL + Referer + UA                    → success
URL + Referer                         → success
```

Therefore the minimum experimentally proven sufficient context for that specific test was Referer.

This validated M5 without implying that Referer is universally sufficient.

### fboxtv correction

One testing period produced repeated 403 failures even when external yt-dlp tests included combinations of:

- Referer;
- User-Agent;
- Origin;
- browser cookies;
- browser impersonation.

A later fresh test on the same platform family succeeded with conventional browser-derived context.

The remaining errors were fragment read timeouts/retries while downloading continued.

Therefore fboxtv is currently classified as a **volatile regression target**, not proof of a hidden browser-only requirement.

This reinforces the testing rule:

> A single failure is evidence for investigation, not evidence for architecture.

---

## M6 — Candidate ranking foundation

### Why M6 existed

Multiple independent tests converged on the same problem:

- Shaka produced large numbers of low-value media fragments;
- StreamWish exposed several HLS candidates with unequal usefulness;
- adaptive streams could expose separate video-only and audio-only renditions;
- a higher-level manifest could potentially preserve the complete adaptive playback structure.

M6 therefore introduced ranking after detection rather than suppressing candidates inside the detector.

Core separation:

```text
Detection → Is this media?
Ranking   → How useful is this candidate likely to be?
```

### Implementation model

`src/core/candidate-ranker.js` returns ranking information based on explainable evidence.

The score is an estimated usefulness score, not a confidence percentage, confirmed manifest role, or replay guarantee.

Current evidence includes conservative path/filename clues such as:

| Evidence | Contribution |
| --- | ---: |
| HLS or DASH adaptive manifest candidate; role unconfirmed | +60 |
| VIDEO or AUDIO candidate; completeness unknown | +30 |
| Delimited `master` token in HLS filename | +30 |
| Playlist-like HLS filename/immediate directory clue | +10 |
| Video/quality-rendition-like HLS filename | -10 |
| Audio-rendition-like HLS filename | -20 |
| Unknown/conflicting role naming | 0 |

These clues are deliberately weak and generic. No site/provider hostname and no `v1-a1` penalty is hardcoded.

### Real-world cinejoy ranking test — PASS

A cinejoy playback exposed structurally:

```text
/playlist/<opaque-id>.m3u8
/video/.../video_720p.m3u8
/video/.../video_1080p.m3u8
/hls/.../audio_1.m3u8
```

The ranking system produced the expected relative order:

```text
parent/playlist-like HLS   → 70
video rendition            → 50
audio rendition            → 40
direct video candidates    → 30
```

The 70-point candidate did **not** literally contain `master` in the URL. Its ranking came from generic adaptive-manifest + playlist-like evidence.

### External validation of the 70-point candidate

The highest-ranked candidate was passed directly to yt-dlp with the required browser-derived request context.

A format inspection showed:

```text
audio-only track
360p video-only
720p video-only
1080p video-only
```

Downloading from the parent candidate caused yt-dlp to select a combined adaptive format similar to:

```text
6000+audio-Track_1
```

The completed output was then independently validated:

- ffprobe confirmed an audio stream;
- FFmpeg `astats` returned real non-silent peak levels around -4 dB;
- playback contained working audio.

Therefore the ranking system successfully placed the more structurally useful parent candidate above the separate video-only and audio-only child renditions.

This is an important milestone result:

> Ranking solved multiple previously separate-looking problems by putting the higher-level adaptive manifest in the spotlight.

It avoided selecting a silent video-only rendition while preserving yt-dlp's ability to discover and combine the associated audio rendition.

### M6 verdict — PASS

M6 is now validated both structurally and through a completed real-world audiovisual download.

---

## M6.1 — Ranking presentation cleanup

The first M6 console wording printed:

```text
Priority score: 30 (higher = likely more useful)
Priority score: 70 (higher = likely more useful)
```

The parenthetical phrase described the scale but was misleading when repeated beside every candidate.

M6.1 changed presentation to readable priority labels such as HIGH / MEDIUM / LOW while keeping the numeric score and ranking evidence.

This makes the intended candidate much easier to recognize during manual testing.

Ranking weights and detection behavior remain unchanged.

### M6.1 verdict — PASS

Manual testing confirmed the new labels are easier to interpret.

---

## Ranking-related issue still pending — duplicate range requests

Testing also exposed repeated identical direct-video URLs with different `Range` values, for example:

```text
Range: bytes=0-
Range: bytes=<later offset>-
Range: bytes=<later offset>-
```

These are repeated byte-range requests for the same media resource rather than genuinely distinct media candidates.

This suggests a future deduplication milestone.

Important distinction:

```text
low-ranked unique candidate → keep
exact repeated candidate    → deduplication candidate
```

Do not make low ranking equivalent to detection suppression.

A future UI can spotlight the preferred candidate and collapse lower-ranked alternatives rather than deleting them.

---

# Subtitle discovery — newly classified test problem

Subtitle testing has now exposed at least two useful classes.

## Class 1 — explicit subtitle resources

Some streaming players expose subtitles in the UI and also issue obvious subtitle network requests such as `.srt` or similar resources.

The older Stream Detector can detect these on some platforms, while AIDM Stream Inspector currently cannot because subtitle candidate classification has not yet been implemented.

This is the deterministic basic subtitle problem and should be solved first.

## Class 2 — subtitles visible in the player but no obvious `.srt` entry

Other platforms expose subtitle choices in the player UI, yet the older Stream Detector does not reveal an obvious `.srt` candidate.

Possible causes include:

- WebVTT rather than SRT;
- extensionless subtitle endpoints;
- subtitle URLs inside API/JSON responses;
- HLS master-manifest subtitle declarations;
- DASH text adaptations;
- HTML `<track>` elements;
- player configuration data;
- subtitle requests triggered only after selecting a language;
- cues transformed/generated by the player.

This creates a two-stage subtitle roadmap:

```text
M7   obvious subtitle candidate detection
M7.1 subtitle metadata + association
M7.2 deep subtitle discovery
```

The goal is first to match the old detector where explicit subtitle resources are exposed, then attempt to exceed it using generic browser-observable evidence on harder players.

No site-specific subtitle rule should be added.

---

# Current regression-test philosophy

Maintain several target classes because one platform cannot exercise every problem:

- Shaka-style targets for segment floods and adaptive relationships;
- StreamWish-style targets for multiple HLS candidates;
- cinejoy-style targets for parent manifest + separate video/audio renditions;
- wrapped/proxy targets for query-embedded media evidence;
- movi.pk-style targets for Referer-dependent reproduction;
- volatile multi-provider targets such as fboxtv for robustness testing without overfitting;
- subtitle-rich players where explicit subtitle files are exposed;
- subtitle-rich players where no obvious subtitle resource is exposed.

Most importantly:

> Real-world test websites provide evidence. They must never become hardcoded architecture.

---

# Current long-term checkpoint

The project has progressed through:

```text
network observation
      ↓
tab-aware filtering
      ↓
media detection
      ↓
query-embedded media detection
      ↓
request-context observation
      ↓
candidate ranking
      ↓
subtitle discovery ← next
```

The strongest new lesson from M6 is that a higher-level adaptive manifest can function as a map of the playback asset rather than merely another `.m3u8` URL.

Where the stream is authored accordingly, such a parent manifest may describe:

- multiple video qualities;
- separate audio renditions;
- alternate audio languages;
- subtitle renditions.

This makes master/parent manifests strategically important for later media metadata, multi-audio, subtitle association, and structured handoff.

---

## M7 — Obvious subtitle detection implemented; browser validation pending

Supported suffixes are `.srt`, `.vtt`, `.ass`, and `.ssa`, matched without case
sensitivity. `.txt`, suffixes such as `.srt.txt`, and extensionless paths do not
qualify by themselves. These are URL-based candidates; bodies are not inspected.

`stream-types.js` defines `SUBTITLE` separately from HLS/DASH/VIDEO/AUDIO, with
SRT/VTT/ASS/SSA in `AIDM_SUBTITLE_FORMATS`. Subtitle evidence contains
`type: SUBTITLE`, a separate `format`, `pathname`, and `source`. No downstream
code needs to parse a display string to distinguish subtitles from media.

The existing detector now shares its pathname/query traversal between separate
media and subtitle extension lists. Both use outer pathname evidence first,
then each query value raw and after one guarded decode. The observer tries the
existing media detector first; subtitle detection is a fallback. Thus mixed
media/subtitle URL clues retain the pre-M7 media classification, even when the
subtitle clue appears earlier. M7 does not infer multiple assets from one request.

Subtitle output starts with `[AIDM Subtitle][SRT]` (or VTT/ASS/SSA). It uses the
same M5 header helpers and log block for the exact outer request URL, User-Agent,
Referer, Origin, Cookie presence, Authorization presence, and Range. Embedded
paths are evidence only and never replace the captured URL. Missing headers
remain `not observed`; Cookie and Authorization values are not printed.

The observer bypasses the media ranker for subtitles, so subtitle logs have no
media score, priority label, or ranking evidence. Existing media scores, reasons,
HIGH/MEDIUM/LOW labels, low-ranked candidates, and repeated range logs are unchanged.
No permissions, loading changes, active requests, dependencies, or storage were added.

### Manual Firefox validation

1. Reload the temporary extension in `about:debugging#/runtime/this-firefox`,
   then open its background console with **Inspect**.
2. Focus the intended playback tab on the existing subtitle regression target
   or another player known to expose subtitle requests. Reload playback and
   enable/select subtitles so the browser issues fresh requests.
3. Compare the page Network panel or old Stream Detector with the extension
   console. Each observed target-tab `.srt`/`.vtt`/`.ass`/`.ssa` resource should
   produce the corresponding `[AIDM Subtitle][FORMAT]` entry without a priority.
   A site may expose only some formats; use another known resource for the rest.
4. Compare the exact request URL, including signed queries, with the logged URL.
   For a wrapped request, expect the original outer URL, not its decoded subtitle
   path. Confirm User-Agent/Referer/Origin/Range where observed and presence-only
   Cookie/Authorization handling. Do not save live credentials in project files.
5. Confirm HLS/DASH/video/audio candidates still show their existing ranking
   evidence and priority labels. Switch tabs while the previous tab generates
   traffic; only the current target should produce candidate logs.

### Brave/Chromium sanity validation

1. Reload the unpacked extension in `brave://extensions` (or
   `chrome://extensions`) and inspect its background service worker.
2. Focus the playback tab, reload playback, enable subtitles, and repeat the
   subtitle URL/context and media-ranking comparisons above.
3. Close worker DevTools, allow the worker to idle, then switch tabs and resume
   playback. Reopen inspection and verify subtitle/media logging resumes for the
   current target. Existing documented MV3 warnings and header-exposure differences
   still apply; M7 adds no browser-specific behavior.

### Local checks and limits

Syntax checks passed. In-memory checks covered 32 direct/embedded subtitle
positives, false-positive exclusions, 260 unchanged media evidence/ranking cases,
520 exact pre/post media-log comparisons, subtitle exclusion from the ranker,
exact URL/context/redaction behavior, target isolation, both mocked background
loading paths, and both header-registration paths. The ranker, manifest, and
background loader were verified unchanged. No test framework was added.
Actual Firefox/Brave or website playback tests were not performed for M7.

M7 observes only requests the browser makes and exposes. Selecting a subtitle
may be necessary to trigger a request. Language/label/default/forced metadata
and subtitle-to-media association remain deferred to M7.1. Manifest/MIME,
extensionless, DOM/player, and API/JSON discovery remain deferred to M7.2.
Subtitle ranking, downloads, muxing, deduplication, UI, and AiDM integration
remain outside this implementation.

---

## M7.1 — Subtitle role classification and basic metadata

Owner testing after M7 confirmed obvious SRT detection and exposed two uses of
VTT: thumbnail preview data and subtitle cues. The owner manually checked the
bodies of `/thumbnails.vtt` and `/cache/subs/.../<id>.vtt`. The extension does
not repeat those fetches or inspect bodies.

This implementation narrows the earlier roadmap's M7.1 scope to role evidence.
Language metadata and subtitle-to-media association remain deferred.

`src/core/subtitle-role-classifier.js` is a pure helper returning `{ role,
evidence }`. `AIDM_SUBTITLE_ROLES` defines `SUBTITLE`, `THUMBNAIL`, and `UNKNOWN`;
these are inferred roles, separate from the unchanged M7 detection type/format.
Evidence items contain a code and reason, with no scoring system.

Rules, in order:

1. SRT, ASS, and SSA imply **likely subtitle** from their subtitle-specific
   format extensions; contents are still unverified.
2. For VTT only, filename tokens `thumbnail`, `thumbnails`, `thumbs`, `storyboard`,
   `storyboards`, `sprite`, or `sprites` imply **likely thumbnail/storyboard**.
   This specific filename evidence takes precedence over subtitle-positive clues,
   including `/subs/thumbnails.vtt` or `captions-thumbnails.vtt`.
3. Otherwise, a VTT directory component exactly `subs`, `subtitles`, or `captions`
   implies **likely subtitle**.
4. Otherwise, VTT filename tokens `subtitle`, `subtitles`, `caption`, or `captions`
   imply **likely subtitle**.
5. Other cases remain **unknown timed-text**. For example, `english.vtt` alone
   provides neither a supported role clue nor authoritative language metadata.

Matching ignores case. Filename token boundaries are start/end, hyphen,
underscore, or dot; `mythumbnails.vtt`, `spritesheet.vtt`, and `captioned.vtt`
do not match. Preview directory names alone do not establish a thumbnail role.
Only the pathname selected by M7 is inspected, including M4.1 embedded evidence.
No additional decoding, hostname checks, query hints, or body inspection occurs.

Likely subtitles retain `[AIDM Subtitle][FORMAT]`. Thumbnail and unknown roles
use `[AIDM Timed Text][VTT]`. All include `Role`, `Role path source`, and
`Role evidence`; all remain visible. The original outer URL and shared M5
context block remain unchanged, including presence-only Cookie/Authorization.
No language is inferred or displayed, and no candidate is suppressed.

The detector, M6 ranker/weights, M6.1 priorities, type definitions, and manifest
are unchanged. The new helper loads before observer registration through both
existing background paths. No network requests, permissions, dependencies, or
storage were added. This is heuristic interpretation, not proof of file contents.

### Manual Firefox test

1. Reload the extension in `about:debugging#/runtime/this-firefox`, open its
   background console with **Inspect**, and focus the intended playback tab.
2. On the existing SRT/thumbnail test player, reload playback and enable subtitles.
   Expect SRT as `[AIDM Subtitle][SRT]` with `Role: likely subtitle`.
   Expect `thumbnails.vtt` to remain logged as `[AIDM Timed Text][VTT]` with
   `Role: likely thumbnail/storyboard`.
3. On the VTT test player, compare `/thumbnails.vtt` against a VTT under `/subs/`.
   Expect likely thumbnail/storyboard versus likely subtitle respectively.
   An opaque VTT without these clues should stay visible as unknown timed-text.
4. Compare exact URLs and exposed headers with the page Network panel, including
   a wrapped request when available. Verify the outer URL stays intact and
   Cookie/Authorization remain presence-only. Check that HLS/video/audio scores,
   priority labels, and ranking reasons still appear as before.
5. Switch target tabs while requests continue; only the current target should log.

### Brave/Chromium sanity test

Reload the unpacked extension in `brave://extensions` or `chrome://extensions`,
inspect the service worker, and repeat steps 2–5 with the playback tab focused.
Also close worker DevTools, allow it to idle, then switch tabs/resume playback
and check that role/media logging resumes. Existing manifest warnings and header
exposure differences remain applicable; M7.1 adds no browser-specific API use.

### Validation and deferred work

JavaScript syntax checks passed. In-memory checks passed for 70 direct/embedded
role/context cases, four evidence-selection cases, 130 exact pre/post media-log
comparisons, target isolation, timed-text exclusion from media ranking, and both
mocked startup/header-fallback paths. Detector, ranker, type definitions, and
manifest were verified unchanged. No test framework was added. Actual M7.1
Firefox/Brave playback validation remains pending owner testing.

M7.2 deep discovery, manifest/MIME/DOM/API analysis, VTT body parsing, language
inference, association, default/forced flags, downloads/muxing, UI, deduplication,
and AiDM integration were not implemented.
