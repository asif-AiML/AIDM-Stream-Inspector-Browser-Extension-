# AIDM Stream Inspector

AIDM Stream Inspector is a cross-browser WebExtension that observes browser playback traffic, identifies useful media candidates, preserves the browser request context associated with them, discovers subtitles and a canonical playback title, and prepares a manual handoff for the separate **AiDM** downloader.

The extension is the browser-intelligence layer.

It is **not** the downloader.

AiDM remains responsible for yt-dlp, aria2c, FFmpeg, download routing, output naming, merging, and post-processing.

---

## Project status

The current beta architecture is feature-complete for its planned browser-side workflow.

Validated core behavior includes:

- Firefox and Chromium/Brave support from one codebase;
- passive network observation;
- active-tab targeting;
- HLS, DASH, direct video/audio candidate detection;
- embedded media URL evidence inside query parameters;
- candidate ranking;
- subtitle discovery and subtitle-role filtering;
- canonical playback title discovery;
- session/request-context summary;
- retained playback state across popup close/reopen and MV3 background suspension;
- user selection of media candidates and subtitles;
- manual clipboard handoff to AiDM;
- POSIX-shell-safe exported arguments;
- cross-browser target-tab lifecycle behavior.

The normal maintenance model from this point is:

```text
main
  ↓
small fix branch
  ↓
test in Firefox + Brave/Chromium
  ↓
merge back to main
```

A separate `raw-engine` branch is intentionally kept as a UI-less/reference version of the detection engine.

---

## Why this project exists

Streaming sites often do not expose one obvious downloadable file.

A browser may instead encounter:

- HLS master playlists;
- child HLS renditions;
- DASH manifests;
- separate video and audio tracks;
- signed or short-lived URLs;
- subtitle resources;
- embedded player/CDN URLs;
- requests that only work with browser-derived context such as Referer;
- multiple technically valid media candidates of very different usefulness.

A simple "find every .m3u8" extension is therefore not enough.

AIDM Stream Inspector is designed to answer a more useful question:

> Which observed playback asset is most useful, what browser context belongs to it, which subtitles belong to the playback, and how can that information be handed cleanly to AiDM?

---

## Core philosophy

The extension follows several rules throughout the project:

- observe rather than interfere with browser traffic;
- preserve signed/tokenized URLs exactly as observed;
- keep detection separate from ranking;
- avoid site-specific hardcoding unless reproducible evidence ever proves it necessary;
- treat browser APIs honestly rather than pretending unavailable secrets can be captured;
- keep Firefox and Chromium behavior aligned where practical;
- treat the currently selected browser tab as the playback target;
- avoid flushing useful state merely because the browser temporarily loses OS focus;
- keep the downloader outside the extension;
- export only through an explicit user action.

---

## Supported browsers

The project targets both major WebExtension families:

- Firefox / Mozilla-based browsers;
- Chromium-based browsers, including Brave.

Firefox was the primary development browser, while Brave was used for Chromium/MV3 compatibility testing.

The extension uses Manifest V3.

The background architecture intentionally supports the different runtime models:

```text
Firefox
→ background-script / event-page style behavior

Chromium / Brave
→ service-worker behavior
```

The code does not assume that a Chromium service worker stays alive permanently.

---

## What the extension detects

### HLS

The detector can identify HLS candidates from browser-observed requests, including common playlist forms such as master and child/rendition playlists.

The system does not assume that every HLS URL is equally useful.

A parent/master-style playlist is often a better handoff candidate because it may expose:

- multiple qualities;
- separate audio tracks;
- subtitle renditions;
- the adaptive structure needed by yt-dlp.

### DASH

DASH manifest candidates are also recognized and represented as playback media.

### Direct video/audio

Direct browser-observed media resources can be classified as video or audio candidates where the request evidence is strong enough.

### Embedded media evidence

A useful media URL may be hidden inside a query parameter while the outer request path itself looks generic.

For example, a request may structurally resemble:

```text
/hls?url=<encoded media URL>
```

The detector can use embedded path evidence for classification while preserving the **exact original outer request URL** for later reproduction.

---

## Exact URL preservation

Signed media URLs are never "cleaned" for convenience.

The extension does not intentionally:

- remove query parameters;
- strip tokens;
- rewrite hostnames;
- normalize signatures;
- reconstruct URLs from partial data.

