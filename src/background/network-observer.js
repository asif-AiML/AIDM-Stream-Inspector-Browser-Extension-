function logObservedRequest(details) {
  const targetTabId = globalThis.getCurrentTargetTabId();

  if (details.tabId !== targetTabId) {
    return;
  }

  console.log(`[AIDM Target][tab ${details.tabId}] ${details.method} ${details.url}`);
}

chrome.webRequest.onBeforeRequest.addListener(logObservedRequest, {
  urls: ["http://*/*", "https://*/*"]
});
