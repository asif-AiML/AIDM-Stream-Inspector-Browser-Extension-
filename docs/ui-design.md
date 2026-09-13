# AIDM Stream Inspector — Future UI Design

This document records the future user-facing popup/UI direction for AIDM Stream Inspector.

The goal is to turn the extension's existing browser intelligence into a clear, compact workflow without exposing the full developer-console noise to normal users.

The UI should present the extension as an AiDM companion, not as a raw network inspector.

---

# Core UI principle

The extension already observes much more information than a user should normally see.

Internally it may know about:

- multiple HLS/DASH/direct-media candidates;
- request headers;
- response metadata;
- subtitle/timed-text resources;
- thumbnail/storyboard VTT files;
- repeated observations;
- ranking evidence;
- title evidence;
- request IDs and frame IDs;
- YouTube browser/session context.

The final UI should not simply print all of that.

Instead, the UI should answer three questions quickly:

1. **What am I watching?**
2. **What useful media/subtitle assets were found?**
3. **Can this be sent cleanly to AiDM?**

Developer diagnostics should remain available separately when needed.

---

# Unified playback view

The popup should present one current playback asset for the active target tab.

Conceptually:

```text
AIDM Stream Inspector

Title
  The Odyssey

Source
  HLS / DASH / Direct / YouTube

Media
  Best candidate

Subtitles
  English
  Hindi

Session
  Ready / Partial / Limited

[ Send to AiDM ]
```

The exact visual styling remains future work. The architecture matters more than decoration at this stage.

---

# Ordinary streaming view

For HLS/DASH/direct-media playback, the preferred UI should focus on the best usable candidate first.

Example:

```text
AIDM Stream Inspector

The Odyssey

Media
  HIGH  HLS Master
  1920x1080 / adaptive        if known

Subtitles
  English  VTT
  Arabic   SRT

Other detected streams   >

Session
  Referer      captured
  Origin       captured
  User-Agent   captured

[ Send to AiDM ]
```

Important principles:

- show the strongest candidate prominently;
- preserve access to other candidates without overwhelming the screen;
- do not expose raw ranking evidence by default;
- do not display fragment floods as if they were equally useful media choices;
- do not make low-ranked unique candidates disappear permanently.

The existing ranking model should guide presentation, not become a wall of numbers.

---

# Candidate presentation

The UI should distinguish between:

```text
Best candidate
Other detected streams
Developer/debug evidence
```

A useful hierarchy is:

```text
Media
  Best
    HLS Master — HIGH

  Other detected streams  (3)
    > HLS media playlist
    > 720p rendition
    > direct MP4
```

The user should not need to understand every candidate before sending the playback asset to AiDM.

However, advanced users should still be able to inspect or choose a different candidate when the top-ranked option does not work.

This preserves an important project principle:

> Ranking may influence presentation, but ranking mistakes must not become detection failures.

---

# Subtitle presentation

The normal subtitle section should show only useful subtitle candidates.

Example:

```text
Subtitles
  English   VTT
  Hindi     SRT
  Arabic    VTT
```

If language is not known:

```text
Subtitles
  Subtitle 1   VTT
  Subtitle 2   SRT
```

Thumbnail/storyboard timed-text resources should not clutter the normal subtitle list.

They may be placed under a collapsed diagnostic section such as:

```text
Other timed-text resources  (2)
  > thumbnail/storyboard VTT
```

This does not mean the extension forgets those resources. They remain available internally for diagnostics.

---

# Title presentation

The canonical playback title should appear near the top of the popup because it will later become shared playback metadata for both media and subtitle naming.

Example:

```text
The Odyssey
```

The UI should not normally expose all title evidence such as `og:title`, `document.title`, and `h1`.

A small advanced/details view may show provenance if needed:

```text
Title source: Open Graph
Confidence: High
```

The extension should preserve the human-readable canonical title. AiDM will later sanitize it into final filesystem-safe names.

---

# Session readiness

