let currentTargetTabId = null;
let focusedNormalWindowId = null;
let focusUpdateId = 0;

function getCurrentTargetTabId() {
  return currentTargetTabId;
}

function setCurrentTargetTabId(tabId) {
  const nextTargetTabId = Number.isInteger(tabId) && tabId >= 0 ? tabId : null;

  if (nextTargetTabId === currentTargetTabId) {
    return;
  }

  currentTargetTabId = nextTargetTabId;

  if (currentTargetTabId === null) {
    console.log("[AIDM Target] Active target tab unavailable.");
    return;
  }

  console.log(`[AIDM Target] Active target tab: ${currentTargetTabId}`);
}

function findActiveTabInWindow(windowId, updateId) {
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (chrome.runtime.lastError
        || updateId !== focusUpdateId
        || windowId !== focusedNormalWindowId) {
      return;
    }

    const activeTab = tabs[0];
    setCurrentTargetTabId(activeTab ? activeTab.id : null);
  });
}

function updateFocusedWindow(windowId) {
  const updateId = ++focusUpdateId;

  focusedNormalWindowId = null;
  setCurrentTargetTabId(null);

  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    return;
  }

  chrome.windows.get(windowId, {}, (browserWindow) => {
    if (chrome.runtime.lastError || updateId !== focusUpdateId) {
      return;
    }

    if (!browserWindow.focused || browserWindow.type !== "normal") {
      return;
    }

    focusedNormalWindowId = windowId;
    findActiveTabInWindow(windowId, updateId);
  });
}

function handleTabActivated(activeInfo) {
  if (activeInfo.windowId === focusedNormalWindowId) {
    focusUpdateId += 1;
    setCurrentTargetTabId(activeInfo.tabId);
  }
}

function initializeTargetTab() {
  const initializationUpdateId = focusUpdateId;

  chrome.windows.getAll({ windowTypes: ["normal"] }, (browserWindows) => {
    if (chrome.runtime.lastError || initializationUpdateId !== focusUpdateId) {
      return;
    }

    const focusedWindow = browserWindows.find((browserWindow) => browserWindow.focused);
    const focusedWindowId = focusedWindow
      ? focusedWindow.id
      : chrome.windows.WINDOW_ID_NONE;

    updateFocusedWindow(focusedWindowId);
  });
}

globalThis.getCurrentTargetTabId = getCurrentTargetTabId;

chrome.tabs.onActivated.addListener(handleTabActivated);
chrome.windows.onFocusChanged.addListener(updateFocusedWindow);
initializeTargetTab();

// Chromium loads only this service worker; Firefox loads both manifest scripts.
if (typeof importScripts === "function") {
  importScripts("network-observer.js");
}

console.log("AIDM Stream Inspector background context started.");
