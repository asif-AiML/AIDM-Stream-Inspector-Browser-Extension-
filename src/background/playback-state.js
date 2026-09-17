// The UI's single read model. Subtitle/title intelligence keeps its existing
// authoritative records; only previously log-only media needs new storage here.
const playbackMediaCandidates = [];
const maxPlaybackMediaCandidates = 128;
let playbackGeneration = 0;
let nextPlaybackMediaId = 1;
let omittedMediaCandidateCount = 0;
let capturedAt = null;
let playbackPageUrl = null;
let pageIdentityReadPending = false;
let retentionReady = false;
let pendingRetentionWrite;
let retentionWriteRunning = false;
const playbackStorageKey = "aidmCurrentPlayback";

function sessionStorageOperation(method, value) {
  return new Promise((resolve, reject) => {
    if (!chrome.storage?.session) {
      reject(new Error("Session storage unavailable"));
      return;
    }
    chrome.storage.session[method](value, (result) => {
      if (chrome.runtime.lastError) reject(new Error("Session storage operation failed"));
      else resolve(result);
    });
  });
}

// Keep only the newest pending snapshot. Serialize writes/removals so an older
// asynchronous save cannot overwrite a later navigation/tab reset.
async function writeRetainedPlayback() {
  if (retentionWriteRunning) return;
  retentionWriteRunning = true;
  while (pendingRetentionWrite !== undefined) {
    const snapshot = pendingRetentionWrite;
    pendingRetentionWrite = undefined;
    try {
      if (snapshot) await sessionStorageOperation("set", {
        [playbackStorageKey]: { version: 1, snapshot }
      });
      else await sessionStorageOperation("remove", playbackStorageKey);
    } catch {
      console.warn("[AIDM Playback] Session retention failed; capture remains in memory only.");
      // Do not leave an older persisted capture after a quota/write failure.
      try { await sessionStorageOperation("remove", playbackStorageKey); } catch { /* Already reported. */ }
    }
  }
  retentionWriteRunning = false;
}

function playbackStateChanged() {
  const snapshot = getPlaybackStateSnapshot();
  if (snapshot.status.playback === "detected" && capturedAt === null) capturedAt = Date.now();
  if (capturedAt !== null && !snapshot.pageUrl && !pageIdentityReadPending) {
    pageIdentityReadPending = true;
    const generation = playbackGeneration;
    readCurrentPlaybackTab(snapshot.tabId).then((tab) => {
      pageIdentityReadPending = false;
      if (generation !== playbackGeneration || tab?.id !== globalThis.getCurrentTargetTabId()
          || typeof tab.url !== "string" || !/^https?:\/\//.test(tab.url)) return;
      playbackPageUrl = tab.url;
      playbackStateChanged();
    });
  }
  if (!retentionReady) return;
  snapshot.capturedAt = capturedAt;
  pendingRetentionWrite = snapshot.status.playback === "detected" && snapshot.pageUrl
    ? snapshot : null;
  void writeRetainedPlayback();
}

function readCurrentPlaybackTab(tabId) {
  return new Promise((resolve) => {
    if (tabId === null) { resolve(null); return; }
    chrome.tabs.get(tabId, (tab) => resolve(chrome.runtime.lastError ? null : tab));
  });
}

async function initializePlaybackRetention() {
  const generation = playbackGeneration;
  let restored = false;
  try {
    const saved = await sessionStorageOperation("get", playbackStorageKey);
    await globalThis.targetReady;
    const tabId = globalThis.getCurrentTargetTabId();
    const tab = await readCurrentPlaybackTab(tabId);
    const retained = saved?.[playbackStorageKey];
    const snapshot = retained?.snapshot;
    // Current browser identity is authoritative. A lifecycle reset during
    // initialization invalidates restoration, even on the same URL.
    if (globalThis.canRestorePlayback() && generation === playbackGeneration
        && tabId === globalThis.getCurrentTargetTabId()
        && tab?.active && tab.status === "complete" && retained?.version === 1
        && snapshot?.tabId === tabId && typeof snapshot.pageUrl === "string"
        && snapshot.pageUrl === tab.url && snapshot.status?.playback === "detected"
        && Number.isFinite(snapshot.capturedAt) && snapshot.capturedAt > 0
        && Array.isArray(snapshot.media?.candidates) && snapshot.media.candidates.length > 0
        && snapshot.media.candidates.length <= maxPlaybackMediaCandidates
        && snapshot.media.candidates.every((candidate) => candidate.tabId === tabId)
        && Array.isArray(snapshot.subtitles?.candidates)
        && snapshot.subtitles.candidates.every((candidate) => candidate.tabId === tabId)) {
      const freshMedia = playbackMediaCandidates.splice(0);
      const freshOmittedCount = omittedMediaCandidateCount;
      playbackMediaCandidates.push(...snapshot.media.candidates);
      nextPlaybackMediaId = Math.max(...playbackMediaCandidates.map((candidate) => candidate.id)) + 1;
      omittedMediaCandidateCount = snapshot.media.omittedCandidateCount + freshOmittedCount;
      capturedAt = snapshot.capturedAt;
      playbackPageUrl = snapshot.pageUrl;
      restored = true;
      globalThis.restoreSubtitlePlaybackCandidates(snapshot.subtitles.candidates);
      globalThis.restorePlaybackTitleState(snapshot);
      // Observations received while storage was loading belong to this same
      // validated page. Keep them, using the existing bounds and ranking.
      for (const candidate of freshMedia) rememberPlaybackMedia(candidate);
    }
  } catch {
    console.warn("[AIDM Playback] Session restore unavailable; waiting for fresh observations.");
  } finally {
    await globalThis.targetReady;
    retentionReady = true;
    playbackStateChanged();
    // Metadata collection remains independent of whether restoration succeeded.
    if (!restored) globalThis.refreshPlaybackTitle();
  }
}

function resetPlaybackState() {
  playbackGeneration++;
  capturedAt = null;
  playbackPageUrl = null;
  playbackMediaCandidates.length = 0;
  omittedMediaCandidateCount = 0;
  globalThis.resetSubtitleCandidates?.();
  if (retentionReady) {
    pendingRetentionWrite = null;
    void writeRetainedPlayback();
  }
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
  playbackStateChanged();
}

function getPlaybackStateSnapshot() {
  const tabId = globalThis.getCurrentTargetTabId();
  const titleState = globalThis.getPlaybackTitleState?.();
  const subtitles = globalThis.getSubtitlePlaybackCandidates?.() ?? [];
  const best = findBestPlaybackMedia();
  const snapshot = {
    generation: playbackGeneration,
    capturedAt,
    tabId,
    pageUrl: titleState?.pageUrl ?? playbackPageUrl,
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

globalThis.getPlaybackGeneration = () => playbackGeneration;
globalThis.resetPlaybackState = resetPlaybackState;
globalThis.rememberPlaybackMedia = rememberPlaybackMedia;
globalThis.getPlaybackStateSnapshot = getPlaybackStateSnapshot;

globalThis.playbackStateChanged = playbackStateChanged;
globalThis.initializePlaybackRetention = initializePlaybackRetention;
