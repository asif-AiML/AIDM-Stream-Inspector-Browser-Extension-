// Context is needed before an opaque request reveals its MIME. Keep only the
// M5 display fields (never raw Cookie/Authorization) until its response arrives.
const pendingSubtitleRequestContexts = new Map();
const maxPendingSubtitleRequestContexts = 512;

function rememberSubtitleRequestContext(details, candidateEvidence) {
  if (details.tabId < 0 || details.tabId !== globalThis.getCurrentTargetTabId()) {
    return;
  }

  const previous = pendingSubtitleRequestContexts.get(details.requestId);
  if (previous && !matchesSubtitleRequest(previous, details)) {
    finishSubtitleRequest(previous, "request identity changed before response");
  }
  const subtitle = candidateEvidence?.type === globalThis.AIDM_STREAM_TYPES.SUBTITLE
    ? candidateEvidence : null;
  pendingSubtitleRequestContexts.delete(details.requestId);
  pendingSubtitleRequestContexts.set(details.requestId, {
    requestId: details.requestId,
    parentFrameId: details.parentFrameId,
    type: details.type,
    subtitle,
    classification: subtitle ? globalThis.classifySubtitleRole(subtitle) : null,
    url: details.url,
    tabId: details.tabId,
    frameId: details.frameId,
    context: globalThis.formatRequestContext(details.requestHeaders)
  });

  // Bound memory even if requests hang or a terminal event is not exposed.
  if (pendingSubtitleRequestContexts.size > maxPendingSubtitleRequestContexts) {
    const oldestRequestId = pendingSubtitleRequestContexts.keys().next().value;
    const oldest = pendingSubtitleRequestContexts.get(oldestRequestId);
    finishSubtitleRequest(oldest, "pending limit reached; response not yet observed");
  }
}

function matchesSubtitleRequest(record, details) {
  // Redirect hops share requestId; never borrow another URL/frame's context.
  return record && record.requestId === details.requestId
    && record.url === details.url && record.tabId === details.tabId
    && record.frameId === details.frameId;
}

function finishSubtitleRequest(details, observation) {
  const record = pendingSubtitleRequestContexts.get(details.requestId);
  pendingSubtitleRequestContexts.delete(details.requestId);
  if (matchesSubtitleRequest(record, details) && record.subtitle) {
    logSubtitleEvidence(details, record, observation);
  }
}

function classifySubtitleMimeEvidence(responseHeaders) {
  if (!Array.isArray(responseHeaders)) {
    return null;
  }

  const contentTypes = responseHeaders.filter(
    (header) => header.name.toLowerCase() === "content-type"
  );

  // Multiple Content-Type fields are ambiguous; do not choose one as truth.
  if (contentTypes.length !== 1 || typeof contentTypes[0].value !== "string") {
    return null;
  }

  const contentType = contentTypes[0].value;
  const mimeType = contentType.split(";", 1)[0].trim().toLowerCase();

  if (!["text/vtt", "application/x-subrip", "application/ttml+xml"].includes(mimeType)) {
    return null;
  }

  return {
    code: "timed-text-mime",
    strength: "strong",
    contentType,
    mimeType,
    reason: "Response declares a subtitle/timed-text MIME; contents and subtitle role unverified"
  };
}

function observeSubtitleResponseEvidence(details) {
  const record = pendingSubtitleRequestContexts.get(details.requestId);
  pendingSubtitleRequestContexts.delete(details.requestId);
  logSubtitleEvidence(
    details, matchesSubtitleRequest(record, details) ? record : null, "response started"
  );
}

function logSubtitleEvidence(details, record, observation) {
  if (details.tabId < 0 || details.tabId !== globalThis.getCurrentTargetTabId()) {
    return;
  }

  const evidence = classifySubtitleMimeEvidence(details.responseHeaders);
  // A response can outlive retained state. Recover URL evidence without guessing
  // request headers, preserving the detector's existing media-first precedence.
  const candidate = record ? record.subtitle
    : (globalThis.detectObviousMediaCandidateEvidence(details.url) ? null
      : globalThis.detectObviousSubtitleCandidateEvidence(details.url));
  if (!candidate && !evidence) {
    return;
  }

  let heading = "[AIDM Subtitle Evidence][MIME]";
  let urlEvidence = "";
  if (candidate) {
    const classification = record?.classification || globalThis.classifySubtitleRole(candidate);
    const roles = globalThis.AIDM_SUBTITLE_ROLES;
    const roleLabels = {
      [roles.SUBTITLE]: "likely subtitle",
      [roles.THUMBNAIL]: "likely thumbnail/storyboard",
      [roles.UNKNOWN]: "unknown timed-text"
    };
    const category = classification.role === roles.SUBTITLE ? "Subtitle" : "Timed Text";
    heading = `[AIDM ${category}][${candidate.format}]`;
    urlEvidence = `URL evidence: .${candidate.format.toLowerCase()} extension (${candidate.source})\n`
      + `Role: ${roleLabels[classification.role]}\n`
      + `Role path source: ${candidate.source}\n`
      + `Role evidence:\n${classification.evidence.map((item) =>
        `  [${item.code}] ${item.reason}`
      ).join("\n")}\n`;
  }

  // Show even generic/conflicting Content-Type values without treating them as
  // subtitle evidence. Do not retain or print other response headers.
  const contentTypes = (details.responseHeaders || [])
    .filter((header) => header.name.toLowerCase() === "content-type")
    .map((header) => typeof header.value === "string" ? header.value : "not observed");
  const mimeOutput = evidence
    ? `Evidence: [${evidence.code}] ${evidence.reason}\n`
      + `Strength: ${evidence.strength} (MIME declaration only)\n`
      + `MIME: ${evidence.mimeType}\n`
    : "MIME evidence: no unambiguous supported timed-text declaration observed\n";

  console.log(
    `${heading}\n`
    + `URL: ${details.url}\n`
    + urlEvidence
    + mimeOutput
    + `Content-Type: ${contentTypes.length ? contentTypes.join(" | ") : "not observed"}\n`
    + `Status: ${details.statusCode ?? "not observed"}\n`
    + `Observation: ${observation}\n`
    + `Request ID: ${details.requestId}\n`
    + `Tab ID: ${details.tabId}\n`
    + `Frame ID: ${details.frameId ?? "not observed"}\n`
    + `Parent frame ID: ${details.parentFrameId ?? record?.parentFrameId ?? "not observed"}\n`
    + `Request type: ${details.type ?? record?.type ?? "not observed"}\n`
    + (candidate ? "" : "Usable subtitle URL: not established\n")
    + `Request context: ${record ? "matched request" : "unavailable (not retained or not observed)"}\n`
    + (record ? record.context : globalThis.formatRequestContext([]))
  );
}

function startSubtitleEvidenceObserver(requestFilter) {
  // Informational event: response headers/status only, no body access or changes.
  chrome.webRequest.onResponseStarted.addListener(
    observeSubtitleResponseEvidence, requestFilter, ["responseHeaders"]
  );
  chrome.webRequest.onBeforeRedirect.addListener(
    (details) => finishSubtitleRequest(details, "redirect before response started"),
    requestFilter, ["responseHeaders"]
  );
  chrome.webRequest.onCompleted.addListener(
    (details) => finishSubtitleRequest(details, "completed without response-start observation"),
    requestFilter, ["responseHeaders"]
  );
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => finishSubtitleRequest(details, "failed before response started"), requestFilter
  );
}

globalThis.rememberSubtitleRequestContext = rememberSubtitleRequestContext;
globalThis.startSubtitleEvidenceObserver = startSubtitleEvidenceObserver;
