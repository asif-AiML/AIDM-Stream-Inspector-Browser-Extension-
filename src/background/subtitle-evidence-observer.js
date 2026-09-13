// Context is needed before an opaque request reveals its MIME. Keep only the
// safe M5 fields (never raw Cookie/Authorization), plus pending MIME evidence.
const pendingSubtitleRequestContexts = new Map();
const maxPendingSubtitleRequestContexts = 512;

// Resource identity is separate from the pending browser-request identity above.
const subtitleCandidates = new Map();
const maxSubtitleCandidates = 128;
const maxSubtitleObservations = 64;
let nextSubtitleCandidateId = 1;

function resetSubtitleCandidates() {
  subtitleCandidates.clear();
}

function mergeSubtitleEvidence(existing, incoming) {
  for (const item of incoming) {
    // Charset/case variations are retained in observation details, not as an
    // unbounded set of equivalent MIME declarations in the evidence summary.
    const { contentType, ...summary } = item;
    if (!existing.some((entry) => JSON.stringify(entry) === JSON.stringify(summary))) {
      existing.push(summary);
    }
  }
}

function rememberSubtitleCandidate(candidate) {
  // JSON tuple encoding avoids delimiter collisions without normalizing URLs.
  const key = JSON.stringify([candidate.tabId, candidate.url, candidate.format]);
  let resource = subtitleCandidates.get(key);
  if (!resource) {
    if (subtitleCandidates.size >= maxSubtitleCandidates) {
      subtitleCandidates.delete(subtitleCandidates.keys().next().value);
      console.log("[AIDM Subtitle] Resource limit reached; oldest candidate released from dedupe state.");
    }
    resource = {
      id: nextSubtitleCandidateId++,
      tabId: candidate.tabId,
      url: candidate.url,
      format: candidate.format,
      role: candidate.role,
      roleEvidence: [],
      evidence: [],
      discoveries: [],
      observationCount: 0,
      observations: [],
      omittedObservationCount: 0,
      firstStatus: candidate.response.status,
      latestStatus: candidate.response.status
    };
    subtitleCandidates.set(key, resource);
  }

  resource.observationCount++;
  resource.latestStatus = candidate.response.status;
  resource.observations.push(candidate);
  if (resource.observations.length > maxSubtitleObservations) {
    // Keep the first and most recent observations, with explicit history loss.
    resource.observations.splice(1, 1);
    resource.omittedObservationCount++;
  }
  mergeSubtitleEvidence(resource.evidence, candidate.evidence);
  mergeSubtitleEvidence(resource.roleEvidence, candidate.roleEvidence);
  if (!resource.discoveries.includes(candidate.discovery)) {
    resource.discoveries.push(candidate.discovery);
  }

  // Preserve M7.1's preview precedence; repetition never establishes a role.
  const roles = globalThis.AIDM_SUBTITLE_ROLES;
  if (candidate.role === roles.THUMBNAIL || resource.role === roles.UNKNOWN) {
    resource.role = candidate.role;
  }
  return resource;
}

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
    context: globalThis.extractRequestContext(details.requestHeaders)
  });

  // Bound memory even if requests hang or a terminal event is not exposed.
  if (pendingSubtitleRequestContexts.size > maxPendingSubtitleRequestContexts) {
    const oldestRequestId = pendingSubtitleRequestContexts.keys().next().value;
    const oldest = pendingSubtitleRequestContexts.get(oldestRequestId);
    finishSubtitleRequest(oldest, "pending limit reached; completion not observed");
  }
}

function matchesSubtitleRequest(record, details) {
  // Redirect hops share requestId; never borrow another URL/frame's context.
  return record && record.requestId === details.requestId
    && record.url === details.url && record.tabId === details.tabId
    && record.frameId === details.frameId;
}

