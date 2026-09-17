let currentTargetTabId = null;
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
  if (!initialDiscovery) invalidateStartupRetention();
  const updateId = ++focusUpdateId;

  focusedNormalWindowId = null;
  if (!initialDiscovery) setCurrentTargetTabId(null, false, false);

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    setCurrentTargetTabId(null);
    return;
  }

  chrome.windows.get(windowId, {}, (browserWindow) => {
    if (chrome.runtime.lastError || updateId !== focusUpdateId) {
      if (updateId === focusUpdateId) setCurrentTargetTabId(null);
      return;
    }

    if (!browserWindow.focused || browserWindow.type !== "normal") {
      setCurrentTargetTabId(null);
      return;
    }

    focusedNormalWindowId = windowId;
    findActiveTabInWindow(windowId, updateId, initialDiscovery);
  });
}

function handleTabActivated(activeInfo) {
  invalidateStartupRetention();
  if (activeInfo.windowId === focusedNormalWindowId && activeInfo.tabId !== currentTargetTabId) {
    setCurrentTargetTabId(null, false, false);
  }
  const updateId = ++focusUpdateId;

  chrome.windows.get(activeInfo.windowId, {}, (browserWindow) => {
    if (chrome.runtime.lastError || updateId !== focusUpdateId) {
      if (updateId === focusUpdateId) setCurrentTargetTabId(null);
      return;
    }

    if (!browserWindow.focused || browserWindow.type !== "normal") {
      if (currentTargetTabId === null) initializeTargetTab();
      return;
    }

    focusedNormalWindowId = activeInfo.windowId;
    setCurrentTargetTabId(activeInfo.tabId);
  });
}

function initializeTargetTab() {
  const initializationUpdateId = focusUpdateId;

  chrome.windows.getAll({ windowTypes: ["normal"] }, (browserWindows) => {
    if (chrome.runtime.lastError || initializationUpdateId !== focusUpdateId) {
      if (initializationUpdateId === focusUpdateId) setCurrentTargetTabId(null);
      return;
    }

    const focusedWindow = browserWindows.find((browserWindow) => browserWindow.focused);
    const focusedWindowId = focusedWindow
      ? focusedWindow.id
      : chrome.windows.WINDOW_ID_NONE;

    updateFocusedWindow(focusedWindowId, true);
  });
}

globalThis.getCurrentTargetTabId = getCurrentTargetTabId;

// Register synchronously even in Firefox's asynchronous module-loading path.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "AIDM_GET_PLAYBACK_STATE") return;
  if (sender.id !== chrome.runtime.id || sender.tab
      || sender.url !== chrome.runtime.getURL("src/popup/popup.html")) return;
  globalThis.playbackReady.then(() => sendResponse(globalThis.getPlaybackStateSnapshot()));
  return true;
});

chrome.tabs.onActivated.addListener(handleTabActivated);
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
