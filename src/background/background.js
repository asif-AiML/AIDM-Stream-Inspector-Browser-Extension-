let currentTargetTabId = null;
// Last relevant normal window; temporary OS focus loss does not relinquish it.
let focusedNormalWindowId = null;
let focusUpdateId = 0;
let resolveTargetReady;
let resolveBackgroundReady;
let retentionInvalidatedDuringStartup = false;
globalThis.targetReady = new Promise((resolve) => { resolveTargetReady = resolve; });
globalThis.playbackReady = new Promise((resolve) => { resolveBackgroundReady = resolve; });

function invalidateStartupRetention() {
  retentionInvalidatedDuringStartup = true;
}
globalThis.canRestorePlayback = () => !retentionInvalidatedDuringStartup;

function finishBackgroundStartup() {
  globalThis.initializePlaybackRetention().then(resolveBackgroundReady);
}

function getCurrentTargetTabId() {
  return currentTargetTabId;
}

function setCurrentTargetTabId(tabId, initialDiscovery = false, settled = true) {
  const nextTargetTabId = Number.isInteger(tabId) && tabId >= 0 ? tabId : null;

  if (settled) resolveTargetReady();
  if (nextTargetTabId === currentTargetTabId) {
    return;
  }

  if (!initialDiscovery) invalidateStartupRetention();
  currentTargetTabId = nextTargetTabId;
  // Initial target discovery can run before the intelligence modules load.
  if (!initialDiscovery) globalThis.resetPlaybackTitle?.();

  if (currentTargetTabId === null) {
    console.log("[AIDM Target] Active target tab unavailable.");
    return;
  }

  console.log(`[AIDM Target] Active target tab: ${currentTargetTabId}`);
}

function findActiveTabInWindow(windowId, updateId, initialDiscovery) {
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (updateId !== focusUpdateId || windowId !== focusedNormalWindowId) return;
    if (chrome.runtime.lastError) {
      setCurrentTargetTabId(null);
      return;
    }

    const activeTab = tabs[0];
    setCurrentTargetTabId(activeTab ? activeTab.id : null, initialDiscovery);
  });
}

function updateFocusedWindow(windowId, initialDiscovery = false) {
  // Desktop/system controls and action popups can temporarily take OS focus.
  // They neither change the selected tab nor cancel an in-flight discovery.
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  const updateId = ++focusUpdateId;
  const previousWindowId = focusedNormalWindowId;
  const generation = globalThis.getPlaybackGeneration?.();

  chrome.windows.get(windowId, {}, (browserWindow) => {
    const error = chrome.runtime.lastError;
    if (!error && browserWindow.type === "normal"
        && previousWindowId !== null && previousWindowId !== windowId) {
      invalidateStartupRetention();
      // A quick switch away and back still ends the old capture, even if the
      // intervening window lookup finishes late. Never clear a newer capture.
      if (updateId !== focusUpdateId && generation === globalThis.getPlaybackGeneration?.()) {
        globalThis.resetPlaybackTitle?.();
      }
    }
    if (error || updateId !== focusUpdateId) {
      if (updateId === focusUpdateId) setCurrentTargetTabId(null);
      return;
    }

    if (browserWindow.type !== "normal") {
      initializeTargetTab();
      return;
    }

    const discoveringTarget = initialDiscovery || currentTargetTabId === null;
    focusedNormalWindowId = windowId;
    findActiveTabInWindow(windowId, updateId, discoveringTarget);
  });
}

function handleTabActivated(activeInfo) {
  const updateId = ++focusUpdateId;

  // A real tab switch in the tracked window matters even while it is unfocused.
  if (activeInfo.windowId === focusedNormalWindowId) {
    setCurrentTargetTabId(activeInfo.tabId);
    return;
  }

  // An activation waking a worker with no established window still vetoes
  // restoration: it may represent leaving and returning to the retained tab.
  invalidateStartupRetention();
  chrome.windows.get(activeInfo.windowId, {}, (browserWindow) => {
    if (chrome.runtime.lastError || updateId !== focusUpdateId) {
      if (updateId === focusUpdateId) setCurrentTargetTabId(null);
      return;
    }

    if (!browserWindow.focused || browserWindow.type !== "normal") {
      // Activation in another background window must not steal the target.
      initializeTargetTab();
      return;
    }

    focusedNormalWindowId = activeInfo.windowId;
    setCurrentTargetTabId(activeInfo.tabId);
  });
}

