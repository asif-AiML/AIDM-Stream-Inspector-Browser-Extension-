let currentPlaybackTitle = null;
let currentTitleEvidence = null;
let hasPlaybackMedia = false;
let titleRequestVersion = 0;
let lastTitleLog = "";
let titleMetadataUnavailable = false;
let unavailableNoticeLogged = false;

function selectPlaybackTitle(observedEvidence) {
  const sources = {
    "og:title": { priority: 3, strength: "HIGH" },
    "twitter:title": { priority: 2, strength: "HIGH" },
    "h1": { priority: 1, strength: "MEDIUM" },
    "document.title": { priority: 0, strength: "LOW/FALLBACK" },
    "iframe title attribute": { priority: -1, strength: "SUPPORTING ONLY" }
  };
  const evidence = [];
  let selected = null;
  for (const item of (Array.isArray(observedEvidence) ? observedEvidence.slice(0, 16) : [])) {
    if (!item || !Object.hasOwn(sources, item.source) || typeof item.value !== "string"
        || item.value.length > 2048 || !item.value.trim()) continue;
    const value = item.value.trim();
    const rule = sources[item.source];
    // Exact generic fallback labels are not useful. Structured metadata may
    // legitimately name a film "Home", so it is not subject to this exclusion.
    const generic = rule.priority < 2 && /^(home|player|watch)$/i.test(value);
    const entry = { source: item.source, value, strength: rule.strength,
      eligible: rule.priority >= 0 && !generic };
    evidence.push(entry);
    if (entry.eligible && (!selected || rule.priority > sources[selected.source].priority)) {
      selected = entry;
    }
  }
  return { title: selected?.value ?? null, source: selected?.source ?? null,
    strength: selected?.strength ?? "UNAVAILABLE", evidence };
}

function refreshPlaybackTitle() {
  const tabId = globalThis.getCurrentTargetTabId();
  const version = ++titleRequestVersion;
  if (tabId === null) return;
  // The browser routes this to the current top-level document, never a player
  // subframe. A page notification is only a trigger, not trusted title data.
  chrome.tabs.sendMessage(tabId, { type: "AIDM_READ_TITLE" }, { frameId: 0 }, (snapshot) => {
    const error = chrome.runtime.lastError;
    if (version !== titleRequestVersion || tabId !== globalThis.getCurrentTargetTabId()) return;
    if (error || !snapshot || typeof snapshot.pageUrl !== "string") {
      currentTitleEvidence = null;
      currentPlaybackTitle = null;
      titleMetadataUnavailable = true;
      promotePlaybackTitle();
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || version !== titleRequestVersion
          || tabId !== globalThis.getCurrentTargetTabId() || tab.url !== snapshot.pageUrl) return;
      // A page notification can reveal an SPA URL change before tabs.onUpdated.
      if (currentTitleEvidence && currentTitleEvidence.pageUrl !== snapshot.pageUrl) {
        clearPlaybackTitle();
      }
      const selection = selectPlaybackTitle(snapshot.evidence);
      currentTitleEvidence = { ...selection, tabId, frameId: 0, pageUrl: snapshot.pageUrl };
      titleMetadataUnavailable = false;
      promotePlaybackTitle();
    });
  });
}

function promotePlaybackTitle() {
  if (!hasPlaybackMedia) return;
  const tabId = globalThis.getCurrentTargetTabId();
  if (titleMetadataUnavailable && !unavailableNoticeLogged) {
    unavailableNoticeLogged = true;
    console.log(`[AIDM Playback Title] Page metadata unavailable for tab ${tabId}; reload eligible pages after extension reload.`);
  }
  const selection = currentTitleEvidence;
  if (!selection || selection.tabId !== tabId) return;
  currentPlaybackTitle = selection.title ? selection : null;
  if (!currentPlaybackTitle) return;
  // Alternate evidence and provenance still refresh internally. The same
  // human-readable title does not need another full block just for rediscovery.
  const logKey = JSON.stringify([tabId, selection.title]);
  if (logKey === lastTitleLog) return;
  lastTitleLog = logKey;
  console.log(
    "[AIDM Playback Title]\n"
    + `Title: ${selection.title}\n`
    + `Source: ${selection.source}\nStrength: ${selection.strength}\n`
    + `Tab ID: ${tabId}\nFrame: top-level (0)\nEvidence:\n`
    + selection.evidence.map((item) =>
      `  ${item.source}: ${item.value} [${item.strength}${item.eligible ? "" : "; not selected"}]`
    ).join("\n")
  );
}

function observePlaybackMedia(tabId, candidateEvidence) {
  const types = globalThis.AIDM_STREAM_TYPES;
  if (tabId !== globalThis.getCurrentTargetTabId()
      || ![types.HLS, types.DASH, types.DIRECT_VIDEO].includes(candidateEvidence.type)
      || hasPlaybackMedia) return;
  hasPlaybackMedia = true;
  promotePlaybackTitle();
  // Re-read once at gate opening, even if metadata hasn't sent a new mutation.
  refreshPlaybackTitle();
}

function clearPlaybackTitle() {
  globalThis.resetPlaybackState();
  ++titleRequestVersion;
  hasPlaybackMedia = false;
  currentTitleEvidence = null;
  currentPlaybackTitle = null;
  lastTitleLog = "";
  titleMetadataUnavailable = false;
  unavailableNoticeLogged = false;
}

function resetPlaybackTitle() {
  clearPlaybackTitle();
  refreshPlaybackTitle();
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "AIDM_TITLE_CHANGED" && sender.id === chrome.runtime.id
      && sender.frameId === 0 && sender.tab?.id === globalThis.getCurrentTargetTabId()) {
    refreshPlaybackTitle();
  }
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (tabId !== globalThis.getCurrentTargetTabId()) return;
  if (change.status === "loading" || change.url) {
    clearPlaybackTitle();
    if (change.status === "loading") return;
  }
  if (change.status === "complete" || change.url || change.title) refreshPlaybackTitle();
});
globalThis.resetPlaybackTitle = resetPlaybackTitle;
globalThis.observePlaybackMedia = observePlaybackMedia;
globalThis.getPlaybackTitleState = () => ({
  pageUrl: currentTitleEvidence?.pageUrl ?? null,
  title: currentPlaybackTitle,
  hasPlaybackMedia
});
refreshPlaybackTitle();
