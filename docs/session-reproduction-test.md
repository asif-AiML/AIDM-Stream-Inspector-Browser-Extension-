# AIDM Stream Inspector — Session-Reproduction Test Bed

This document records a real-world test case where media discovery succeeds but replaying the captured media URL outside the browser does not until browser cookies are supplied. It exists as a development checkpoint for the browser/session-handoff work.

Sensitive signed URLs, IP-bound values, tokens, hashes, cookie values, and local user paths must not be committed here. Examples are structural/redacted only.

## Test bed — movi.pk playback through an embedded/CDN host

During playback on `https://www.movi.pk/`, AIDM Stream Inspector detected multiple HLS candidates whose paths ended in `index.m3u8`.

One representative request had the structural form:

```text
https://<cdn-host>/stream2/<opaque-path>/<signed-or-session-bound-data>:<timestamp>:<ip-address>:<signature>/<quality>/index.m3u8
```

The exact captured request contained an IP address and other long opaque/signed values in the URL path. These values must always be preserved exactly by the extension; they must never be cleaned, normalized, reconstructed, or manufactured.

## Raw replay result

The exact candidate URL was handed directly to AiDM without additional browser context.

Result:

```text
HTTP Error 404: Not Found
```

The older Stream Detector extension captured the same underlying HLS candidate in its ordinary mode, and replaying that raw URL failed in the same way.

This establishes that, for this test case:

1. browser playback succeeds;
2. media discovery succeeds;
3. the discovered URL by itself is not sufficient for successful external reproduction.

This is materially different from earlier M4 tests where some captured URLs happened to be independently usable.

## Old Stream Detector `yt-dlp` mode — corrected reproduction result

The old detector also produced a `yt-dlp` command that added browser/session-oriented context, structurally including:

```text
--user-agent <browser UA>
--cookies-from-browser chrome
--referer https://<embedded-player-host>/
<exact HLS URL>
```

The first run failed before the media request because the test environment did not use Google Chrome and `yt-dlp` could not find a Chrome cookie database.

The command was then repeated with only the browser cookie source changed from:

```text
--cookies-from-browser chrome
```

to:

```text
--cookies-from-browser brave
```

The same style of command then succeeded. `yt-dlp` reported that it extracted cookies from Brave, successfully downloaded HLS manifest information, identified the fragments, and started downloading the media.

This corrects the earlier uncertainty.

### What is now proven

For this reproduced test:

> Browser cookies were a required missing ingredient in the successful external reproduction path.

The raw URL failed, while the otherwise equivalent `yt-dlp` flow succeeded after the browser cookie source was corrected to the browser actually in use.

### What is not yet isolated

The successful command also contained User-Agent and Referer values. Therefore this experiment proves that supplying the correct browser cookies changes the failed reproduction into a successful one, but it does **not** yet prove that cookies alone are always sufficient or that User-Agent/Referer are irrelevant.

The precise statement to preserve is:

> The test establishes cookie dependency for this reproduction path. It does not yet establish the globally minimal set of required request context.

This distinction matters for future implementation: the extension should capture the browser context actually associated with the successful request rather than assume every site requires the same fixed set of values.

## Weakness exposed in the old Stream Detector

The old detector hardcoded a browser choice in its generated shell command:

```text
--cookies-from-browser chrome
```

That failed in an environment where Brave was the actual browser.

The detector's media discovery and general idea of adding browser session context were useful, but the handoff was coupled to a browser-name/profile assumption.

This is a concrete weakness for a generic tool because users may browse with Firefox, Brave, Chrome, Chromium, or other compatible browsers.

AIDM Stream Inspector should not hardcode:

- a browser name;
- a cookie database path;
- a profile location;
- shell syntax for invoking another tool.

The extension already runs inside the browser that made the successful request. Its job is to capture browser-observable request/session facts and later hand them to AiDM in a structured form.

## Why structured handoff remains the intended architecture

The desired architecture remains:

```text
successful browser request
        ↓
AIDM Stream Inspector
        ↓
structured browser-observable request/session context
        ↓
AiDM
        ↓
reproduce request using downloader tooling
```