function initializeTargetTab() {
  const initializationUpdateId = focusUpdateId;

  // A worker can restart while the browser has no OS focus. Reconstruct from
  // the last normal browser window, not from the background/popup's own window.
  chrome.windows.getLastFocused({ windowTypes: ["normal"] }, (browserWindow) => {
    if (chrome.runtime.lastError || initializationUpdateId !== focusUpdateId) {
      if (initializationUpdateId === focusUpdateId) setCurrentTargetTabId(null);
      return;
    }

    if (!browserWindow || browserWindow.type !== "normal") {
      setCurrentTargetTabId(null);
      return;
    }
    updateFocusedWindow(browserWindow.id, currentTargetTabId === null);
  });
}

globalThis.getCurrentTargetTabId = getCurrentTargetTabId;

// Register synchronously even in Firefox's asynchronous module-loading path.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!["AIDM_GET_PLAYBACK_STATE", "AIDM_SET_SELECTED_MEDIA", "AIDM_SET_SELECTED_SUBTITLE"]
      .includes(message?.type)) return;
  if (sender.id !== chrome.runtime.id || sender.tab
      || sender.url !== chrome.runtime.getURL("src/popup/popup.html")) return;
  globalThis.playbackReady.then(() => {
    if (message.type === "AIDM_GET_PLAYBACK_STATE") {
      sendResponse(globalThis.getPlaybackStateSnapshot());
    } else {
      const accepted = globalThis.updatePlaybackSelection(message);
      sendResponse({ accepted, snapshot: globalThis.getPlaybackStateSnapshot() });
    }
  });
  return true;
});

chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId !== currentTargetTabId) return;
  ++focusUpdateId;
  focusedNormalWindowId = null;
  setCurrentTargetTabId(null);
  initializeTargetTab();
});
// Catch a navigation that wakes the worker before target/module initialization.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading" || change.url) invalidateStartupRetention();
});
chrome.windows.onFocusChanged.addListener(updateFocusedWindow);
initializeTargetTab();

// Chromium loads only this service worker; Firefox loads both manifest scripts.
if (typeof importScripts === "function") {
  importScripts(
    "playback-state.js",
    "../core/stream-types.js",
    "candidate-detector.js",
    "../core/candidate-ranker.js",
    "../core/subtitle-role-classifier.js",
    "subtitle-evidence-observer.js",
    "network-observer.js",
    "playback-title.js"
  );
  globalThis.startNetworkObserver();
  finishBackgroundStartup();
} else {
  loadBackgroundPageScript("src/core/stream-types.js", () => {
    loadBackgroundPageScript("src/background/candidate-detector.js", () => {
      loadBackgroundPageScript("src/core/candidate-ranker.js", () => {
        loadBackgroundPageScript("src/core/subtitle-role-classifier.js", () => {
          loadBackgroundPageScript("src/background/subtitle-evidence-observer.js", () => {
            // Install the title gate before the first candidate can arrive.
            loadBackgroundPageScript("src/background/playback-state.js", () => {
              loadBackgroundPageScript("src/background/playback-title.js", () => {
                globalThis.startNetworkObserver();
                finishBackgroundStartup();
              });
            });
          });
        });
      });
    });
  });
}

console.log("AIDM Stream Inspector background context started.");

function loadBackgroundPageScript(extensionPath, handleLoad) {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL(extensionPath);
  script.addEventListener("load", handleLoad, { once: true });
  script.addEventListener("error", () => {
    console.error(`[AIDM] Could not load background module: ${extensionPath}`);
  }, { once: true });
  document.head.appendChild(script);
}
