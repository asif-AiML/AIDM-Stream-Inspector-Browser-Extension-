function logObservedRequest(details) {
  console.log(`[AIDM Network] ${details.method} ${details.url}`);
}

chrome.webRequest.onBeforeRequest.addListener(logObservedRequest, {
  urls: ["http://*/*", "https://*/*"]
});
