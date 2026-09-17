# AIDM Stream Inspector — Beta Manual Clipboard Handoff

This document records the architectural decision to postpone automatic AiDM handoff/export and use a simple manual clipboard bridge for the beta phase.

The extension and AiDM remain separate projects.

The extension remains responsible for browser-side discovery, ranking, playback context, subtitle discovery, title discovery, and user-facing selection.

AiDM remains responsible for downloading, subtitle retrieval, naming, post-processing, FFmpeg, aria2c, yt-dlp, and all downloader-side behavior.

---

# Decision summary

After the M9 popup work is complete, the beta extension will provide one primary manual handoff action:

```text
[ Copy ]
```

The extension will **not** automatically send data to AiDM during the beta phase.

The extension will **not** require direct communication with AiDM.

The extension will **not** expose a JSON export workflow as the primary user path during this phase.

Instead, explicit user action on the Copy button will generate a shell-ready AiDM argument fragment containing the currently selected playback information.

The user can then open a terminal and paste that fragment after:

```bash
python aidm.py
```

This creates a simple, inspectable manual bridge between the two projects while both sides continue to evolve independently.

---

# Why automatic handoff is postponed

The beta goal is to keep the architecture easy to inspect and easy to debug.

An automatic handoff would introduce additional concerns before the extension and AiDM input contract have been proven in real-world use, including:

- transport between extension and native application;
- native messaging or another integration layer;
- installation and permission complexity;
- compatibility between browser and AiDM versions;
- error propagation across two projects;
- premature commitment to a final machine-to-machine schema.

The manual clipboard approach avoids those concerns while still creating a complete end-to-end workflow.

It also makes failures easier to diagnose because the user can inspect exactly what the extension captured before AiDM consumes it.

---

# Beta workflow

The intended beta workflow is:

```text
Browser playback
      ↓
AIDM Stream Inspector observes requests
      ↓
media candidates are detected and ranked
      ↓
real subtitles are discovered
      ↓
canonical playback title is discovered
      ↓
request/session context is retained
      ↓
user reviews popup
      ↓
user selects desired media candidate
      ↓
user selects desired subtitle candidate(s), when selection exists
      ↓
user presses Copy
      ↓
shell-ready AiDM argument fragment enters clipboard
      ↓
user opens terminal
      ↓
python aidm.py [PASTE]
      ↓
AiDM consumes the exact clipboard contract
```

No automatic browser-to-AiDM transport is required for the beta.

---

# Important boundary: internal state remains structured

The shell-ready clipboard text is a **presentation/handoff format**, not the extension's internal data model.

Internally, AIDM Stream Inspector should continue to keep normalized structured playback state containing separate fields such as:

- selected media candidate;
- exact media URL;
- media type;
- ranking/priority;
- User-Agent;
- Referer;
- Origin;
- cookie/session availability;
- subtitle candidates;
- canonical title;
- page/tab identity;
- capture timestamp.

The Copy action may serialize those structured fields into a shell-ready string.

Do not redesign the internal architecture around shell command text.

This preserves the ability to add a structured machine-readable handoff later without rewriting the detector/state architecture.

---

# Candidate selection rule

The Copy action must use the **currently selected media candidate**.

The default selected candidate should be the engine's current best/highest-ranked candidate.

Conceptually:

```text
engine ranking
      ↓
default selected candidate
      ↓
user may override selection
      ↓
Copy uses current selection
```

This is important because ranking is guidance, not absolute truth.

A HIGH-priority candidate may fail in a particular real-world case while a MEDIUM-priority candidate works.

Therefore the clipboard action must not always force the highest-ranked candidate after the user has explicitly selected another one.

The popup selection state remains authoritative for the Copy action.

---

# Subtitle rule

Only actual subtitle candidates belong in the manual handoff.

Thumbnail/storyboard/preview VTT resources must never be exported as subtitles.

If subtitle selection is available, Copy should include the subtitle candidate(s) currently selected by the user.

If the UI initially supports only one selected subtitle, the copied fragment should include that selected subtitle.

If no real subtitle is selected or available, omit the subtitle argument entirely.

Do not invent a subtitle URL.

---

# Session/context rule

The copied fragment should use request context belonging to the selected media candidate wherever possible.

Important values include:

- User-Agent;
- Referer;
- browser cookie strategy where legitimately available;
- selected media URL.

