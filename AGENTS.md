# AIDM Stream Inspector — Codex Development Rules

## 1. Project Mission

AIDM Stream Inspector is a Firefox/Chromium WebExtension that observes browser activity and discovers useful media requests plus the browser/session context needed for the separate AiDM downloader to reproduce those requests where technically possible.

The extension is the browser intelligence and session-handoff layer.

The extension is NOT a downloader.

AiDM remains responsible for downloading, extraction, merging, post-processing, FFmpeg, aria2c, and yt-dlp operations.

---

## 2. Target Browsers

The extension must target both major browser-engine families:

- Firefox / Mozilla derivatives
- Chromium derivatives

Firefox is the primary development and testing browser during the current development phase.

Do not knowingly introduce Firefox-only or Chromium-only architecture unless the task explicitly requires it.

Prefer standard WebExtension APIs supported by both browser families.

When browser-specific behavior is unavoidable:

1. keep the shared implementation intact where possible;
2. isolate browser-specific behavior;
3. clearly report the incompatibility;
4. do not invent an unrequested compatibility layer.

---

## 3. Manifest and Background Architecture

The project uses Manifest V3.

Cross-browser background execution must be considered from the beginning.

Do not assume Chromium service-worker behavior and Firefox background-script behavior are identical.

Do not redesign the background architecture unless explicitly requested.

Do not change Manifest version.

Do not add permissions unless the current task explicitly requires them.

Every added permission must have a concrete reason related to the requested milestone.

Never add broad permissions "for future use."

---

## 4. Current Project Boundaries

Existing project areas have distinct responsibilities:

- `manifest.json`
  Extension declaration, permissions, background configuration, popup configuration, and browser metadata.

- `src/background/`
  Network observation, background lifecycle, candidate collection, and related coordination.

- `src/core/`
  Shared stream/media concepts and reusable logic that is independent of UI/export.

- `src/popup/`
  User-facing extension popup.

- `src/export/`
  Explicit export/handoff mechanisms.

- `docs/`
  Project documentation and detection/testing notes.

Do not move files between these areas unless explicitly instructed.

Do not create new directories merely for architectural neatness.

Create a new file or directory only when the requested task genuinely requires it.

---

## 5. Scope Discipline — CRITICAL

Implement ONLY the task described in the current prompt.

Do not:

- implement future milestones;
- anticipate future features with extra code;
- add "helpful" functionality that was not requested;
- redesign existing architecture;
- refactor unrelated code;
- rename unrelated files, functions, or variables;
- modify unrelated formatting;
- add abstractions solely for hypothetical future needs;
- add compatibility code unless currently required;
- add error handling for unrelated hypothetical scenarios;
- modify AiDM;
- implement downloading;
- implement yt-dlp, aria2c, or FFmpeg execution;
- implement direct AiDM communication unless explicitly requested.

If the requested change can be completed by modifying one file, do not modify five files.

Prefer the smallest correct implementation that satisfies the current milestone.

---

## 6. No Unsolicited Dependencies

Do not add:

- npm packages;
- JavaScript frameworks;
- UI frameworks;
- bundlers;
- transpilers;
- TypeScript;
- build systems;
- testing frameworks;
- polyfill libraries;
- external runtime libraries;

unless explicitly requested.

The initial project should use plain JavaScript, HTML, CSS, JSON, and standard WebExtension APIs.

Do not create `package.json` unless explicitly requested.

Do not run `npm init`.

Do not introduce Node.js as a runtime requirement for the browser extension.

---

## 7. Media Detection Mission

The long-term detection pipeline is conceptually:

Browser network activity
→ observe requests
→ collect candidates
→ classify candidates
→ rank candidates
→ display useful media candidates
→ export selected information

Potential media eventually includes:

- HLS manifests;
- DASH manifests;
- direct video/audio;
- segmented media where identifiable;
- subtitles.

Detection must eventually be capable of using more than filename extensions because useful media requests may not contain obvious `.m3u8`, `.mpd`, or media extensions.

However:

DO NOT implement any of these capabilities until the current task specifically requests them.

---

## 8. Network Observation Rules

The extension is primarily an observer.

