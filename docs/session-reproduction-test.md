# AIDM Stream Inspector — Session-Reproduction Test Bed

This document records a real-world test case where media discovery succeeds but replaying the captured media URL outside the browser depends on additional request context. It exists as a development checkpoint for the browser/session-handoff work.

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

## Old Stream Detector `yt-dlp` mode — important interpretation correction

The old detector also produced a `yt-dlp` command that added browser/session-oriented context, structurally including:

```text
--user-agent <browser UA>
--cookies-from-browser chrome
--referer https://<embedded-player-host>/
<exact HLS URL>
```

The first run failed because the test environment did not use Google Chrome and `yt-dlp` could not find a Chrome cookie database.

Changing only the browser source from `chrome` to `brave` allowed the command to proceed and download. A later remote-machine test then showed the same thing with Firefox on a different Linux machine: changing the browser source to an installed browser allowed `yt-dlp` to proceed even though that Firefox instance had not created the captured stream URL and had not been used to open the site.

This proves that the earlier apparent "cookie dependency" result was confounded by `yt-dlp` failing locally before the media request whenever the named browser database did not exist.

The browser-name option was therefore not, by itself, evidence that the originating browser cookies were required by the server.

## Ablation study — isolating the minimum sufficient context

A controlled ablation study was performed with a fresh captured HLS candidate.

The variables under consideration were:

- exact captured URL;
- Referer;
- User-Agent;
- browser cookies via `--cookies-from-browser`.

The observed results were:

```text
URL only                                  → failure / HTTP 404
URL + Referer + User-Agent + cookies      → download starts
URL + Referer + User-Agent                → download starts
URL + Referer                             → download starts
```

The `URL + Referer + User-Agent` run continued despite some fragment-level `403 Forbidden` retries. The download itself proceeded, so those intermittent fragment retries are recorded separately from the question of whether the manifest/request was reproducible at all.

### Minimum proven requirement for this test bed

The strongest conclusion from the ablation study is:

> For this movi.pk test bed, Referer is the minimum additional request context proven sufficient to turn the raw candidate from failure into a working external reproduction.

Cookies were not required for this reproduced case.

User-Agent was also not required for this reproduced case.

This conclusion is intentionally site/test-specific.

It must **not** be generalized into:

- cookies are never required by streaming sites;
- User-Agent is never required;
- Referer is always sufficient;
- every CDN validates the same fields.

Different servers may require different subsets or combinations of browser/session context.

## Architectural conclusion from the ablation study

The extension should not be designed around one mandatory header or one mandatory cookie flow.

Instead, AIDM Stream Inspector should capture the relevant browser-observable reproduction context for each candidate in a capability-based way, including where available:

- exact URL;
- Referer;
- User-Agent;
- Origin;
- relevant request headers;
- cookie/session context when present or needed;
- authorization-related context where exposed and appropriate;
- tab/frame/request association for the exact candidate.

The key rule is:

> Reproduction requirements are server-specific. Capture useful context generically; do not hardcode one website's minimum requirement into the architecture.

## Cookie support remains part of the architecture

The ablation study removes the assumption that cookies are required for movi.pk, but it does **not** remove cookie support from the project.

Another site may genuinely require authenticated/session cookies.

For that reason, cookie handling remains a future extension capability, but it should not be implemented as a universal always-required input.

The preferred long-term direction is to retrieve or hand off relevant cookies from inside the active browser context when permitted, rather than making AiDM guess browser names or hunt local profile databases.

The project should avoid hardcoding:

```text
--cookies-from-browser chrome
--cookies-from-browser brave
--cookies-from-browser firefox
```

as its primary architecture.

The extension already runs inside the browser that observed the successful request. It should eventually hand AiDM structured request/session facts rather than a browser-name assumption.

## Weakness exposed in the old Stream Detector

The old detector's generated command hardcoded:

```text
--cookies-from-browser chrome
```

That caused local failure when Chrome was not installed, even though changing the word to another installed browser allowed `yt-dlp` to continue.

This is a concrete handoff weakness because the generated command couples stream reproduction to:

- a guessed browser name;
- a local browser profile/database;
- a specific machine environment;
- shell syntax.

The old detector's stream discovery and header extraction remain useful, but browser-name hardcoding is not suitable for AIDM Stream Inspector's generic handoff architecture.

## Discovery vs reproduction remains a core distinction

The test confirms two separate extension responsibilities.

### Discovery

Find the real media request generated by browser playback.

M4 already demonstrated this successfully by detecting multiple `index.m3u8` candidates.

### Reproduction context

Capture enough browser-observable context that AiDM can reproduce the browser's successful request outside the browser when the raw URL alone is insufficient.

Therefore:

> Candidate detected != candidate externally reproducible.

The movi.pk test bed remains the strongest current regression target for the reproduction-context side of the project because raw URL replay fails while adding the correct Referer makes reproduction succeed.

## Multiple `index.m3u8` candidates remain a separate problem

The test produced multiple `index.m3u8` candidates and M4 intentionally has no mechanism to determine which one should be chosen.

This ambiguity is separate from the reproduction-context problem.

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

## Controlled reproduction method for future sites

The movi.pk ablation sequence should become a model for future regression testing.

For each new site/server where raw replay fails:

1. confirm browser playback succeeds;
2. capture a fresh exact media candidate;
3. verify URL-only reproduction;
4. add one browser-context element at a time;
5. record the minimum sufficient set;
6. avoid generalizing that site's result to all other sites.

Useful comparisons include:

```text
URL only
URL + Referer
URL + User-Agent
URL + Origin
URL + relevant cookies
URL + combinations suggested by the actual browser request
```

The goal is to discover the minimum sufficient reproduction context for each class of server while keeping the extension capable of capturing a broader safe set of context for sites that need more.

## Freshness and IP-bound structure

The observed URL contained timestamp/IP/signature-like data and may be short-lived or bound to request/session/network state.

This structure must be preserved exactly, but the project must not infer server validation rules solely from URL shape.

A later remote-machine reproduction also showed that a captured URL containing an IP-looking value could still be used from another machine. Therefore the presence of an IP-like field in a signed URL must not be treated as proof that the downloader's current IP is actively enforced.

Preserve IP-bound-looking data exactly; do not invent, strip, or reinterpret it.

## Long-term checkpoint

The central lesson from the ablation study is:

> Capture broad, browser-observable request context, but do not assume every context field is universally required.

For the current movi.pk regression target, Referer is the minimum proven requirement. Cookies and User-Agent remain important optional capabilities because other streaming systems may validate them.

AIDM Stream Inspector should remain generic, capability-based, and structured rather than hardcoding one browser, one website, one header set, or one downloader command.