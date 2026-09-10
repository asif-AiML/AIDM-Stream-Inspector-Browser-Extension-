# YouTube Browser-Session Requirements

This document records why YouTube has become a first-class requirement for AIDM Stream Inspector, what browser/session context AiDM may need from the extension, and what was learned from the failed YouTube quality-selection work in AiDM.

The purpose of this document is not to define a YouTube downloader inside the extension. The extension remains the browser intelligence and session-handoff layer. AiDM remains responsible for yt-dlp, aria2c, FFmpeg, download routing, format selection, merging, and post-processing.

## Why YouTube now depends on the extension

AiDM originally treated YouTube as a normal yt-dlp-supported site. That was sufficient while yt-dlp could access the same useful media formats without browser session context.

During later testing, this assumption stopped being reliable. Raw yt-dlp requests began hitting YouTube-side restrictions such as:

```text
HTTP Error 429: Too Many Requests
Sign in to confirm you're not a bot
Missing required Visitor Data
```

The same problem appeared while implementing playlist quality selection. AiDM could discover a quality list such as:

```text
1 - 1080p
2 - 720p
3 - 360p
4 - 144p
```

The user selected `1080p`, and AiDM correctly passed a height-constrained yt-dlp format expression into the playlist download command. However, the resulting files were still 360p when verified with `ffprobe`.

The quality selector was therefore not merely a UI problem. The selected value reached yt-dlp, but the actual YouTube request was operating without the browser session context required to expose/retrieve the higher-quality streams.

A later raw diagnostic isolated the issue.

Without browser cookies:

```bash
yt-dlp -F "YOUTUBE_VIDEO_URL"
```

failed with YouTube restrictions including HTTP 429, sign-in/anti-bot messages, and missing Visitor Data.

With the active Firefox browser session:

```bash
yt-dlp \
  --cookies-from-browser firefox \
  -F \
  "YOUTUBE_VIDEO_URL"
```

yt-dlp successfully exposed a real format table containing, among others:

```text
360p
720p
1080p
```

This proved an important architectural point:

> YouTube quality selection is only meaningful when quality discovery and the actual download operate with compatible browser/session context.

A menu that advertises 1080p is misleading if the downstream yt-dlp request is effectively anonymous or otherwise restricted to 360p.

## What is YouTube's responsibility, what is yt-dlp's responsibility, and what is AiDM's responsibility

The failure needs to be separated into layers.

### YouTube-side restrictions

YouTube may apply restrictions based on factors such as:

- browser/session state;
- cookies;
- visitor/session identifiers;
- account state;
- IP reputation or rate limits;
- anti-bot checks;
- client identity;
- short-lived or dynamically generated request data;
- current YouTube attestation/PO-token requirements.

These restrictions are external to AiDM. The extension cannot guarantee that every YouTube wall can be bypassed, and it must not be designed around that assumption.

### yt-dlp

yt-dlp remains the YouTube extractor and format-selection engine. When yt-dlp is given sufficient session context, it can enumerate and select higher-quality media formats. The extension should not duplicate yt-dlp's YouTube extraction logic.

### AiDM

AiDM is responsible for using the information supplied by the extension consistently. In particular, quality discovery and the actual download must not use different session environments.

For example, this is invalid architecture:

```text
quality discovery
    -> browser-backed session
    -> sees 1080p

actual download
    -> anonymous/restricted session
    -> only gets 360p
```

The desired architecture is:

```text
Browser
   |
   v
AIDM Stream Inspector
   |
   +-- YouTube page/session context
   |
   v
structured session handoff
   |
   v
AiDM / yt-dlp
   |
   +-- quality discovery
   +-- format selection
   +-- actual download

All using compatible session context
```

## YouTube-specific extension goal

For YouTube, AIDM Stream Inspector should provide AiDM with enough browser/session context to let yt-dlp operate as close as practical to the already-working browser session.

The goal is not to scrape YouTube media URLs directly and replace yt-dlp.

The goal is:

> Capture or describe the browser session context that yt-dlp lacks when it runs outside the browser.

## Desired YouTube output from the extension

The exact schema is not locked yet, but the extension should aim to expose the following categories of data when browser APIs make them available.

### Page identity

- current YouTube page URL;
- normalized video URL where appropriate;
- playlist URL when the active page is an explicit playlist;
- page title;
- tab ID for internal association;
- top-level frame URL;
- relevant iframe/player URL if one exists.