The exact observed URL is retained.

This matters because media URLs frequently include:

- authentication tokens;
- expiry timestamps;
- signatures;
- CDN routing parameters;
- IP/network restrictions.

---

## Candidate ranking

Detection answers:

> Is this request media?

Ranking answers:

> How useful is this media candidate likely to be?

Those are deliberately separate layers.

The ranking engine uses conservative structural evidence rather than provider-specific hostname rules.

Examples of evidence include:

- HLS/DASH candidate type;
- master-like naming;
- playlist-like paths;
- video-rendition-like naming;
- audio-rendition-like naming.

The popup exposes readable priorities such as:

- HIGH
- MEDIUM
- LOW

while retaining the underlying numeric score.

The highest-ranked candidate becomes the default media selection, but lower-ranked alternatives remain available.

Most importantly:

> the user can override the recommended candidate.

The final clipboard handoff uses the **user-selected** media candidate, not blindly the highest-ranked one.

---

## Subtitle intelligence

Subtitle discovery is a first-class part of the extension.

Recognized subtitle formats include the formats supported by the current engine, such as:

- WebVTT;
- SRT;
- ASS;
- SSA;
- TTML where identified by the engine.

The project also learned an important distinction:

> Not every VTT file is a subtitle.

Some sites use VTT-like resources for:

- thumbnail timelines;
- storyboards;
- preview sprites.

The subtitle pipeline therefore assigns a role to timed-text candidates.

Only candidates classified by the engine as real subtitles are presented in the normal popup and made eligible for handoff.

Thumbnail/storyboard VTT remains an internal/diagnostic concern and is not exposed as a selectable subtitle.

---

## Subtitle selection

Real subtitles appear as selectable checkboxes.

Behavior:

- detected real subtitles are selected by default;
- the user can deselect any subtitle;
- the user can deselect all subtitles;
- no subtitle is a completely valid playback state;
- only selected real subtitle candidates enter the clipboard handoff.

Multiple selected subtitles are represented as repeated `--subtitle` arguments.

Conceptually:

```text
--subtitle 'https://.../en.vtt' --subtitle 'https://.../ur.vtt'
```

---

## Canonical playback title

The extension collects title evidence from the playback page.

The title system prefers stronger page metadata over weak fallbacks.

The established priority is:

```text
og:title
  ↓
twitter:title
  ↓
h1
  ↓
document.title
```

Iframe title information may support the result but is not treated as the primary canonical title by itself.

Title evidence is collected independently, but the title is only promoted into playback state when meaningful main media has been detected.

This avoids treating arbitrary page titles as playback titles before actual media exists.

AiDM, not the extension, is responsible for converting the human-readable title into a filesystem-safe output name.

---

## Browser request context

For each useful media candidate, the extension can preserve relevant browser-observed request context.

The popup currently summarizes:

- User-Agent;
- Referer;
- Origin for diagnostics;
- whether cookies were observed.

The beta clipboard contract intentionally exports only the useful fields currently justified by evidence:

- User-Agent, when captured;
- Referer, when captured.

### Why Referer matters

Controlled testing showed a real case where a captured media URL failed when reproduced alone but succeeded when the browser-observed Referer was supplied.

That result established that:

> detecting the correct URL and reproducing the browser request are separate problems.

### Why extra observed headers are not filtered per site

Some sites work with only the media URL.

Others may require Referer or User-Agent.

The extension does not attempt to build provider-specific rules such as:

```text
site A needs Referer
site B does not
site C needs User-Agent
```

Instead:

> if a useful supported context value was captured, the extension includes it.

If real-world evidence later proves that a specific field causes a reproducible problem, the architecture can be revisited based on that evidence.

---

## Cookies and browser identity

Cookies are deliberately **not part of the beta handoff contract**.

The extension does not currently export:

- raw Cookie header values;
- `--cookies-from-browser`;
- browser-profile information;
- browser identity inferred from User-Agent.

Cookie presence shown in the popup is diagnostic only.

This is intentional.

During extensive streaming-platform testing, ordinary HLS/DASH reproduction did not establish a general need for cookie handoff.

A future use case such as YouTube may justify a separate browser-session design if a reproducible requirement is proven.

Until then, the project avoids adding a browser/profile/cookie mechanism speculatively.

