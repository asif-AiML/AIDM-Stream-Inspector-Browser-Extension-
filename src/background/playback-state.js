// The UI's single read model. Subtitle/title intelligence keeps its existing
// authoritative records; only previously log-only media needs new storage here.
const playbackMediaCandidates = [];
const maxPlaybackMediaCandidates = 128;
let playbackGeneration = 0;
let nextPlaybackMediaId = 1;
let omittedMediaCandidateCount = 0;

function resetPlaybackState() {
  playbackGeneration++;
  playbackMediaCandidates.length = 0;
  omittedMediaCandidateCount = 0;
  globalThis.resetSubtitleCandidates?.();
}

function findBestPlaybackMedia() {
  let best = null;
  for (const candidate of playbackMediaCandidates) {
    // Use the already-computed M6 score. Ties keep the first observation.
    if (!best || candidate.ranking.score > best.ranking.score) best = candidate;
  }
  return best;
}

function rememberPlaybackMedia(candidate) {
  if (candidate.tabId !== globalThis.getCurrentTargetTabId()) return;
  playbackMediaCandidates.push({ ...candidate, id: nextPlaybackMediaId++ });
  if (playbackMediaCandidates.length > maxPlaybackMediaCandidates) {
    // Preserve the best candidate through fragment floods; retain recent
    // alternatives without attempting media URL/range deduplication.
    const best = findBestPlaybackMedia();
    const index = playbackMediaCandidates.findIndex((item) => item !== best);
    playbackMediaCandidates.splice(index, 1);
    omittedMediaCandidateCount++;
  }
}

function getPlaybackStateSnapshot() {
  const tabId = globalThis.getCurrentTargetTabId();
  const titleState = globalThis.getPlaybackTitleState?.();
  const subtitles = globalThis.getSubtitlePlaybackCandidates?.() ?? [];
  const best = findBestPlaybackMedia();
  const snapshot = {
    generation: playbackGeneration,
    tabId,
    pageUrl: titleState?.pageUrl ?? null,
    title: titleState?.title ?? null,
    status: {
      playback: tabId === null ? "target-unavailable"
        : titleState?.hasPlaybackMedia ? "detected" : "not-detected",
      mediaAvailable: playbackMediaCandidates.length > 0,
      timedTextAvailable: subtitles.length > 0
    },
    media: {
      bestCandidateId: best?.id ?? null,
      candidates: playbackMediaCandidates,
      omittedCandidateCount: omittedMediaCandidateCount
    },
    subtitles: { candidates: subtitles }
  };
  // All producers supply plain, deliberately captured fields. JSON copying also
  // prevents popup/debug callers from mutating nested engine records.
  return JSON.parse(JSON.stringify(snapshot));
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "AIDM_GET_PLAYBACK_STATE") return;
  // This read API contains signed URLs/context. It belongs to the extension's
  // popup, not content scripts or arbitrary extension/page message senders.
  if (sender.id !== chrome.runtime.id || sender.tab
      || sender.url !== chrome.runtime.getURL("src/popup/popup.html")) return;
  sendResponse(getPlaybackStateSnapshot());
});

globalThis.getPlaybackGeneration = () => playbackGeneration;
globalThis.resetPlaybackState = resetPlaybackState;
globalThis.rememberPlaybackMedia = rememberPlaybackMedia;
globalThis.getPlaybackStateSnapshot = getPlaybackStateSnapshot;
