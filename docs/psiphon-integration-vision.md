# Optional Firefox Psiphon integration — Stream Inspector vision

**Status:** planned / documentation only (2026-10-16). No proxy-switching implementation has been added on this branch.

## Revised cross-project decision

**Psiphon-Linux alone** supplies the independent tunnel engine and future standalone GUI. **AiDM will NOT embed Psiphon** or run its own tunnel. Instead it will offer an independent, OFF-by-default, provider-neutral **SOCKS5 special download mode** using yt-dlp for one URL at a time. This supersedes the earlier two-engine idea.

Proof of concept: with Psiphon-Linux running, `yt-dlp --proxy "socks5h://127.0.0.1:1081" "URL"` completed a download from an ISP-blocked website. This validates one manual yt-dlp proxy test, **not** implementation in AiDM or Stream Inspector.

See the [central decision record](https://github.com/asif-AiML/Linux_Mint/blob/master/Architecture/AiDM-Psiphon-Ecosystem.md) and [AiDM special-mode plan](https://github.com/asif-AiML/AiDM/blob/feat/controls-settings/docs/proxy-aware-special-mode.md). This extension document only governs browser-side functionality.

## Extension responsibility and boundaries

AiDM Stream Inspector remains a **Firefox + Chromium** media intelligence extension. Its existing passive network observation, ranking, subtitle detection, playback title, request context and clipboard export operate independently of both other applications.

The optional Firefox feature will communicate with **standalone Psiphon-Linux's local controller**, not an AiDM-embedded Psiphon engine. AiDM's proxy-aware mode is separate: Firefox proxy settings do **not** automatically affect downloads initiated by the external AiDM process.

```text
Firefox + Stream Inspector
       |              |
       | media handoff | optional Psiphon browser control
       v              v
     AiDM         Psiphon-Linux local controller
       |              |
       | independent  | owns connection lifecycle
       | yt-dlp proxy v
       +----------> local SOCKS5 proxy
```

Transport, authentication, client/controller state semantics, optional permissions and failure recovery remain design questions. Do not invent a localhost service contract before research.

## UI behavior (Firefox only)

There are **two distinct controls**:

1. **Enable Psiphon Integration** — persistent preference, initially **OFF**. OFF means no communication, status polling, proxy modification or unnecessary background work. Existing stream detection continues as normal. Enabling the feature does **not** establish a tunnel.
2. **Connect / Disconnect Psiphon** — only visible when integration is enabled. Requests lifecycle operations from the standalone Psiphon controller, with visible connection status.

Expected behavior:
- Intentional connect: establish an active tunnel and verify current-session readiness **before** setting Firefox SOCKS5 with remote DNS.
- Intentional disconnect: gracefully stop the owned tunnel and restore the explicitly agreed previous/direct Firefox proxy policy.
- Unexpected tunnel crash/loss or lost controller state: do **not** silently return to direct ISP routing. Keep the protected policy and surface a failure/recovery state.
- Other proxy extensions, pre-existing Firefox settings, browser restarts and extension disable/uninstall must be considered before implementation; no guarantee of a universal kill switch.

**Chromium/Brave:** hide or disable the optional Firefox-only feature completely. Never execute unsupported Firefox-specific APIs. Existing capture, selection and export must remain functional; no extra Psiphon runtime dependency.

## Integration and testing scope

The first implementation target is standalone Psiphon-Linux with Firefox. The extension should not know or care whether AiDM is installed. User-selected media and available browser context must continue to be exported in the existing form. If the resulting link is blocked without a proxy, AiDM may independently elect its **single-URL yt-dlp special mode**.

- No Psiphon engine inside the extension or AiDM.
- No browser extension downloading engine.
- No automatic Psiphon start merely because a video is detected.
- No system-wide VPN requirement.
- No Chromium proxy switching in this milestone.
- No claim that the verified yt-dlp command proves all Stream Inspector handoffs work through SOCKS5.

For inspected code entry points and milestone acceptance criteria, see [inspection and milestones](psiphon-integration-inspection.md).