---

## Origin

Origin may be displayed in the popup as diagnostic request context.

It is intentionally excluded from the current clipboard handoff.

If future provider testing proves a real reproducible Origin requirement, it can be added deliberately.

---

## Popup behavior

The popup is intentionally task-oriented rather than packet-inspector-oriented.

The normal flow is:

```text
detect playback
    ↓
review recommended media
    ↓
optionally select another media candidate
    ↓
optionally select/deselect subtitles
    ↓
Copy for AiDM
```

The popup does not expose separate buttons such as:

- Copy User-Agent
- Copy Referer
- Copy subtitle
- Copy media URL

Those values remain implementation/diagnostic details.

The main UI has one primary handoff action.

---

## Playback state retention

Opening and closing a popup must not force the user to replay the media just to rebuild the UI.

Current playback state is retained using session-scoped browser storage where supported by the current architecture.

The retained state includes the current playback identity and relevant candidate/selection information.

### Retention rules

If the same target tab remains current:

- closing the popup does not clear capture;
- reopening the popup restores the capture;
- Chromium service-worker suspension/restart can restore the current validated playback state;
- selection state is preserved;
- capture age remains available.

### State reset rules

Playback state is reset when the actual target changes, including:

- switching to another browser tab;
- navigating the current target tab to another page/playback identity;
- switching to another normal browser window whose active tab becomes the new target;
- losing/closing the target tab.

Returning later to an old tab must not resurrect an old capture automatically.

Fresh observations are required.

---

## Browser focus is not target identity

A major cross-browser lifecycle fix established this rule:

> Temporary browser/OS focus loss is not the same thing as changing playback target.

The extension therefore does **not** flush playback merely because:

- the browser loses OS focus;
- the user presses a volume/media key;
- the user clicks the desktop;
- the user Alt-Tabs to another application;
- the extension popup itself affects focus;
- Chromium emits a transient no-focused-window state.

The current active browser tab remains the target until a genuine target change occurs.

This behavior is important for both Firefox and Chromium/Brave consistency.

---

## Capture age

The popup displays how old the retained playback capture is, for example:

```text
Captured just now
Captured 2 min ago
Captured 1 hr ago
```

Capture age is informational.

It does not claim that a signed media URL is still valid.

The extension does not automatically expire a capture merely because it becomes old.

---

## Manual AiDM clipboard handoff

The beta handoff is intentionally simple.

The popup contains one primary button:

```text
Copy for AiDM
```

When clicked, it builds a **single-line POSIX-shell-safe argument fragment**.

Example:

```text
--user-agent 'Mozilla/5.0 ...' --referer 'https://player.example/' --subtitle 'https://cdn.example/sub.vtt' --title 'Example Movie' 'https://cdn.example/master.m3u8?token=...'
```

The copied text contains arguments only.

It does **not** include:

```text
python aidm.py
```

The intended terminal workflow is:

```bash
python aidm.py [PASTE]
```

---

## Clipboard argument order

The current beta handoff uses this logical order:

```text
--user-agent
--referer
--subtitle    # zero or more
--title
MEDIA_URL     # final positional argument
```

Optional values are omitted when unavailable.

Examples:

### Media + subtitle

```text
--user-agent '...' --referer '...' --subtitle 'https://.../sub.vtt' --title 'Movie' 'https://.../master.m3u8'
```

### Media with subtitle intentionally deselected

```text
--user-agent '...' --referer '...' --title 'Movie' 'https://.../master.m3u8'
```

### Minimal observed context

```text
--title 'Movie' 'https://.../master.m3u8'
```

or, if no title/context is available:

```text
'https://.../master.m3u8'
```

---

## Shell-safe quoting

Browser-derived values can contain shell-significant characters.

Examples include:

- spaces;
- `&`;
- `?`;
- `=`;
- `$`;
- quotes;
- apostrophes;
- signed-token punctuation.

Every dynamic value in the copied fragment is passed through one shell-quoting implementation.

A title such as:

```text
John's Movie
```

cannot safely be represented as:

```text
'John's Movie'
```

The extension instead emits a valid POSIX-safe representation equivalent to:

```text
'John'"'"'s Movie'
```

The resulting payload is designed to work both in a shell and in a future AiDM GUI parser.

---

## Future AiDM GUI compatibility

