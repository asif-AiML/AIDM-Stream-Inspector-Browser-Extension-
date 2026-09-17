let currentPlaybackSnapshot = null;

function requestPlaybackState() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "AIDM_GET_PLAYBACK_STATE" }, (snapshot) => {
      const error = chrome.runtime.lastError;
      if (error || !snapshot) {
        reject(new Error(error?.message ?? "Playback state response unavailable"));
        return;
      }
      resolve(snapshot);
    });
  });
}

function showPopupMessage(summary, help = "") {
  document.getElementById("playback-details").hidden = true;
  document.getElementById("state-message").hidden = false;
  document.getElementById("state-summary").textContent = summary;
  document.getElementById("state-help").textContent = help;
  document.getElementById("state-help").hidden = !help;
  document.getElementById("popup-content").setAttribute("aria-busy", "false");
}

function headerPresence(value) {
  return typeof value === "string" && value.trim() && value.trim() !== "not observed"
    ? "Captured" : "Not observed";
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

function createMediaRow(candidate, observationNumber) {
  const row = document.createElement("div");
  row.className = "media-row";
  const name = document.createElement("p");
  name.className = "media-name";
  name.textContent = mediaRoleLabel(candidate);
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
  if (best) bestRow.append(createMediaRow(best, candidates.indexOf(best) + 1));

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
    item.append(createMediaRow(candidate, index + 1));
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
    const label = document.createElement("span");
    // Language/label metadata is not currently supplied by the engine.
    label.textContent = `Subtitle ${index + 1}`;
    const format = document.createElement("span");
    format.className = "subtitle-format";
    format.textContent = ["VTT", "SRT", "ASS", "SSA", "TTML"].includes(candidate.format)
      ? candidate.format : "Unknown format";
    row.append(label, format);
    list.append(row);
  });
}

function renderPlaybackState(snapshot) {
  const playbackStatus = snapshot?.status?.playback;
  if (playbackStatus === "not-detected") {
    showPopupMessage("No playback detected on this tab yet.",
      "Start the video, then reopen the extension.");
    return;
  }
  if (playbackStatus === "target-unavailable") {
    showPopupMessage("No active browser tab available.");
    return;
  }
  if (playbackStatus !== "detected") {
    showPopupMessage("Playback state unavailable.", "Reopen the extension to try again.");
    return;
  }

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

  const context = best?.requestContext;
  document.getElementById("session-referer").textContent = headerPresence(context?.referer);
  document.getElementById("session-origin").textContent = headerPresence(context?.origin);
  document.getElementById("session-user-agent").textContent = headerPresence(context?.userAgent);
  document.getElementById("state-message").hidden = true;
  document.getElementById("playback-details").hidden = false;
  document.getElementById("popup-content").setAttribute("aria-busy", "false");
}

requestPlaybackState().then((snapshot) => {
  currentPlaybackSnapshot = snapshot;
  renderPlaybackState(snapshot);
}).catch(() => {
  showPopupMessage("Couldn’t load playback information.", "Reopen the extension to try again.");
});