Example:

```json
{
  "type": "youtube",
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "page_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "title": "Example video title",
  "tab_id": 42
}
```

### Browser identity

- browser family, for example Firefox or Chromium;
- browser/profile hint if needed for downstream cookie/session use;
- User-Agent when observable;
- relevant client/request headers when observable.

Example:

```json
{
  "browser": {
    "family": "firefox",
    "profile": "default",
    "user_agent": "Mozilla/5.0 ..."
  }
}
```

The extension should not assume that a browser profile can always be identified or exported safely. Any such field must reflect data that can actually be determined.

### Cookie/session context

The extension should determine what cookie/session information can be safely and reliably handed to AiDM.

Potential forms include:

- cookies relevant to `youtube.com` and related media/auth domains, where extension permissions allow access;
- a browser/profile reference that allows yt-dlp to use browser cookies itself;
- a structured indication that usable browser cookies exist;
- request-scoped cookie headers where observable and appropriate.

A possible high-level representation is:

```json
{
  "session": {
    "browser": "firefox",
    "cookies_available": true,
    "cookie_strategy": "browser_profile"
  }
}
```

A more direct form, only if browser APIs and the security model support it, could be:

```json
{
  "session": {
    "cookies": [
      {
        "name": "example_cookie",
        "domain": ".youtube.com",
        "path": "/",
        "value": "..."
      }
    ]
  }
}
```

The exact cookie-handoff mechanism must be decided after API testing. Captured request context is not the same thing as unrestricted browser-cookie database access.

## Visitor Data and related YouTube request context

During testing, yt-dlp reported:

```text
Missing required Visitor Data
```

Visitor Data is therefore a specific YouTube-side signal that must be considered during extension research.

The extension should investigate whether relevant YouTube visitor/session identifiers are visible through permitted browser request APIs, page context, cookies, or other non-invasive browser-visible data.

Possible future structured fields might look like:

```json
{
  "youtube": {
    "visitor_data": "...",
    "visitor_data_available": true
  }
}
```

However, this is a research target, not a guaranteed capability.

The extension must not fabricate Visitor Data, guess values, or assume that every YouTube anti-bot restriction can be solved by exporting one identifier.

If Visitor Data is unavailable through extension APIs, that fact should be represented explicitly rather than hidden.

Example:

```json
{
  "youtube": {
    "visitor_data_available": false
  }
}
```

## Relevant request headers

For YouTube-specific requests, useful browser context may include, where observable:

- `User-Agent`;
- `Referer`;
- `Origin`;
- cookie/session headers;
- authorization-related headers where browser APIs expose them and export is appropriate;
- YouTube client/version headers;
- visitor/session-related headers;
- request URL and exact query parameters;
- response status and selected response headers for diagnostics.

The extension should preserve exact values rather than reconstructing or normalizing security-sensitive request data.

Example:

```json
{
  "headers": {
    "user-agent": "Mozilla/5.0 ...",
    "referer": "https://www.youtube.com/",
    "origin": "https://www.youtube.com"
  }
}
```

This example is illustrative. The extension must export only headers actually observed or obtained through legitimate browser APIs.

## Exact URL and signed/dynamic data preservation

YouTube may use dynamically generated URLs or request parameters. If the extension observes a URL containing tokens, signatures, expiry information, visitor/client data, or other opaque query parameters, it should preserve the exact captured value.

The extension must not casually strip, normalize, reorder, or rebuild security-sensitive query parameters.

The same principle already applies to HLS/DASH/CDN URLs and should also apply to YouTube-related traffic.

## Quality-selection lesson

The failed playlist quality selector is an important design lesson and should remain documented.

The implementation sequence was:

1. AiDM added explicit YouTube playlist support.
2. AiDM added reusable quality discovery.
3. yt-dlp metadata exposed qualities including 1080p, 720p, 360p, and 144p.
4. The user selected 1080p.
5. AiDM generated a height-constrained format expression and passed it to yt-dlp.
6. Downloaded files were still 360p.
7. `ffprobe` confirmed the output height was 360.
8. Tightening the yt-dlp format expression did not fix the result.
9. Raw `yt-dlp -F` without browser cookies then failed with HTTP 429, sign-in/anti-bot restrictions, and Missing required Visitor Data.
10. Raw `yt-dlp --cookies-from-browser firefox -F` immediately exposed the expected higher formats including 720p and 1080p.

