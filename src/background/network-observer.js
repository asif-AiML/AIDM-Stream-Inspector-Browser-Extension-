function detectTargetTabCandidate(details) {
  const targetTabId = globalThis.getCurrentTargetTabId();

  if (details.tabId !== targetTabId) {
    return;
  }

  const candidateType = globalThis.detectObviousMediaCandidate(details.url);

  if (candidateType === null) {
    return;
  }

  const requestHeaders = Array.isArray(details.requestHeaders)
    ? details.requestHeaders
    : [];

  console.log(
    `[AIDM Candidate][${candidateType}]\n`
    + `URL: ${details.url}\n`
    + `User-Agent: ${getHeaderValue(requestHeaders, "user-agent")}\n`
    + `Referer: ${getHeaderValue(requestHeaders, "referer")}\n`
    + `Origin: ${getHeaderValue(requestHeaders, "origin")}\n`
    + `Cookie: ${getHeaderPresence(requestHeaders, "cookie")}\n`
    + `Authorization: ${getHeaderPresence(requestHeaders, "authorization")}\n`
    + `Range: ${getHeaderValue(requestHeaders, "range")}`
  );
}

function findHeader(requestHeaders, headerName) {
  return requestHeaders.find((header) => header.name.toLowerCase() === headerName);
}

function getHeaderValue(requestHeaders, headerName) {
  const header = findHeader(requestHeaders, headerName);

  if (!header || typeof header.value !== "string") {
    return "not observed";
  }

  return header.value;
}

function getHeaderPresence(requestHeaders, headerName) {
  return findHeader(requestHeaders, headerName) ? "present" : "not observed";
}

function startNetworkObserver() {
  const requestFilter = {
    urls: ["http://*/*", "https://*/*"]
  };

  try {
    chrome.webRequest.onSendHeaders.addListener(
      detectTargetTabCandidate,
      requestFilter,
      ["requestHeaders", "extraHeaders"]
    );
  } catch (error) {
    console.warn(
      "[AIDM] extraHeaders is unavailable; using standard request-header exposure."
    );
    chrome.webRequest.onSendHeaders.addListener(
      detectTargetTabCandidate,
      requestFilter,
      ["requestHeaders"]
    );
  }
}

globalThis.startNetworkObserver = startNetworkObserver;