Do not block, redirect, rewrite, cancel, or otherwise alter browser network traffic unless explicitly requested in a future task.

Observation must not intentionally interfere with normal page playback.

When network observation is implemented, preserve captured URLs exactly.

Never:

- remove query parameters;
- normalize signed URLs;
- decode and reconstruct URLs unnecessarily;
- strip tokens;
- modify signatures;
- replace hostnames;
- manufacture IP information.

Short-lived or signed media URLs must remain exactly as observed.

---

## 9. Request and Session Context

Long-term useful context may include:

- media URL;
- User-Agent;
- Referer;
- Origin;
- relevant request headers;
- cookie/session context;
- page URL;
- top-level page URL;
- iframe/frame context;
- page title;
- subtitles;
- response metadata.

Browser APIs may not expose every header, cookie, credential, or internal browser value.

Never assume unavailable browser secrets can be obtained.

Never attempt to bypass browser security restrictions.

If a requested value is unavailable through the permitted WebExtension API, report the limitation instead of inventing data or using an unsafe workaround.

Captured request context and direct browser-cookie-database access are NOT the same thing.

---

## 10. Sensitive Data Rules

Treat the following as potentially sensitive:

- cookies;
- authorization headers;
- signed media URLs;
- session tokens;
- authentication parameters;
- visitor/session identifiers.

Do not automatically print sensitive values to console logs.

Do not write captured sensitive values into source files.

Do not commit captured session information.

Do not create persistent diagnostic files containing real captured credentials.

Do not persist sensitive runtime state to `storage.local` merely for convenience.

When runtime candidate/session storage is required, prefer session-lifetime storage such as `storage.session` where browser support and the task permit it.

Clipboard/export actions containing sensitive session context must eventually require explicit user action.

---

## 11. Runtime State

Do not assume background global JavaScript variables are permanent.

Chromium Manifest V3 background service workers may be suspended and restarted.

Important runtime state that must survive background suspension should eventually use an appropriate browser storage mechanism.

Do not implement persistence until requested by the current milestone.

Do not introduce persistent storage simply to prepare for future milestones.

---

## 12. Candidate Quality

The project exists partly because existing stream-detection extensions can:

- miss playing media entirely;
- expose irrelevant resources;
- return PNG/TXT or other junk instead of useful streams.

Therefore future candidate detection must not simply display every network request.

However, candidate filtering/ranking must be implemented only when explicitly requested.

Do not prematurely build scoring systems or heuristic engines.

---

## 13. Page and Frame Context

Streaming pages may involve:

top-level page
→ embedded player iframe
→ CDN/media request

Future architecture must preserve the distinction between:

- top-level page URL;
- frame/embedded-player context;
- actual media URL.

Do not assume the media request originates directly from the top-level page.

Do not implement frame tracking until explicitly requested.

---

## 14. Subtitle Scope

Subtitle discovery is part of the long-term extension mission.

Potential future data includes:

- WebVTT;
- subtitle URLs/manifests;
- language;
- label;
- default/forced state;
- association with the relevant media/page.

Do not implement subtitle detection until explicitly requested.

---

## 15. YouTube Scope

YouTube browser-session handoff is a future first-class goal.

The eventual purpose is to provide AiDM/yt-dlp with browser context that is legitimately available to the extension.

The extension must never claim that browser context guarantees bypassing:

- anti-bot systems;
- rate limits;
- account restrictions;
- IP restrictions;
- server-side restrictions.

Do not implement YouTube-specific behavior until explicitly requested.

---

## 16. AiDM Integration Boundary

AIDM Stream Inspector and AiDM are separate projects.

Do not modify the AiDM repository.

Do not copy AiDM Python code into this extension.

Do not make this extension depend directly on AiDM during early development.

The initial handoff mechanism will eventually be explicit structured export.

The long-term structured payload may contain information such as:

- type;
- URL;
- page URL;
- frame URL;
- title;
- User-Agent;
- Referer;
- Origin;
- headers;
- cookie/session information;
- subtitles.

The exact schema is NOT yet finalized.

Do not invent or freeze a final handshake schema unless explicitly requested.

Do not output shell commands as the internal data model.

Structured machine-readable data is preferred for eventual AiDM integration.