The clipboard handoff is not intended to lock AiDM into a terminal forever.

A future AiDM GUI can expose a simple input box:

```text
Paste Stream Inspector data here...
```

The GUI should parse the exact same extension output with Python semantics equivalent to:

```python
import shlex

argv = shlex.split(pasted_text)
```

That argv-style list should then be passed to the same AiDM argument parser used by the command-line interface.

Conceptually:

```text
Extension
    ↓
shell-safe one-line argument fragment
    ↓
┌─────────────────────────────┐
│ Terminal                    │
│ OS shell → argv             │
├─────────────────────────────┤
│ Future AiDM GUI             │
│ shlex.split(text) → argv    │
└─────────────────────────────┘
    ↓
shared AiDM parser
    ↓
shared routing/downloader logic
```

The future GUI should **not** execute the pasted text with `shell=True`.

The clipboard fragment is an input format, not a shell script.

The AiDM repository contains a dedicated handoff-contract document for the downloader side.

---

## Explicit user action and sensitive data

Media URLs may contain:

- signed tokens;
- temporary authorization information;
- expiry values;
- session-related identifiers.

For that reason, clipboard output is produced only after the user explicitly clicks the Copy button.

The extension does not:

- auto-copy captured data;
- continuously write playback information to clipboard;
- log the full generated clipboard payload as a normal behavior;
- persist a separate exported command.

---

## Clipboard feedback

After a successful copy:

```text
Copy for AiDM
→
Copied
```

The button returns to its normal label shortly afterward.

Clipboard errors are shown inline rather than crashing the popup.

---

## Manual installation for development/testing

This repository currently represents the development/beta extension source.

### Firefox

For temporary development loading:

1. open `about:debugging`;
2. open the section for the current Firefox instance;
3. choose the option to load a temporary add-on;
4. select the repository's `manifest.json`.

Temporary add-ons are removed when the relevant Firefox session is reset/restarted according to Firefox's development behavior.

### Chromium / Brave

1. open the browser's extensions page;
2. enable Developer Mode;
3. choose **Load unpacked**;
4. select the repository root containing `manifest.json`.

The same source tree is used for Firefox and Chromium-family testing.

---

## Basic usage

1. Load the extension in the browser.
2. Open a supported media page.
3. Start playback so the browser actually requests the media resources.
4. Open AIDM Stream Inspector.
5. Review the canonical title and source type.
6. Keep the recommended media candidate or select another detected candidate.
7. Select/deselect real subtitles as desired.
8. Review the request-context summary.
9. Click **Copy for AiDM**.
10. Paste the result into the AiDM workflow.

The extension only knows what the browser has actually observed.

If playback has not started, useful media requests may not exist yet.

---

## Empty and error states

The popup distinguishes normal absence of playback from actual failures.

Examples include:

```text
Checking this tab…
```

```text
No playback detected on this tab yet.
Start the video, then reopen the extension.
```

```text
No active browser tab available.
```

```text
Unable to read playback state.
Try reopening the extension.
```

These states are intentionally different so the user is not shown stale playback data under an unrelated tab or genuine error.

---

## Request/session data shown in the popup

The popup can display whether useful context was observed for the relevant media request.

Current presentation includes:

```text
User-Agent           Captured / Not observed
Referer              Captured / Not observed
Origin (diagnostic)  Captured / Not observed
Cookies              Observed / Not observed
```

Cookie status is presence-only.

The extension does not expose raw cookie values through the normal UI.

---

## Architecture overview

A simplified flow:

```text
Browser network activity
        ↓
network observer
        ↓
candidate detector
        ↓
media / subtitle classification
        ↓
candidate ranking
        ↓
playback state
        ↓
title + request context + selection
        ↓
popup
        ↓
explicit Copy for AiDM
```

### Responsibility boundary

```text
AIDM Stream Inspector
→ observe
→ classify
→ rank
→ present
→ select
→ hand off

AiDM
→ parse
→ route
→ download
→ merge/post-process
→ name files
```

That separation is intentional.

---

## Repository structure