The UI should summarize browser/session context without dumping raw sensitive values.

For ordinary streaming, a compact summary may be:

```text
Session
  User-Agent   captured
  Referer      captured
  Origin       captured
  Cookies      observed / not observed
```

For most users, a higher-level status is even better:

```text
Session: Ready
```

with a details expander for advanced diagnostics.

Possible conceptual states:

```text
Ready
Partial
Limited
```

These states must be evidence-driven. The extension should not claim that a session is guaranteed to reproduce successfully merely because some headers were observed.

---

# YouTube view

YouTube should use the same overall popup instead of a completely separate extension interface.

The content changes because YouTube's main handoff is page/session context for yt-dlp rather than a direct HLS candidate list.

Conceptually:

```text
AIDM Stream Inspector

Example YouTube Video

Source
  YouTube

Session
  Browser       Firefox
  Cookies       available
  Visitor Data  available / not observed
  User-Agent    captured

Page
  https://www.youtube.com/watch?v=...

[ Send to AiDM ]
```

For playlists:

```text
AIDM Stream Inspector

Example Playlist

Source
  YouTube Playlist

Session
  Browser       Firefox
  Cookies       available

[ Send to AiDM ]
```

The extension should not try to duplicate yt-dlp's format table or YouTube extraction logic inside the popup.

AiDM/yt-dlp remains responsible for:

- quality discovery;
- video/audio format selection;
- playlist enumeration;
- downloading;
- merging.

The extension's job is to show whether useful browser/session context exists and hand that context to AiDM.

---

# One UI, multiple source types

The popup should be driven by a playback/source model rather than by site-specific screens.

Conceptually:

```text
Playback source type
├── HLS
├── DASH
├── Direct media
└── YouTube
```

Common fields:

```text
Title
Page URL
Source type
Session readiness
Send to AiDM
```

Streaming-specific fields:

```text
Best media candidate
Other candidates
Subtitles
Timed-text diagnostics
```

YouTube-specific fields:

```text
Browser identity
Cookie/session availability
Visitor Data availability where legitimately observable
YouTube page/playlist identity
```

This avoids building one UI now and bolting a second YouTube UI onto it later.

---

# Collapsed advanced details

The extension should preserve technical depth without forcing every user to read it.

A collapsed section such as:

```text
Advanced details  >
```

may eventually contain:

- exact media URL;
- request headers;
- response MIME/status;
- ranking score/evidence;
- request ID;
- frame ID;
- title-source evidence;
- repeated observation count;
- signed/expiry information;
- subtitle discovery provenance.

This is especially useful during development and troubleshooting.

The default popup should remain compact.

---

# Primary actions

The primary action should eventually be:

```text
[ Send to AiDM ]
```

This represents the preferred final workflow.

Secondary actions may later include:

```text
Copy handoff JSON
Copy media URL
Copy subtitle URL
Refresh current detection
```

But these should not compete visually with the main AiDM handoff action.

The extension should not primarily export shell commands. Structured handoff is the architectural target.

---

# Selection behavior

By default, the UI may preselect:

- the highest-ranked useful media candidate;
- likely subtitle candidates;
- the canonical playback title.

The user should be able to override media selection if needed.

For subtitles, future selection may use checkboxes:

```text
Subtitles
  [x] English
  [ ] Hindi
  [ ] Arabic
```

The exact interaction should be decided after real playback grouping and language metadata are available.

---

# No-results state

The popup should fail clearly and quietly.

Example:

```text
AIDM Stream Inspector

No playback detected on this tab yet.

Start the video, then reopen or refresh detection.
```

It should not show unrelated page titles as playback assets when no qualifying media/session evidence exists.

This follows the M8.1 playback-title gating principle.

---

# Partial-results state

Sometimes the extension may detect only part of the playback asset.

Example:

```text
The Odyssey

Media
  HLS detected

Subtitles
  none detected

Session
  Partial
```

The UI should distinguish:

- not observed;
- unavailable;
- not yet tested;
- known absent;

where the implementation can do so reliably.

Do not replace missing evidence with guessed values.

---

# Fresh/signed URL awareness

Streaming URLs may be short-lived.

If the extension can identify obvious expiry/signature evidence later, the UI may show a non-alarming warning such as:

```text
This stream URL may expire soon.
```

The exact URL must still be preserved unchanged.

Do not strip or normalize signed query parameters for presentation convenience.

---

# UI and developer diagnostics are separate layers

The developer console remains useful during development and failure analysis.

The popup should not attempt to replicate every console message.

Conceptually:

```text
internal evidence
      ↓
normalized playback state
      ↓
user-facing UI
```

This gives the project freedom to keep deep diagnostics while presenting a clean product experience.

---

# Suggested visual hierarchy

A compact first version could use this hierarchy:

```text
┌─────────────────────────────────┐
│ AIDM Stream Inspector           │
├─────────────────────────────────┤
│ The Odyssey                     │
│ HLS                             │
├─────────────────────────────────┤
│ Media                           │
│ HIGH  HLS Master               │
│ Other detected streams (3)  >  │
├─────────────────────────────────┤
│ Subtitles                       │
│ English  VTT                    │
│ Arabic   SRT                    │
│ Other timed text (1)         >  │
├─────────────────────────────────┤
│ Session: Ready                  │
│ Details                      >  │
├─────────────────────────────────┤
│       [ Send to AiDM ]          │
└─────────────────────────────────┘
```

For YouTube:

```text
┌─────────────────────────────────┐
│ AIDM Stream Inspector           │
├─────────────────────────────────┤
│ Example YouTube Video           │
│ YouTube                         │
├─────────────────────────────────┤
│ Session                         │
│ Browser       Firefox           │
│ Cookies       Available         │
│ Visitor Data  Available         │
│ Details                      >  │
├─────────────────────────────────┤
│       [ Send to AiDM ]          │
└─────────────────────────────────┘
```

These are conceptual wireframes, not locked pixel designs.

---

# First UI milestone philosophy

M9 should be functional before it becomes polished.

The first UI should prioritize:

1. correct current playback state;
2. best media candidate visibility;
3. useful subtitle visibility;
4. canonical title;
5. YouTube/session status;
6. clean selection;
7. a future-ready Send to AiDM action boundary.

Avoid spending early M9 effort on animations, elaborate theming, or decorative complexity.

The extension can become visually polished after the end-to-end handoff works.

---

# Relationship to future structured handoff

The popup should display the same normalized playback state that will later be exported to AiDM.

Conceptually:

```text
browser observations
      ↓
normalized playback object
      ├── title
      ├── source type
      ├── media candidate(s)
      ├── subtitle candidate(s)
      ├── session context
      └── source-specific metadata
             ↓
        popup presentation
             +
        structured AiDM handoff
```

The UI and export layer should therefore consume the same underlying state rather than rebuilding separate interpretations of browser traffic.

---

# Future development order

The intended wrap-up path is:

```text
M8.5
YouTube session intelligence foundation
        ↓
M9
Unified popup/UI
        ↓
M10
Structured export / AiDM handoff
        ↓
M11
Real-world integration testing and targeted fixes
```

Once this path works end-to-end, additional detection improvements should be driven by reproducible real-world failures rather than speculative expansion.

---

# Locked UI direction

The future AIDM Stream Inspector UI should be:

- unified across ordinary streaming and YouTube;
- playback-centered rather than raw-request-centered;
- compact by default;
- technically deep through optional advanced details;
- ranking-aware without hiding unique candidates;
- subtitle-aware without exposing thumbnail/storyboard clutter as normal subtitles;
- session-aware without dumping sensitive values unnecessarily;
- built around one canonical playback title;
- designed around structured handoff to AiDM;
- functional first, polished later.

The extension's intelligence layer may remain complex internally. The UI's job is to make the result feel simple.
