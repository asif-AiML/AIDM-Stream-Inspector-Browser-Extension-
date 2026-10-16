# AiDM + Stream Inspector + Psiphon: integration vision

Status: **proposal / architecture only**. Prepared on 2026-10-16. No proxy-control, downloader-routing, or local-controller code has been implemented in this extension branch.

## Why three independent projects should collaborate

The original inspiration is Windows IDM working with Psiphon: connect Psiphon, then IDM can download an otherwise ISP-blocked media link. On Linux, the independently developed projects can eventually provide an analogous experience:

1. **Psiphon-Linux** establishes and manages a local, free public-network tunnel, currently exposing SOCKS5 at `127.0.0.1:1081` and an HTTP proxy at `127.0.0.1:8081`. Its CLI and browser usage have been manually validated; long-duration stability remains unproven.
2. **AiDM Stream Inspector** observes browser media playback, ranks streams, collects available request-context evidence and hands the selected media/subtitle information to AiDM.
3. **AiDM** performs downloading using yt-dlp, aria2c and related engines. Eventually it can opt in to Psiphon routing for otherwise inaccessible URLs.

An ISP-blocked URL that fails in AiDM without Psiphon may work when the relevant downloader engine explicitly uses the Psiphon proxy. This **does not** solve unrelated causes such as expired signed URLs, geo-restrictions, site authentication, missing headers, DRM or incompatible protocols. Each engine's proxy behavior must be validated independently.

## Long-term architectural boundaries

```text
Firefox + AiDM Stream Inspector
   |  detection / media handoff
   +-----------------------------> AiDM (download engine)
   |                                 |
   | optional proxy control          | optional routed download
   v                                 v
Local Psiphon controller <------> Psiphon-Linux tunnel / local proxies
```

- Do **not** merge the three repositories or embed the Psiphon upstream engine into the extension. Keep each independently useful, testable and replaceable.
- The local controller owns tunnel lifecycle and connection readiness; the extension never assumes a listening TCP port means an established tunnel.
- AiDM, not the extension, owns download routing and per-engine proxy support. Browser proxy settings alone cannot route a separate Linux CLI downloader.
- Define a versioned, minimal integration contract later; do not invent localhost endpoints, native-messaging IDs, authentication tokens or trust assumptions now.
- Avoid exposing URL tokens, cookies, browsing history or Psiphon session identifiers to an unnecessary local service.

## Firefox-first, Chromium-safe UI design

The existing Stream Inspector works in both Firefox and Chromium derivatives. The new integration must be **Firefox-only** and **off by default**, without reducing detection, ranking, subtitles, title extraction or clipboard export on either engine.

Proposed controls when supported:

**Enable Psiphon Integration** (persistent, initially OFF)
- OFF: no Psiphon status polling, communication, proxy API calls, or proxy changes. The existing stream-inspection GUI behaves as before. Hide connection controls.
- ON: explicit opt-in to the local-controller feature. This is **not** the same as turning on a tunnel. Show clear status and a second control.

**Connect / Disconnect Psiphon** (available only when integration enabled)
- Connect: request an intentional start, await current-session tunnel readiness, then activate Firefox SOCKS5 with remote DNS.
- Disconnect: request intentional shutdown, then restore the explicitly agreed previous/direct Firefox proxy policy.
- Unexpected client crash or upstream tunnel loss: do **not** silently restore direct browsing; retain the protected proxy policy and show a disconnected/recovering/error state.
- If controller communication disappears or intent is ambiguous, treat it as a failure, not as user permission for direct fallback.

Firefox may require extension proxy permissions and a supported background messaging bridge; permission availability, conflicts with manual proxy settings, profile preferences, and extension restart behavior must be established before implementation. Do not claim a global kill switch or anonymity.

**Chromium/Brave:** present no Psiphon controls; do not call Firefox-only APIs or request browser-family-specific behavior. Existing features must continue unchanged. Feature detection and packaging/manifest compatibility need verification on both engines.

## Safety and user control

- New behavior must not silently rewrite an existing proxy setup or lose its previous state. A user may already rely on a separate proxy configuration.
- A deliberate OFF is different from a crash. This requires explicit controller-side intent, not merely checking whether a process is alive.
- Permissions should be minimal and requested only as appropriate for this optional capability; feasibility of optional proxy permissions is a research question.
- The plugin's previous Firefox/Chromium session-capture behavior remains the primary supported product. All changes belong on a separate branch and require regression testing before any merge.

## Source of truth

- Extension repository: `asif-AiML/AIDM-Stream-Inspector-Browser-Extension-`
- Independent Psiphon repository: `asif-AiML/Psiphon-Linux`
- Independent AiDM downloader: `asif-AiML/AiDM` (verify exact repository name before producing cross-repo changes)
- See [inspection and milestones](psiphon-integration-inspection.md) for current code boundaries, outstanding decisions, and acceptance criteria.
