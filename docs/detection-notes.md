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