---

## 17. Coding Style

Use plain, readable JavaScript.

Favor clarity over cleverness.

The project owner is new to JavaScript/WebExtension development, so code should be understandable when reviewed with guidance.

Prefer:

- descriptive names;
- short focused functions;
- straightforward control flow;
- minimal nesting;
- comments explaining browser-specific or non-obvious behavior.

Avoid:

- clever one-liners;
- unnecessary metaprogramming;
- excessive abstraction;
- premature optimization;
- unnecessary design patterns;
- compressed/minified code;
- unexplained browser tricks.

Comments should explain WHY when behavior is non-obvious.

Do not add comments that merely repeat obvious code.

---

## 18. Error Handling

Handle errors that are directly relevant to the current milestone.

Do not build large defensive systems for hypothetical future failures.

Do not silently swallow important errors.

During development, errors should remain diagnosable.

Diagnostic messages must not expose sensitive session values.

If an API operation can legitimately fail because of browser differences, permissions, or unsupported behavior, make that failure understandable.

---

## 19. Testing Philosophy

Development follows tiny, independently testable milestones.

Each task should produce one clearly testable behavior.

Do not combine multiple milestones into one implementation unless explicitly instructed.

A milestone is not successful merely because the code looks correct.

It must be testable in the target browser.

Firefox is currently the primary manual testing browser.

Do not introduce automated testing infrastructure unless explicitly requested.

---

## 20. Git Rules — CRITICAL

Do NOT perform Git operations unless the current prompt explicitly requests them.

This includes:

- `git add`;
- `git commit`;
- `git push`;
- `git pull`;
- `git merge`;
- `git rebase`;
- branch creation;
- branch deletion;
- tags;
- resets;
- force operations.

Never commit automatically after completing code.

The project owner controls Git checkpoints.

Do not change branches.

Do not modify `.git` internals.

---

## 21. File Modification Rules

Before modifying files:

1. inspect the relevant existing files;
2. understand the smallest required change;
3. modify only files necessary for the requested task.

Do not rewrite an entire file unnecessarily when a small targeted change is sufficient.

Do not modify unrelated whitespace across a file.

Do not format unrelated files.

Do not delete existing code unless required by the task.

If existing code conflicts with the requested task, explain the conflict rather than silently redesigning the project.

---

## 22. Repository Safety

Never delete project files unless explicitly instructed.

Never modify files outside this repository.

Never modify browser profiles or browser configuration.

Never access or modify AiDM's repository as part of an extension task unless explicitly instructed.

Never add generated artifacts, caches, build outputs, or captured browsing/session data to the repository.

---

## 23. When Requirements Are Ambiguous

Do NOT guess substantial architectural decisions.

If implementation requires choosing between materially different architectures that the prompt does not resolve:

STOP and report the ambiguity.

Do not make the decision silently.

Small implementation details that do not alter architecture may be chosen conservatively.

When uncertain, prefer less code and less scope.

---

## 24. When Something Is Technically Impossible

If the requested behavior cannot be implemented using the allowed browser APIs or current architecture:

Do not fake success.

Do not invent browser capabilities.

Do not silently substitute a different feature.

Explain:

1. what cannot be done;
2. why;
3. what browser/API limitation causes it;
4. the smallest viable alternative, if one exists.

Then stop and wait for direction.

---

## 25. Completion Report

After every coding task, provide a concise completion report containing:

1. Files changed
2. What changed
3. Why each change was necessary
4. How the project owner can manually test the exact milestone
5. Expected successful result
6. Any errors/warnings/limitations discovered

Do not claim a browser test was performed unless it was actually performed.

Distinguish clearly between:

- code inspection;
- automated/tool validation;
- actual Firefox testing;
- actual Chromium testing.

Do not claim "works in Firefox" merely because the code appears compatible.

---

## 26. Definition of Done

A Codex task is complete when:

- the exact requested scope is implemented;
- unrelated functionality was not added;
- relevant files remain understandable;
- no unnecessary dependency was introduced;
- no unrelated files were changed;
- the requested behavior has a clear manual test procedure;
- known limitations are reported honestly.

Stop after satisfying the requested milestone.

Do not continue into the next milestone.