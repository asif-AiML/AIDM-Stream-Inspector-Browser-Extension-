function detectTargetTabCandidate(details) {
  const targetTabId = globalThis.getCurrentTargetTabId();

  if (details.tabId !== targetTabId) {
    return;
  }

  const candidateType = globalThis.detectObviousMediaCandidate(details.url);

  if (candidateType === null) {
    return;
  }

  console.log(`[AIDM Candidate][${candidateType}] ${details.url}`);
}

function startNetworkObserver() {
  chrome.webRequest.onBeforeRequest.addListener(detectTargetTabCandidate, {
    urls: ["http://*/*", "https://*/*"]
  });
}

globalThis.startNetworkObserver = startNetworkObserver;
