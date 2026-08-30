# AIDM Stream Inspector — Detection Notes

This document records real-world detection tests, observed behavior, failures, and lessons that should guide later candidate detection and ranking work.

Sensitive session values, signed tokens, and full live URLs containing credentials/tokens must not be preserved here. Test URLs are described structurally or redacted where necessary.

## M4 — Obvious media candidate detection

### Milestone purpose

M4 is the first conservative media-detection layer. It classifies obviously media-like target-tab requests from URL/path evidence such as HLS manifests, DASH manifests, direct video files, and common audio files.

M4 does **not** decide which candidate is best, does not understand master-vs-variant relationships, does not suppress media segments, and does not capture browser session context.

The tests below were therefore evaluated using the question:

> Did the extension correctly recognize obvious media candidates from the target tab while preserving the exact request URL?

They were **not** evaluated using the stronger question:

> Did the extension already identify the final stream AiDM should download?

---

## Test 1 — soap2dayhd.net and alternate playback mirrors

### Observation A — HLS URL with signed query parameters

The extension detected an HLS request whose pathname contained `master.m3u8`, followed by a long signed query string containing a token.

Structurally, the request looked like:

```text
https://<cdn-host>/<opaque-path>/master.m3u8?token=<redacted>
```

The complete request did not literally end with `.m3u8` because query parameters followed the manifest filename.

Result:

- classified as `[AIDM Candidate][HLS]`;
- worked in both Firefox and Brave;
- the captured URL played successfully in VLC at test time;
- AiDM also began downloading it without additional browser-session context at test time.

This validates an important M4 implementation detail: classification must inspect the URL pathname (or equivalent URL component) while preserving the original signed URL including its query string.

It does **not** prove that browser-session context is universally unnecessary. It proves only that this particular captured URL was independently usable during this test.

### Observation B — same media through a different server

Switching the playback server/mirror produced a different physical media URL on another host. This request ended directly in:

```text
/master.m3u8
```

The extension again classified it as HLS.

This demonstrates that the same user-visible movie can be delivered by different CDNs/servers with very different URL structures while remaining the same broad stream type.

Candidate classification therefore cannot depend on one site's URL shape or hostname.

### Subtitle observation

The web player had working subtitles, but the captured HLS URL used for VLC/AiDM did not itself provide the subtitles in the test.

This reinforces the existing architecture: subtitle discovery is a separate future responsibility. A successfully captured video stream should not be assumed to contain the page/player's subtitle tracks.

---

## Test 2 — StreamTape and StreamWish mirrors

### StreamTape

The extension detected a direct-video request on a StreamTape CDN. Its filename contained a compound-looking suffix similar to:

```text
<Movie.Name>.mkv.mp4?stream=1
```

Result:

- classified as `[AIDM Candidate][VIDEO]`;
- played successfully in VLC at test time;
- old Stream Detector had previously failed to expose a useful StreamTape media request during earlier testing.

This is a useful M4 win: straightforward direct-video classification found a usable request in a case where the previous detector had been unreliable.

Again, this does not yet establish why the older detector failed on the earlier attempt; it only records that the new extension successfully observed and classified the request in this test.

### StreamWish

The same user-visible media played through StreamWish generated multiple HLS candidates, including structurally:

```text
.../master.m3u8
.../index-v1-a1.m3u8
.../index-a1.m3u8
```

Result:

- all were correctly recognizable as HLS candidates;
- the extension intentionally did not choose among them;
- one `master.m3u8` test did not start playback in VLC, although VLC did not immediately produce a clear error;
- AiDM began processing/downloading that manifest during the test.

This is an important distinction:

> Correct media classification does not guarantee that every detected candidate is equally useful, independently playable, or the correct final choice.

Multiple related HLS requests are expected in adaptive streaming. Determining master playlists, media playlists, audio/video variants, and the best handoff candidate belongs to later analysis/ranking milestones.

---

## Test 3 — Shaka Player demo streams

This was the most important M4 limitation test.

During playback, the extension console filled continuously with direct-video candidates resembling:

```text
.../v-0144p-0100k-libx264-s19.mp4
.../a-eng-0128k-aac-2c-s19.mp4
.../v-0144p-0100k-libx264-s20.mp4
.../a-eng-0128k-aac-2c-s20.mp4
```

The `s19`, `s20`, `s21`, etc. pattern corresponded to successive media segments/chunks.

Individual segment URLs were small (KB-scale when downloaded) and were not useful standalone media choices.

Meanwhile, the old Stream Detector exposed higher-level HLS playlist candidates such as variant playlists and the top-level `hls.m3u8`, which were more useful from a user's perspective.

### What this test proves

M4 is functioning according to its narrow definition: `.mp4` requests are obvious media candidates.

However, M4 currently has no understanding of whether an `.mp4` request is:

- a complete downloadable video;
- one video segment;
- one audio segment;
- one rendition in an adaptive stream;
- part of a larger manifest-controlled playback graph.

Therefore obvious extension matching alone can create heavy candidate noise even while technically classifying media correctly.

### Future direction exposed by Shaka