Origin may remain available internally and may be added to the clipboard contract later if AiDM requires it, but the beta contract should include only fields that AiDM is explicitly taught to consume.

Do not add arguments merely because the extension happens to know a value.

---

# Cookie strategy

The extension currently treats cookies/session context conservatively.

It does not need to place raw cookie contents on the clipboard.

Where the browser identity is reliably known and AiDM/yt-dlp can reuse that browser profile, the beta handoff may use a browser-cookie strategy such as:

```bash
--cookies-from-browser firefox
```

This is preferable to copying raw cookie values into clipboard text.

If cookie reuse is not available or not applicable, omit the argument rather than inventing one.

The exact browser-cookie behavior must be verified before this part of the clipboard contract is considered complete.

---

# Clipboard format

The Copy button should generate a shell-ready argument fragment rather than one giant quoted string.

Preferred conceptual order:

```text
1. --user-agent
2. --cookies-from-browser, when applicable
3. --referer
4. --subtitle, for selected real subtitle(s)
5. --title
6. selected media URL as the final positional argument
```

Example:

```bash
--user-agent 'Mozilla/5.0 (X11; Linux x86_64; rv:154.0) Gecko/20100101 Firefox/154.0' \
--cookies-from-browser firefox \
--referer 'https://cloudorchestranova.com/' \
--subtitle 'https://cloudorchestranova.com/embed/iframe_player/cache/subs/19/1962595252.vtt' \
--title 'Watch The Odyssey on Soap2dayHD' \
'https://example-cdn.invalid/path/master.m3u8?token=REDACTED'
```

The real extension must preserve the exact selected media URL internally and copy it unchanged, including signed query parameters.

The example above is intentionally redacted and must not be replaced in documentation with live session tokens.

---

# Why the media URL is last

The selected media URL should be the final positional argument.

This creates a natural future AiDM CLI shape:

```bash
python aidm.py \
  --user-agent '...' \
  --cookies-from-browser firefox \
  --referer '...' \
  --subtitle '...' \
  --title '...' \
  'MEDIA_URL'
```

The argument order should remain stable for human readability even if AiDM later uses a proper CLI parser that technically permits flags in different positions.

Predictable clipboard output is easier to inspect, debug, document, and test.

---

# Shell quoting requirement

The clipboard output must be safe to paste into the supported Linux shell workflow.

Do not wrap the complete argument fragment in one giant pair of quotes.

Incorrect conceptual shape:

```bash
python aidm.py "--user-agent "..." --referer "..." ..."
```

That creates nested quoting problems and makes argument parsing unreliable.

Instead, quote each value independently and leave the fragment as normal shell arguments.

Before implementation, shell escaping must be designed carefully for titles, URLs, and header values containing characters such as:

- single quotes;
- spaces;
- ampersands;
- dollar signs;
- backticks;
- parentheses;
- other shell-significant characters.

The Copy milestone must not simply interpolate unescaped captured strings into shell syntax.

---

# AiDM compatibility contract

AiDM does not currently accept this full argument set.

That work belongs to the AiDM repository and will be implemented separately after the extension clipboard format is proven.

The desired future property is:

> The exact text copied by AIDM Stream Inspector should be pasteable after `python aidm.py` without manual editing.

Conceptually:

```bash
python aidm.py [EXACT EXTENSION CLIPBOARD OUTPUT]
```

AiDM will later be taught to understand arguments such as:

```text
--user-agent
--cookies-from-browser
--referer
--subtitle
--title
MEDIA_URL
```

AiDM should then:

1. consume the selected media URL;
2. apply the supplied browser/request context;
3. download the media using the appropriate existing AiDM engine;
4. download the selected subtitle resource;
5. use the supplied canonical title as naming input;
6. produce media and subtitle files with consistent names;
7. preserve the existing AiDM responsibility for sanitizing filesystem-safe names.

The extension must not implement any of those downloader-side responsibilities.

---

# Title handling

The clipboard handoff should use the current canonical playback title from the extension's normalized playback state.

Example:

```bash
--title 'Watch The Odyssey on Soap2dayHD'
```

The extension should preserve the human-readable title.

AiDM remains responsible for converting that title into a safe final filename.

Do not move filesystem filename sanitization into the extension.

---

# Referer handling

Use the Referer belonging to the selected media candidate.

