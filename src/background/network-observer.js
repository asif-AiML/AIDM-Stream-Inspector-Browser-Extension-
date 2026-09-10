function detectTargetTabCandidate(details) {
  const targetTabId = globalThis.getCurrentTargetTabId();

  if (details.tabId !== targetTabId) {
    return;
  }

  const candidateEvidence = globalThis.detectObviousMediaCandidateEvidence(details.url);

  if (candidateEvidence === null) {
    return;
  }

  const ranking = globalThis.rankMediaCandidate(candidateEvidence);
  const requestHeaders = Array.isArray(details.requestHeaders)
    ? details.requestHeaders
    : [];

  console.log(
    `[AIDM Candidate][${candidateEvidence.type}]\n`
    + `URL: ${details.url}\n`
    + `Priority: ${getPriorityLabel(ranking.score)} (${ranking.score})\n`
    + `Ranking path source: ${candidateEvidence.source}\n`
    + `Ranking evidence:\n${ranking.evidence.map((item) =>
      `  ${item.weight >= 0 ? "+" : ""}${item.weight} [${item.code}] ${item.reason}`
    ).join("\n")}\n`
    + `User-Agent: ${getHeaderValue(requestHeaders, "user-agent")}\n`
    + `Referer: ${getHeaderValue(requestHeaders, "referer")}\n`
    + `Origin: ${getHeaderValue(requestHeaders, "origin")}\n`
    + `Cookie: ${getHeaderPresence(requestHeaders, "cookie")}\n`
    + `Authorization: ${getHeaderPresence(requestHeaders, "authorization")}\n`
    + `Range: ${getHeaderValue(requestHeaders, "range")}`
  );
}

function getPriorityLabel(score) {
  // Presentation bands for current M6 scores, not confirmed manifest roles.
  if (score >= 70) {
    return "HIGH";
  }

  if (score >= 40) {
    return "MEDIUM";
  }

  return "LOW";
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