This avoids the old problems of:

- `--cookies-from-browser chrome` vs Brave/Firefox mismatch;
- browser-specific filesystem paths;
- shell quoting/escaping;
- Bash syntax being passed through AiDM;
- coupling the extension to one downloader command format.

## Discovery vs reproduction remains a core distinction

The test confirms two separate extension responsibilities:

### Discovery

Find the real media request generated by browser playback.

M4 already demonstrated this successfully by detecting multiple `index.m3u8` candidates.

### Reproduction context

Capture enough browser-observable context that AiDM can reproduce the browser's successful request outside the browser when the raw URL alone is insufficient.

Therefore:

> Candidate detected != candidate externally reproducible.

The movi.pk test is currently the strongest regression target for the reproduction-context side of the project because it produces a reproducible contrast between raw-URL failure and cookie-backed success.

## Multiple `index.m3u8` candidates remain a separate problem

The test produced multiple `index.m3u8` candidates and M4 intentionally has no mechanism to determine which one should be chosen.

This ambiguity is separate from the session-context problem.

Do not mix:

1. **Which candidate is the most useful/top-level stream?**
2. **What request/session context is needed to reproduce that candidate?**

A candidate could be correctly ranked but fail externally because context is missing, or it could be externally reproducible but still be the wrong quality/rendition/child playlist.

## M5 priority created by this test

M5 should focus on **candidate request-context observation**.

For requests that M4 already identifies as media candidates, M5 should observe and associate the browser-provided context used by the successful request.

M5 should answer:

> What request context did the browser actually send with this detected media candidate?

The initial context of interest includes:

- User-Agent, where exposed;
- Referer, where exposed;
- Origin, where exposed;
- relevant request headers exposed by the browser API;
- whether cookie/session material is present/observable;
- authorization-related context where exposed and appropriate;
- tab/frame/request association needed to attach the context to the correct candidate.

The browser API limits must be respected. Captured request context is not the same as direct unrestricted access to a browser cookie database.

## M5 is intentionally not yet

M5 should **not** yet implement:

- candidate ranking;
- choosing among multiple `index.m3u8` entries;
- clipboard export;
- AiDM integration;
- shell-command generation;
- browser-profile/database-path hardcoding;
- persistent storage of sensitive session data;
- automatic dumping of all cookies;
- subtitle discovery;
- page-title extraction;
- final structured handoff schema;
- bypass logic for server-side restrictions.

The immediate purpose is observation and correct association of request context with the exact candidate.

## Controlled reproduction method for M5+

The movi.pk test bed should continue to be used with fresh media URLs.

Current known comparison:

```text
raw candidate URL                            → 404 / failure
same reproduction flow + correct browser cookies → success
```

Future controlled tests should determine the minimal sufficient context by varying one element at a time where practical, for example:

- URL + cookies;
- URL + Referer;
- URL + User-Agent;
- URL + Origin;
- URL + cookies + Referer;
- URL + cookies + User-Agent;
- combinations suggested by the actual browser request.

The goal is not to export every browser secret. The goal is to determine and reproduce the minimum context required for a successful request.

## Freshness and IP-bound structure

The observed URL contained timestamp/IP/signature-like data and may be short-lived or bound to request/session/network state.

This structure must be preserved exactly, but the project must not infer server validation rules solely from URL shape.

Future tests should continue distinguishing:

- cookie dependency;
- expiration/staleness;
- IP binding;
- Referer/Origin/User-Agent requirements;
- wrong candidate selection;
- other server-side validation.

For this reproduced case, cookie dependency is now directly supported by the test result; the other dimensions remain separate variables.

## Long-term checkpoint

The key architectural lesson is now stronger than before:

> Discovery and reproduction are separate problems, and at least one real regression target has demonstrated that browser cookies can be necessary for successful external reproduction of a correctly detected HLS candidate.

AIDM Stream Inspector should solve this generically by capturing browser-observable context from the browser actually making the request, not by hardcoding Chrome, Brave, Firefox, or any browser-specific cookie path.

This test bed should remain part of regression testing as long as it remains available and reproducible.