```text
.
├── manifest.json
├── AGENTS.md
├── README.md
├── src/
│   ├── background/
│   │   ├── background.js
│   │   ├── network-observer.js
│   │   ├── candidate-detector.js
│   │   ├── playback-state.js
│   │   ├── playback-title.js
│   │   └── subtitle-evidence-observer.js
│   ├── content/
│   │   └── playback-title.js
│   ├── core/
│   │   ├── stream-types.js
│   │   ├── candidate-ranker.js
│   │   └── subtitle-role-classifier.js
│   ├── export/
│   │   └── clipboard-exporter.js
│   └── popup/
│       ├── popup.html
│       ├── popup.js
│       └── popup.css
├── icons/
├── tests/
└── docs/
```

The exact repository may evolve, but responsibilities should remain separated.

---

## Important project files

### `src/background/background.js`

Coordinates:

- current target tab;
- browser/window lifecycle;
- cross-browser background startup;
- popup message handling;
- playback-state initialization.

### `src/background/network-observer.js`

Observes browser requests and feeds the detection/intelligence pipeline.

### `src/background/candidate-detector.js`

Determines whether observed requests provide useful media evidence.

### `src/core/candidate-ranker.js`

Scores detected media candidates by likely usefulness.

### `src/background/subtitle-evidence-observer.js`

Collects subtitle-related network evidence and contributes to subtitle candidates.

### `src/core/subtitle-role-classifier.js`

Separates likely real subtitles from thumbnail/storyboard-style timed text.

### `src/background/playback-title.js`

Maintains canonical playback-title state.

### `src/background/playback-state.js`

Provides the authoritative playback read model used by the popup and retains current same-tab playback state.

### `src/popup/`

Presents the user-facing playback summary, candidate selection, subtitle selection, request-context status, capture age, and Copy for AiDM action.

---

## Permissions

The current manifest uses:

```text
webRequest
storage
```

with HTTP/HTTPS host access required for passive request observation across playback sites.

The project intentionally avoids adding permissions merely for future possibilities.

New permissions should only be added when a real implemented feature requires them.

---

## What the extension does not do

AIDM Stream Inspector does not:

- download media itself;
- run yt-dlp;
- run aria2c;
- run FFmpeg;
- mux subtitles into video;
- bypass DRM;
- defeat browser security controls;
- guarantee that every signed URL remains valid indefinitely;
- guarantee access to server-side or account-restricted content;
- automatically export raw cookies;
- infer a browser profile for yt-dlp;
- automatically send commands to AiDM;
- rank providers by hostname-specific rules;
- modify normal browser playback traffic.

---

## DRM and access-control boundary

This project observes ordinary browser-visible network activity.

It is not designed to defeat DRM or other access-control systems.

A media request being visible to the browser does not guarantee that an external downloader can reproduce it.

Server-side restrictions may still depend on:

- expiring signatures;
- IP/network state;
- account state;
- anti-bot systems;
- DRM/license exchange;
- server-side policy.

Failures should be investigated with evidence rather than automatically interpreted as a missing extension feature.

---

## Testing philosophy

Real streaming providers are volatile.

Hosts, CDNs, player implementations, tokens, and anti-bot policies can change.

The project therefore follows this rule:

> One failed provider attempt is evidence for investigation, not proof that the architecture is wrong.

Before changing architecture, prefer:

- fresh captures;
- repeated tests;
- controlled one-variable-at-a-time reproduction;
- comparison of browser success versus external reproduction;
- evidence from more than one provider when possible.

This approach has already prevented temporary provider behavior from turning into permanent site-specific complexity.

---

## Real-world lessons that shaped the architecture

### Correct media is not always the first media

Some players expose:

- parent/master playlist;
- video rendition;
- audio rendition;
- many fragments.

Ranking exists because quantity is not usefulness.

### Parent manifests can be strategically valuable

Testing showed that a higher-level HLS playlist can allow yt-dlp to understand separate adaptive video/audio tracks and produce a complete playback result.

### Referer can matter

At least one controlled test showed URL-only reproduction failing while the same captured URL with Referer succeeded.

### Signed URLs can expire

A candidate that worked during capture may later fail because the server token expired.

Capture age therefore does not equal validity.

### Browser focus is noisy

OS focus events and extension popups are not reliable evidence that the selected playback tab changed.

Target identity must be based on actual browser-tab lifecycle.

### VTT is not automatically a subtitle

Thumbnail/storyboard VTT resources are common enough that timed-text role classification is necessary.

---

## Development milestones

The extension evolved through small manually testable milestones.