In many observed cases, the same player/embed Referer is also suitable for the subtitle resource, but the architecture must not assume this is universally true without evidence.

For the initial beta contract, one selected-media Referer may be passed to AiDM.

If future real-world testing proves subtitles need separate request context, the contract can be extended later.

Do not pre-build that complexity now.

---

# Freshness and capture age

The popup already treats captured playback state as temporary current-tab state.

The manual Copy action should operate on that retained current capture.

Capture age is a user-facing freshness hint, not a validity guarantee.

Examples:

```text
Captured just now
Captured 2 min ago
Captured 20 min ago
```

The extension must not claim that an old URL is expired merely because time has passed.

Likewise, it must not claim that a fresh-looking URL is guaranteed to work.

The user may choose to reload the playback page to obtain fresh browser observations before pressing Copy.

---

# State lifetime rule

The current beta state rule remains:

```text
same current tab
→ retain playback capture

leave current tab / target changes
→ flush playback capture

return to old tab later
→ do not resurrect the old capture
→ require fresh observations
```

The Copy button must only operate on the current retained playback state.

It must never pull an older capture from another tab or playback session.

---

# Security and privacy

Copy is an explicit user action.

This is important because the clipboard payload may contain sensitive or short-lived information such as:

- exact signed media URLs;
- User-Agent;
- Referer;
- subtitle URLs;
- browser/profile cookie strategy.

The extension must not automatically copy this information merely because playback is detected.

Do not write real clipboard payloads into project files or source code.

Do not log sensitive copied values to the developer console simply for debugging.

Do not include live signed URLs, tokens, cookies, or session identifiers in repository documentation.

---

# Updated milestone direction

The current UI roadmap becomes:

```text
M9.3 — Subtitle presentation
M9.4 — Canonical title presentation
M9.5 — Session/context summary
M9.6 — Candidate/subtitle selection state
M9.7 — Empty/loading/error states
M9.8 — Cross-browser popup sanity
M9.9 — Manual Clipboard Handoff
```

M9.9 will introduce the large explicit Copy action and the shell-ready beta clipboard contract.

The previously planned automatic structured export/direct AiDM handoff is postponed.

It is not deleted as a possible future direction.

A later milestone may revisit structured machine-readable export or direct integration after the manual beta contract has been validated in real-world use.

---

# M9.9 conceptual UI

After the rest of the popup architecture is stable, the main playback view may end with one clear primary action:

```text
┌─────────────────────────────────┐
│ AIDM Stream Inspector           │
│                                 │
│ Title                           │
│ Media / selection               │
│ Subtitles / selection           │
│ Session context                 │
│ Capture age                     │
│                                 │
│          [ Copy ]               │
└─────────────────────────────────┘
```

The button should remain simple.

The user should not need to choose between "Copy URL", "Copy JSON", "Export", and "Send to AiDM" during the beta workflow.

There is one primary manual handoff action:

```text
Copy
```

---

# Definition of success for the beta clipboard bridge

The manual clipboard architecture is successful when:

1. the extension presents the current playback cleanly;
2. the best media candidate is selected by default;
3. the user can override the media candidate;
4. real subtitle candidates can be selected without thumbnail/storyboard pollution;
5. current request/session context is represented honestly;
6. the user presses one Copy button;
7. clipboard content is shell-safe and predictable;
8. the selected media URL is preserved exactly;
9. only selected real subtitle URLs are included;
10. no raw cookies are unnecessarily exposed;
11. no automatic AiDM communication occurs;
12. later AiDM development can consume the exact clipboard text without requiring the extension to change its beta contract unnecessarily.

---

# Locked beta direction

For the beta phase:

- AIDM Stream Inspector remains a standalone browser inspection and capture tool;
- AiDM remains a separate downloader;
- no automatic handoff is required;
- no native messaging layer is required;
- no JSON-first user workflow is required;
- the extension keeps structured internal state;
- media ranking supplies the default selection;
- user selection overrides ranking for handoff;
- real subtitles only are eligible for subtitle handoff;
- one explicit Copy button creates a shell-ready AiDM argument fragment;
- the user manually pastes that fragment after `python aidm.py`;
- AiDM compatibility work happens later in the AiDM repository;
- direct/structured integration may be revisited after the manual beta workflow is proven.

This preserves a clean project boundary while giving the beta a practical end-to-end workflow.