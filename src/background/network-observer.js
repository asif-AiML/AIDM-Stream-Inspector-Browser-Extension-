function logObservedRequest(details) {
  const tabContext = details.tabId >= 0
    ? `tab ${details.tabId}`
    : `no tab (${details.tabId})`;

  console.log(`[AIDM Network][${tabContext}] ${details.method} ${details.url}`);
}

chrome.webRequest.onBeforeRequest.addListener(logObservedRequest, {
  urls: ["http://*/*", "https://*/*"]
});
