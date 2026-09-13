let currentPlaybackTitle = null;
let titleRequestVersion = 0;
let lastTitleLog = "";

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
      currentPlaybackTitle = null;
      if (lastTitleLog !== "unavailable") {
        lastTitleLog = "unavailable";
        console.log(`[AIDM Playback Title] Page metadata unavailable for tab ${tabId}; reload eligible pages after extension reload.`);
      }
      return;
    }
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError || version !== titleRequestVersion
          || tabId !== globalThis.getCurrentTargetTabId() || tab.url !== snapshot.pageUrl) return;
      const selection = selectPlaybackTitle(snapshot.evidence);
      currentPlaybackTitle = { ...selection, tabId, frameId: 0, pageUrl: snapshot.pageUrl };
      const logKey = JSON.stringify([tabId, selection.title]);
      if (logKey === lastTitleLog) return;
      lastTitleLog = logKey;
      console.log(
        "[AIDM Playback Title]\n"
        + `Title: ${selection.title ?? "not established"}\n`
        + `Source: ${selection.source ?? "none"}\nStrength: ${selection.strength}\n`
        + `Tab ID: ${tabId}\nFrame: top-level (0)\nEvidence:\n`
        + selection.evidence.map((item) =>
          `  ${item.source}: ${item.value} [${item.strength}${item.eligible ? "" : "; not selected"}]`
        ).join("\n")
      );
    });
  });
}

function resetPlaybackTitle() {
  currentPlaybackTitle = null;
  lastTitleLog = "";
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
    ++titleRequestVersion;
    currentPlaybackTitle = null;
    if (change.status === "loading") return;
  }
  if (change.status === "complete" || change.url || change.title) refreshPlaybackTitle();
});
globalThis.resetPlaybackTitle = resetPlaybackTitle;
refreshPlaybackTitle();