Later milestones need mechanisms that can distinguish or relate:

- manifests vs segments;
- complete direct files vs fragmented media;
- video vs audio renditions;
- repeated sequential segment patterns;
- candidates belonging to the same playback session;
- higher-level manifests that should rank above their hundreds of child segments.

Candidate suppression/deduplication/ranking should be designed from this evidence rather than added blindly to M4.

### Audio/video separation observation

A higher-level HLS link captured by the old detector produced a full-duration video download during testing but had no audible sound.

This is consistent with adaptive media where audio and video can be separate renditions. The test does not by itself identify the exact playlist role, but it confirms that "full-duration playable/downloadable candidate" still does not necessarily mean "complete audiovisual result".

Future ranking/manifest analysis must therefore avoid equating duration or successful download with completeness.

---

## Test 4 — Plex

Earlier project notes had treated Plex as an example where the old Stream Detector failed and where browser-session context might be required.

The M4 reproduction test corrected that assumption.

The extension detected several Plex media candidates, structurally including:

```text
https://watch.plex.tv/videos/auto-play-sample.mp4
https://vod.provider.plex.tv/...-hls.m3u8?<plex-query-parameters-redacted>
https://vod-content.plexvideos.com/.../stream_4.m3u8
https://vod-content.plexvideos.com/.../stream_1.m3u8
```

The old Stream Detector was then retested on the same Plex playback and exposed essentially the same useful media candidates.

A `stream_4.m3u8` candidate:

- played in VLC during the test;
- began downloading through AiDM without manually supplied browser-session context;
- produced intermittent HTTPS read-timeout retries during the AiDM download.

### Corrected conclusion

The previous Plex failure should no longer be used as evidence that the old detector inherently fails on Plex or that Plex necessarily requires browser-session handoff for these media URLs.

The earlier test was likely flawed, stale, or otherwise not equivalent to the successful reproduction.

This correction is important because architecture should be based on reproducible evidence rather than remembered one-off failures.

### Remaining Plex question

Plex produced multiple plausible HLS variants such as `stream_1.m3u8` and `stream_4.m3u8`.

M4 intentionally cannot answer which one is the best user-facing candidate.

That ambiguity is evidence for later metadata/relationship/ranking work, not an M4 defect.

---

## M4 overall verdict — PASS

M4 passed its intended goal.

Verified behaviors from these tests:

- obvious HLS candidates are detected;
- HLS detection works when `.m3u8` is followed by signed query parameters;
- exact signed/tokenized URLs can be preserved while classification inspects their path;
- direct-video requests are detected;
- the same playback can expose different candidate types/URL structures on different mirrors;
- multiple related HLS candidates are surfaced rather than prematurely choosing one;
- Firefox and Brave both detected the tested candidates;
- real-world StreamTape detection succeeded where the previous detector had previously been unreliable.

M4 also exposed important limitations that are intentionally outside its scope:

- segmented `.mp4` traffic can flood the candidate stream;
- candidate detection is not candidate usefulness;
- manifests should eventually be related to their child segments;
- master/variant/audio/video roles are not yet understood;
- multiple HLS variants require later ranking/metadata;
- subtitles require separate discovery;
- successful raw-URL playback/download does not prove browser-session context is unnecessary in general.

---

## Browser-session requirement — revised testing rule

The M4 tests showed that several captured URLs from the current test bed were usable directly in VLC/AiDM without manually supplying cookies, Referer, User-Agent, or other browser-session data.

This must **not** be generalized into:

> The extension does not need browser-session capture.

The current test bed simply did not provide strong evidence for that requirement.

A proper future browser-session test should use a controlled comparison where:

1. playback succeeds inside the browser;
2. the exact captured media URL fails when replayed outside the browser with no session context;
3. the relevant browser-observable context is captured;
4. replay succeeds, or materially changes behavior, when the required context is supplied.

Only such a paired test can demonstrate that a particular server actually depends on browser/session state.

Until that evidence is reproduced, browser-session handoff remains an architectural goal motivated by known classes of protected streaming systems and YouTube/session problems, but **Plex should no longer be cited as the validating example**.

---

## Regression-test-bed lessons

The current tests suggest maintaining different classes of targets rather than relying on one website:

- **controlled standards/demo target:** Shaka Player, useful for deterministic HLS/DASH and segment behavior;
- **real-world multi-mirror targets:** useful for varying CDN/player behavior and messy candidate sets;
- **Plex/public mature platform:** useful for multiple manifest variants and reproducibility checks;
- **future session-enforced target:** specifically needed to prove header/cookie/session handoff rather than assuming it.

Shaka should remain particularly important because it exposed a weakness that simple success-only tests would have missed: an extension can "detect lots of media" while producing a worse user-facing candidate set than a detector that understands manifests and segment relationships.

---

## Long-term checkpoint from M4 testing

The strongest lesson is:

> Detection quantity is not detection quality.

A future Stream Inspector should prefer a small number of meaningful, explainable stream candidates over hundreds of technically correct media-segment matches.

M4 establishes the baseline detector. Later milestones should add evidence and relationships without destroying this simple deterministic layer.