The conclusion is:

> Quality discovery, quality selection, and actual download must all run against a compatible YouTube session. Otherwise AiDM can offer a technically valid quality choice that the downstream request cannot retrieve.

This is why YouTube session handoff belongs in AIDM Stream Inspector rather than being treated as an isolated AiDM format-selection bug.

## Proposed structured YouTube handoff

A future extension-to-AiDM payload may resemble:

```json
{
  "type": "youtube",
  "url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "page_url": "https://www.youtube.com/watch?v=VIDEO_ID",
  "title": "Example video title",
  "browser": {
    "family": "firefox",
    "profile": "default",
    "user_agent": "Mozilla/5.0 ..."
  },
  "session": {
    "cookies_available": true,
    "cookie_strategy": "browser_profile"
  },
  "youtube": {
    "visitor_data_available": true,
    "visitor_data": "..."
  },
  "headers": {
    "referer": "https://www.youtube.com/",
    "origin": "https://www.youtube.com"
  }
}
```

This schema is intentionally provisional. It describes the information boundary, not the final implementation contract.

The final schema should be based on what Firefox and Chromium extension APIs can reliably expose and what AiDM/yt-dlp actually need.

## Possible playlist-specific extension data

For an explicit YouTube playlist, the extension may additionally report:

```json
{
  "type": "youtube_playlist",
  "url": "https://www.youtube.com/playlist?list=PLAYLIST_ID",
  "title": "Example playlist",
  "browser": {
    "family": "firefox"
  },
  "session": {
    "cookies_available": true
  }
}
```

The extension should not enumerate and download playlist items itself. yt-dlp should remain responsible for playlist extraction and media-format logic.

## What the extension should not attempt to solve

Even with a strong browser-session handoff, YouTube may still reject or restrict requests because of conditions outside the extension's control.

Examples include:

- IP-based rate limiting;
- account-level restrictions;
- CAPTCHA or interactive verification;
- server-side anti-bot decisions;
- device/client attestation;
- PO-token requirements that cannot be satisfied from ordinary extension-visible state;
- TLS/client fingerprint differences between the browser and yt-dlp;
- short-lived session state;
- YouTube-side changes to player APIs and media delivery.

Therefore the extension's objective is not:

> bypass every YouTube restriction.

Its objective is:

> eliminate avoidable failures caused by AiDM/yt-dlp lacking browser context that already exists in a working browser session.

## Development requirements derived from the YouTube failure

The YouTube integration should eventually satisfy these requirements:

1. Session data used for quality discovery and actual download must be compatible.
2. The extension must expose only browser/session data it can actually observe or access.
3. Missing critical session fields should be explicit rather than silently replaced with guessed values.
4. AiDM should not advertise a quality as usable merely because metadata mentions it if the current session cannot actually retrieve it.
5. The extension should preserve exact security-sensitive values rather than rebuilding them.
6. yt-dlp remains responsible for YouTube extraction and format selection.
7. aria2c remains the preferred transfer engine where yt-dlp can delegate to it.
8. FFmpeg may merge streams when required but must not be used to fake a selected quality through transcoding.
9. Browser-session support should be designed generically enough to benefit single videos, bulk YouTube URLs, and playlists.
10. YouTube-specific logic must not compromise the extension's primary HLS/DASH/media-inspection architecture.

## Relationship to the wider extension mission

YouTube and ordinary streaming sites now point to the same architectural need.

For HLS/DASH sites, the extension needs to provide:

```text
fresh media URL
+ cookies/session context
+ User-Agent
+ Referer
+ Origin
+ relevant headers
+ page/frame context
```

For YouTube, the extension needs to provide:

```text
YouTube page URL
+ cookies/session context
+ browser identity
+ relevant request/session identifiers
+ Visitor Data when legitimately observable
+ compatible context for yt-dlp
```

Both use cases therefore reinforce the same architecture:

```text
Browser
   |
   v
AIDM Stream Inspector
   |
   +-- network observation
   +-- page context
   +-- session context
   |
   v
structured handoff
   |
   v
AiDM
   |
   +-- yt-dlp
   +-- aria2c
   +-- FFmpeg when required
```

The extension is the browser intelligence and session-handoff layer. AiDM is the downloader.