Major completed areas include:

```text
M0      Cross-browser extension foundation
M1      Raw passive network observation
M2      Request-to-tab association
M3      Target-tab filtering
M3.1    Chromium MV3 lifecycle reconstruction
M4      Obvious media detection
M4.1    Embedded media URL evidence
M5      Request-context observation
M6      Candidate ranking
M6.1    Ranking presentation cleanup
M7      Subtitle intelligence
M8      Canonical playback title
M9.0    UI architecture bridge
M9.1    Popup shell
M9.1.1  Retained playback state + capture age
M9.2    Media candidate presentation
M9.3    Subtitle presentation
M9.4    Canonical title presentation
M9.5    Session/context summary
M9.6    Candidate + subtitle selection
M9.7    Empty/loading/error states
M9.8    Cross-browser popup/lifecycle validation
M9.9    Manual clipboard handoff
```

The result is the current beta workflow.

---

## YouTube status

YouTube session-handshake work was explored separately.

Historically, yt-dlp can encounter anti-bot/session-related failures for some YouTube situations, and browser cookies may sometimes affect those cases.

However, the project does not currently have a sufficiently stable, reproducible requirement to justify baking YouTube cookie/profile behavior into the general streaming handoff.

For that reason:

- YouTube-specific browser-session logic is not part of the current beta contract;
- normal HLS/DASH handoff remains cookie-free;
- future YouTube work should resume only when a reproducible case provides clear evidence for what is actually required.

---

## Relationship with AiDM

AIDM Stream Inspector and [AiDM](https://github.com/asif-AiML/AiDM) are separate repositories with separate responsibilities.

The extension produces browser-derived playback information.

AiDM consumes that information and performs the actual download.

The intended current bridge is manual:

```text
Browser playback
    ↓
AIDM Stream Inspector
    ↓
Copy for AiDM
    ↓
clipboard argument fragment
    ↓
AiDM CLI
```

The AiDM-side architecture is designed so that the same text can later be accepted by a GUI without changing the extension contract.

---

## Beta scope

The current beta intentionally favors a small, inspectable handoff over automatic integration.

Not part of the current beta:

- native messaging;
- direct extension-to-AiDM communication;
- background automatic downloads;
- cookie/profile export;
- provider-specific automation;
- JSON-first user workflow.

Those can be reconsidered later only if real use demonstrates a clear benefit.

---

## Security and privacy notes

This extension necessarily observes browser request metadata on allowed HTTP/HTTPS pages in order to identify playback traffic.

Some captured URLs may contain sensitive temporary tokens.

Project rules therefore require:

- no committing real captured signed URLs/tokens;
- no source files containing live credentials;
- no unnecessary persistent storage of sensitive playback state;
- no automatic clipboard export;
- no raw cookie exposure in the beta workflow;
- explicit user action before copying handoff data.

Users should treat copied media URLs as potentially sensitive while they remain valid.

---

## Contributing / development discipline

The project was built through narrow evidence-driven changes.

When extending it:

1. read `AGENTS.md`;
2. preserve the separation between detection, ranking, state, UI, and downloader responsibilities;
3. avoid broad refactors unless genuinely required;
4. do not add permissions speculatively;
5. do not add site-specific fixes based on one failure;
6. manually validate Firefox and Chromium-family behavior when changing lifecycle/UI code;
7. keep sensitive real-world captures out of Git history.

---

## Documentation

The `docs/` directory contains deeper design history and technical notes, including material on:

- architecture decisions;
- detection experiments;
- request/session reproduction;
- subtitles;
- YouTube;
- UI design;
- manual clipboard handoff;
- development roadmap.

The README describes the current product and architecture.

The detailed documents preserve the evidence and reasoning that produced it.

---

## Version

Current manifest version:

```text
0.1.0
```

The project is currently at the beta stage of its planned manual browser-to-AiDM handoff architecture.

---

## Summary

AIDM Stream Inspector turns noisy browser playback traffic into a compact, user-controlled playback handoff.

It:

```text
observes
→ detects
→ ranks
→ discovers subtitles
→ discovers title
→ preserves request context
→ retains current playback state
→ lets the user choose
→ copies a safe AiDM argument fragment
```

AiDM then takes over the actual download.

That division is the core of the project:

> **the browser understands the playback session; AiDM performs the download.**
