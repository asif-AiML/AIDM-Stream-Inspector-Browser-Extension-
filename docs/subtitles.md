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