function finishSubtitleRequest(details, observation, completed = false) {
  const record = pendingSubtitleRequestContexts.get(details.requestId);
  pendingSubtitleRequestContexts.delete(details.requestId);
  if (matchesSubtitleRequest(record, details)) {
    // A late error has no response headers; retain only the observed Content-Type
    // and status, never the entire response header array (including Set-Cookie).
    const responseDetails = {
      ...details,
      responseHeaders: details.responseHeaders ?? record.mimeResponse?.responseHeaders,
      statusCode: details.statusCode ?? record.mimeResponse?.statusCode
    };
    logSubtitleEvidence(responseDetails, record, observation, completed);
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

  const formats = globalThis.AIDM_SUBTITLE_FORMATS;
  const mimeFormats = {
    "text/vtt": formats.VTT,
    "application/x-subrip": formats.SRT,
    "application/ttml+xml": formats.TTML
  };
  const format = Object.hasOwn(mimeFormats, mimeType) ? mimeFormats[mimeType] : null;

  if (!format) {
    return null;
  }

  return {
    code: "timed-text-mime",
    strength: "strong",
    contentType,
    mimeType,
    format,
    reason: "Response declares a subtitle/timed-text MIME; contents and subtitle role unverified"
  };
}

function observeSubtitleResponseEvidence(details) {
  const record = pendingSubtitleRequestContexts.get(details.requestId);
  const matchedRecord = matchesSubtitleRequest(record, details) ? record : null;
  const evidence = classifySubtitleMimeEvidence(details.responseHeaders);
  if (matchedRecord && !matchedRecord.subtitle && evidence
      && details.tabId === globalThis.getCurrentTargetTabId()
      && details.statusCode >= 200 && details.statusCode < 300) {
    // First-byte success is not completion: a later network failure must not
    // create a promoted candidate. Keep this request in the existing bounded map.
    matchedRecord.mimeResponse = {
      statusCode: details.statusCode,
      responseHeaders: [{ name: "Content-Type", value: evidence.contentType }]
    };
    return;
  }
  pendingSubtitleRequestContexts.delete(details.requestId);
  logSubtitleEvidence(details, matchedRecord, "response started");
}

function buildSubtitleCandidate(details, record, urlEvidence, mimeEvidence, completed) {
  const canPromote = completed && details.statusCode >= 200 && details.statusCode < 300
    && record && matchesSubtitleRequest(record, details) && mimeEvidence;
  if (!urlEvidence && !canPromote) {
    return null;
  }

  // Parse only for role evidence; never replace the captured URL with .href or
  // an embedded upstream URL. The network filter already limits this to HTTP(S).
  const detection = urlEvidence || {
    type: globalThis.AIDM_STREAM_TYPES.SUBTITLE,
    format: mimeEvidence.format,
    pathname: new URL(details.url).pathname,
    source: "response MIME"
  };
  const classification = record?.classification || globalThis.classifySubtitleRole(detection);
  return {
    ...detection,
    format: mimeEvidence?.format ?? detection.format,
    url: details.url,
    discovery: urlEvidence ? "url" : "mime-response",
    mime: mimeEvidence?.mimeType ?? null,
    role: classification.role,
    roleEvidence: classification.evidence,
    evidence: [
      ...(urlEvidence ? [{ code: "url-extension", ...urlEvidence }] : []),
      ...(mimeEvidence ? [mimeEvidence] : [])
    ],
    requestContext: record?.context ?? null,
    requestId: details.requestId,
    tabId: details.tabId,
    frameId: details.frameId,
    parentFrameId: details.parentFrameId ?? record?.parentFrameId,
    requestType: details.type ?? record?.type,
    response: {
      status: details.statusCode ?? null,
      contentTypes: getSubtitleContentTypes(details.responseHeaders),
      completed
    }
  };
}

function getSubtitleContentTypes(responseHeaders) {
  return (responseHeaders || [])
    .filter((header) => header.name.toLowerCase() === "content-type")
    .map((header) => typeof header.value === "string" ? header.value : "not observed");
}

function logSubtitleEvidence(details, record, observation, completed = false) {
  if (details.tabId < 0 || details.tabId !== globalThis.getCurrentTargetTabId()) {
    return;
  }

  const evidence = classifySubtitleMimeEvidence(details.responseHeaders);
  // A response can outlive retained state. Recover URL evidence without guessing
  // request headers, preserving the detector's existing media-first precedence.
  const urlCandidate = record ? record.subtitle
    : (globalThis.detectObviousMediaCandidateEvidence(details.url) ? null
      : globalThis.detectObviousSubtitleCandidateEvidence(details.url));
  const candidate = buildSubtitleCandidate(details, record, urlCandidate, evidence, completed);
  if (!candidate && !evidence) {
    return;
  }

  const resource = candidate ? rememberSubtitleCandidate(candidate) : null;
  let heading = "[AIDM Subtitle Evidence][MIME]";
  let urlEvidence = "";
  if (candidate) {
    const classification = { role: resource.role, evidence: resource.roleEvidence };
    const roles = globalThis.AIDM_SUBTITLE_ROLES;
    const roleLabels = {
      [roles.SUBTITLE]: "likely subtitle",
      [roles.THUMBNAIL]: "likely thumbnail/storyboard",
      [roles.UNKNOWN]: "unknown timed-text"
    };
    const category = classification.role === roles.SUBTITLE ? "Subtitle" : "Timed Text";
    heading = `[AIDM ${category}][${candidate.format}]`;
    if (resource.observationCount > 1) {
      console.log(
        `${heading} duplicate observation merged | Candidate ID: ${resource.id}`
        + ` | Observations: ${resource.observationCount} | Request ID: ${candidate.requestId}`
        + ` | Role: ${roleLabels[resource.role]} | Status: ${candidate.response.status ?? "not observed"}`
        + ` | Retained observations: ${resource.observations.length}`
        + ` | Omitted older observations: ${resource.omittedObservationCount}`
      );
      return;
    }
    urlEvidence = `Discovery: ${candidate.discovery === "mime-response" ? "response MIME" : "URL evidence"}\n`
      + (urlCandidate
        ? `URL evidence: .${urlCandidate.format.toLowerCase()} extension (${urlCandidate.source})\n` : "")
      + `Role: ${roleLabels[classification.role]}\n`
      + `Role path source: ${candidate.discovery === "mime-response" ? "request pathname" : candidate.source}\n`
      + `Role evidence:\n${classification.evidence.map((item) =>
        `  [${item.code}] ${item.reason}`
      ).join("\n")}\n`;
  }

  // Show even generic/conflicting Content-Type values without treating them as
  // subtitle evidence. Do not retain or print other response headers.
  const contentTypes = candidate?.response.contentTypes
    ?? getSubtitleContentTypes(details.responseHeaders);
  const mimeOutput = evidence
    ? `Evidence: [${evidence.code}] ${evidence.reason}\n`
      + `Strength: ${evidence.strength} (MIME declaration only)\n`
      + `MIME: ${evidence.mimeType}\n`
    : "MIME evidence: no unambiguous supported timed-text declaration observed\n";

  console.log(
    `${heading}\n`
    + (resource ? `Candidate ID: ${resource.id}\nObservations: ${resource.observationCount}\n` : "")
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
    + (candidate ? "" : "Promotion: not established (requires completed 2xx response and matched request context)\n")
    + `Request context: ${record ? "matched request" : "unavailable (not retained or not observed)"}\n`
    + (record ? globalThis.formatObservedRequestContext(record.context)
      : globalThis.formatRequestContext([]))
  );
}

function startSubtitleEvidenceObserver(requestFilter) {
  // Informational event: response headers/status only, no body access or changes.
  chrome.webRequest.onResponseStarted.addListener(
    observeSubtitleResponseEvidence, requestFilter, ["responseHeaders"]
  );
  chrome.webRequest.onBeforeRedirect.addListener(
    (details) => finishSubtitleRequest(details, "request redirected"),
    requestFilter, ["responseHeaders"]
  );
  chrome.webRequest.onCompleted.addListener(
    (details) => finishSubtitleRequest(details, "request completed", true),
    requestFilter, ["responseHeaders"]
  );
  chrome.webRequest.onErrorOccurred.addListener(
    (details) => finishSubtitleRequest(details, "request failed"), requestFilter
  );
}

globalThis.resetSubtitleCandidates = resetSubtitleCandidates;
globalThis.rememberSubtitleRequestContext = rememberSubtitleRequestContext;
globalThis.startSubtitleEvidenceObserver = startSubtitleEvidenceObserver;
