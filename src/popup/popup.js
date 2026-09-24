let currentPlaybackSnapshot = null;
let selectionRequestVersion = 0;
let selectionPending = false;
let copyRequestVersion = 0;
let copyFeedbackTimeout;

function getSelectedMediaCandidate(snapshot) {
  const id = snapshot?.media?.selectedCandidateId;
  if (snapshot?.status?.playback !== "detected" || !Number.isInteger(id)
      || !Array.isArray(snapshot.media.candidates)) return null;
  const candidate = snapshot.media.candidates.find((item) => item?.id === id);
  return typeof candidate?.url === "string" && candidate.url.trim() ? candidate : null;
}

function shellQuote(value) {
  // Literal line breaks cannot round-trip through both a single-line POSIX
  // fragment and shlex.split. Refuse unsafe controls instead of rewriting data.
  if (typeof value !== "string" || /[\u0000-\u001f\u007f\u2028\u2029]/.test(value)) {
    throw new Error("Value cannot be represented in the clipboard fragment");
  }
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

function buildClipboardArguments(snapshot) {
  const media = getSelectedMediaCandidate(snapshot);
  if (!media) throw new Error("Selected media unavailable");
  const args = [];
  const context = media.requestContext;
  if (headerPresence(context?.userAgent) === "Captured") {
    args.push("--user-agent", shellQuote(context.userAgent));
  }
  if (headerPresence(context?.referer) === "Captured") {
    args.push("--referer", shellQuote(context.referer));
  }
  const subtitles = snapshot.subtitles?.candidates ?? [];
  const selectedIds = new Set(snapshot.subtitles?.selectedCandidateIds ?? []);
  for (const subtitle of subtitles) {
    if (subtitle.role !== "SUBTITLE" || !selectedIds.has(subtitle.id)) continue;
    if (typeof subtitle.url !== "string" || !subtitle.url.trim()) {
      throw new Error("Selected subtitle URL unavailable");
    }
    args.push("--subtitle", shellQuote(subtitle.url));
  }
  const title = snapshot.title?.title;
  if (typeof title === "string" && title.trim()) args.push("--title", shellQuote(title));
  args.push(shellQuote(media.url));
  return args.join(" ");
}

function resetCopyAction() {
  ++copyRequestVersion; // Late clipboard results must not label a newer selection as copied.
  clearTimeout(copyFeedbackTimeout);
  const button = document.getElementById("copy-playback");
  button.hidden = !getSelectedMediaCandidate(currentPlaybackSnapshot);
  button.disabled = button.hidden || selectionPending;
  button.textContent = "Copy for AiDM";
  document.getElementById("copy-error").hidden = true;
}

async function copyPlayback() {
  const button = document.getElementById("copy-playback");
  if (button.disabled || selectionPending || !getSelectedMediaCandidate(currentPlaybackSnapshot)) return;
  resetCopyAction();
  const version = copyRequestVersion;
  const notice = document.getElementById("copy-error");
  let fragment;
  try {
    fragment = buildClipboardArguments(currentPlaybackSnapshot);
  } catch {
    notice.textContent = "Cannot copy this capture: a value is missing or contains unsupported control characters.";
    notice.hidden = false;
    return;
  }
  button.disabled = true;
  try {
    // Start the write during the click's user activation; do not await messaging.
    await navigator.clipboard.writeText(fragment);
    if (version !== copyRequestVersion) return;
    button.textContent = "Copied";
    copyFeedbackTimeout = setTimeout(() => {
      button.textContent = "Copy for AiDM";
    }, 2000);
  } catch {
    if (version !== copyRequestVersion) return;
    notice.textContent = "Could not copy. Keep the popup open and try again.";
    notice.hidden = false;
  } finally {
    if (version === copyRequestVersion) button.disabled = false;
  }
}

function changeSelection(type, candidateId, selected) {
  const snapshot = currentPlaybackSnapshot;
  if (!snapshot) return;
  const version = ++selectionRequestVersion;
  selectionPending = true;
  resetCopyAction();
  chrome.runtime.sendMessage({ type, candidateId, selected,
    playbackId: snapshot.playbackId, tabId: snapshot.tabId }, (response) => {
    const error = chrome.runtime.lastError;
    if (version !== selectionRequestVersion) return;
    selectionPending = false;
    const open = document.getElementById("other-media").open;
    const focusedId = document.activeElement?.id;
    const next = !error && response?.snapshot ? response.snapshot : currentPlaybackSnapshot;
    const samePlayback = next.playbackId === currentPlaybackSnapshot.playbackId;
    if (!renderPlaybackState(next)) return;
    if (samePlayback) {
      document.getElementById("other-media").open = open;
      if (focusedId) document.getElementById(focusedId)?.focus();
    }
    const notice = document.getElementById("selection-error");
    notice.hidden = !error && response?.accepted === true;
    notice.textContent = notice.hidden ? "" : "Selection could not be saved. Reopen the popup to check the current capture.";
  });
}


function requestPlaybackState() {
  return new Promise((resolve, reject) => {
    // Bound a stalled initialization/message channel; no retry or visual delay.
    const deadline = setTimeout(() => reject(new Error("Playback request timed out")), 15000);
    try {
      chrome.runtime.sendMessage({ type: "AIDM_GET_PLAYBACK_STATE" }, (snapshot) => {
        clearTimeout(deadline);
        if (chrome.runtime.lastError || !snapshot) {
          reject(new Error("Playback state response unavailable"));
          return;
        }
        resolve(snapshot);
      });
    } catch {
      clearTimeout(deadline);
      reject(new Error("Playback state request failed"));
    }
  });
}

function showPopupMessage(summary, help = "", loading = false) {
  currentPlaybackSnapshot = null;
  selectionPending = false;
  resetCopyAction();
  ++selectionRequestVersion; // Ignore late selection replies after leaving playback UI.
  document.getElementById("playback-details").hidden = true;
  document.getElementById("selection-error").hidden = true;
  for (const id of ["best-media-row", "other-media-list", "subtitle-list"]) {
    document.getElementById(id).replaceChildren();
  }
  document.getElementById("state-message").hidden = false;
  document.getElementById("state-summary").textContent = summary;
  document.getElementById("state-help").textContent = help;
  document.getElementById("state-help").hidden = !help;
  document.getElementById("popup-content").setAttribute("aria-busy", String(loading));
}

function renderLoading() {
  showPopupMessage("Checking this tab…", "", true);
}

function renderEmpty() {
  showPopupMessage("No playback detected on this tab yet.",
    "Start the video, then reopen the extension.");
}

function renderUnavailable() {
  showPopupMessage("No active browser tab available.");
}

function renderError() {
  showPopupMessage("Unable to read playback state.", "Try reopening the extension.");
}

function isUsableSnapshot(snapshot) {
  const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
  if (!object(snapshot) || !object(snapshot.status)) return false;
  const status = snapshot.status.playback;
  if (status === "not-detected" || status === "target-unavailable") return true;
  return status === "detected" && object(snapshot.media) && object(snapshot.subtitles)
    && Array.isArray(snapshot.media.candidates) && snapshot.media.candidates.every(object)
    && Array.isArray(snapshot.subtitles.candidates) && snapshot.subtitles.candidates.every(object)
    && (snapshot.subtitles.selectedCandidateIds == null
      || Array.isArray(snapshot.subtitles.selectedCandidateIds));
}

function headerPresence(value) {
  return typeof value === "string" && value.trim() && value.trim() !== "not observed"
    ? "Captured" : "Not observed";
}

function renderSessionContext(context) {
  const hasContext = context !== null && typeof context === "object" && !Array.isArray(context);
  document.getElementById("session-context").hidden = !hasContext;
  document.getElementById("session-unavailable").hidden = hasContext;
  document.getElementById("session-user-agent").textContent = headerPresence(context?.userAgent);
  document.getElementById("session-referer").textContent = headerPresence(context?.referer);
  // Origin remains diagnostic-only; it is excluded from the future beta clipboard contract.
  document.getElementById("session-origin").textContent = headerPresence(context?.origin);
  document.getElementById("session-cookies").textContent =
    context?.cookie === "present" ? "Observed" : "Not observed";
}

function formatCaptureAge(capturedAt) {
  if (!Number.isFinite(capturedAt) || capturedAt <= 0) return "";
  const minutes = Math.floor(Math.max(0, Date.now() - capturedAt) / 60000);
  if (minutes < 1) return "Captured just now";
  if (minutes < 60) return `Captured ${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return `Captured ${hours} ${hours === 1 ? "hr" : "hrs"} ago`;
}

function mediaTypeLabel(candidate) {
  const labels = { HLS: "HLS", DASH: "DASH Manifest", VIDEO: "Direct Video", AUDIO: "Audio" };
  return candidate && Object.hasOwn(labels, candidate.type) ? labels[candidate.type] : "Unknown media";
}

function mediaRoleLabel(candidate) {
  const type = mediaTypeLabel(candidate);
  if (candidate?.type !== "HLS") return type;
  const evidence = Array.isArray(candidate.ranking?.evidence) ? candidate.ranking.evidence : [];
  const labels = {
    "master-like-name": "HLS · likely master",
    "playlist-like-path": "HLS · possible parent playlist",
    "video-rendition-like-name": "HLS · likely video rendition",
    "audio-rendition-like-name": "HLS · likely audio rendition"
  };
  // These are engine evidence labels, not new filename/manifest analysis.
  const role = evidence.find((item) => item && Object.hasOwn(labels, item.code));
  return role ? labels[role.code] : type;
}

function createMediaRow(candidate, observationNumber, selectedId) {
  const row = document.createElement("div");
  row.className = "media-row";
  const name = document.createElement("label");
  name.className = "media-choice";
  const radio = document.createElement("input");
  radio.type = "radio";
  radio.name = "media-candidate";
  radio.id = `media-choice-${candidate?.id}`;
  radio.checked = candidate?.id === selectedId;
  radio.disabled = !Number.isInteger(candidate?.id);
  radio.addEventListener("change", () => {
    if (radio.checked) changeSelection("AIDM_SET_SELECTED_MEDIA", candidate.id);
  });
  const description = document.createElement("span");
  description.className = "media-name";
  description.textContent = mediaRoleLabel(candidate);
  name.append(radio, description);
  const priority = document.createElement("span");
  priority.className = "media-priority";
  priority.textContent = ["HIGH", "MEDIUM", "LOW"].includes(candidate?.ranking?.priority)
    ? candidate.ranking.priority : "Priority unavailable";
  const detail = document.createElement("p");
  detail.className = "secondary";
  const score = candidate?.ranking?.score;
  detail.textContent = `Observation ${observationNumber}`
    + (Number.isFinite(score) ? ` · Score ${score}` : "");
  row.append(name, priority, detail);
  return row;
}

function renderMediaCandidates(media, candidates, best) {
  const bestContainer = document.getElementById("best-media");
  const bestRow = document.getElementById("best-media-row");
  bestRow.replaceChildren();
  bestContainer.hidden = !best;
  document.getElementById("media-unavailable").hidden = !!best;
  if (best) bestRow.append(createMediaRow(best, candidates.indexOf(best) + 1, media?.selectedCandidateId));

  const alternatives = candidates.map((candidate, index) => ({ candidate, index }))
    .filter((item) => item.candidate !== best);
  // Sort a separate presentation list by supplied scores; keep ties in observed
  // order and place missing scores last. Never choose a substitute best candidate.
  alternatives.sort((a, b) => {
    const aScore = Number.isFinite(a.candidate?.ranking?.score) ? a.candidate.ranking.score : -Infinity;
    const bScore = Number.isFinite(b.candidate?.ranking?.score) ? b.candidate.ranking.score : -Infinity;
    return aScore === bScore ? a.index - b.index : aScore > bScore ? -1 : 1;
  });
  const details = document.getElementById("other-media");
  details.hidden = alternatives.length === 0;
  details.open = false;
  document.getElementById("other-media-summary").textContent = `Other detected streams (${alternatives.length})`;
  const list = document.getElementById("other-media-list");
  list.replaceChildren();
  for (const { candidate, index } of alternatives) {
    const item = document.createElement("li");
    item.append(createMediaRow(candidate, index + 1, media?.selectedCandidateId));
    list.append(item);
  }
  const omitted = media?.omittedCandidateCount;
  const note = document.getElementById("media-omitted");
  note.hidden = !Number.isInteger(omitted) || omitted <= 0;
  note.textContent = note.hidden ? "" : `${omitted} older ${omitted === 1 ? "observation" : "observations"} omitted`;
}

function renderSubtitles(subtitleState) {
  const candidates = Array.isArray(subtitleState?.candidates) ? subtitleState.candidates : [];
  // The logical resource's engine-assigned role is the only presentation gate.
  const subtitles = candidates.filter((candidate) => candidate?.role === "SUBTITLE");
  document.getElementById("subtitle-heading").textContent = subtitles.length > 1
    ? `Subtitles (${subtitles.length})` : "Subtitles";
  document.getElementById("subtitle-empty").hidden = subtitles.length > 0;
  const list = document.getElementById("subtitle-list");
  list.replaceChildren();
  list.hidden = subtitles.length === 0;
  subtitles.forEach((candidate, index) => {
    const row = document.createElement("li");
    const label = document.createElement("label");
    label.className = "subtitle-choice";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `subtitle-choice-${candidate.id}`;
    checkbox.checked = subtitleState.selectedCandidateIds?.includes(candidate.id) === true;
    checkbox.disabled = !Number.isInteger(candidate.id);
    checkbox.addEventListener("change", () =>
      changeSelection("AIDM_SET_SELECTED_SUBTITLE", candidate.id, checkbox.checked));
    const name = document.createElement("span");
    // Language/label metadata is not currently supplied by the engine.
    name.textContent = `Subtitle ${index + 1}`;
    label.append(checkbox, name);
    const format = document.createElement("span");
    format.className = "subtitle-format";
    format.textContent = ["VTT", "SRT", "ASS", "SSA", "TTML"].includes(candidate.format)
      ? candidate.format : "Unknown format";
    row.append(label, format);
    list.append(row);
  });
}

function renderPlaybackState(snapshot) {
  try {
    if (!isUsableSnapshot(snapshot)) { renderError(); return false; }
    if (snapshot.status.playback === "not-detected") { renderEmpty(); return false; }
    if (snapshot.status.playback === "target-unavailable") { renderUnavailable(); return false; }
    renderDetectedPlayback(snapshot);
    return true;
  } catch {
    renderError();
    return false;
  }
}

function renderDetectedPlayback(snapshot) {
  currentPlaybackSnapshot = snapshot;
  resetCopyAction();
  document.getElementById("selection-error").hidden = true;
  const candidates = Array.isArray(snapshot.media?.candidates) ? snapshot.media.candidates : [];
  const bestId = snapshot.media?.bestCandidateId;
  // Resolve the engine's choice by identity; never rank or choose a fallback here.
  const best = bestId == null ? null : candidates.find((candidate) => candidate?.id === bestId);
  const source = best ? mediaTypeLabel(best) : "Unavailable";
  const age = formatCaptureAge(snapshot.capturedAt);
  document.getElementById("capture-age").textContent = age;
  document.getElementById("capture-age").hidden = !age;
  const title = snapshot.title?.title;
  document.getElementById("playback-title").textContent =
    typeof title === "string" && title.trim() ? title : "Playback detected";
  document.getElementById("source-type").textContent = source;
  renderMediaCandidates(snapshot.media, candidates, best);

  renderSubtitles(snapshot.subtitles);

  renderSessionContext(best?.requestContext);
  document.getElementById("state-message").hidden = true;
  document.getElementById("playback-details").hidden = false;
  document.getElementById("popup-content").setAttribute("aria-busy", "false");
}

document.getElementById("copy-playback").addEventListener("click", copyPlayback);
renderLoading();
requestPlaybackState().then(renderPlaybackState).catch(renderError);
