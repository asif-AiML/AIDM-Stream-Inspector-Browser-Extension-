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
  const typeLabels = { HLS: "HLS", DASH: "DASH", VIDEO: "Direct Video", AUDIO: "Audio" };
  const source = best && Object.hasOwn(typeLabels, best.type) ? typeLabels[best.type] : "Unavailable";
  const priority = ["HIGH", "MEDIUM", "LOW"].includes(best?.ranking?.priority)
    ? best.ranking.priority : "Not available";
  const title = snapshot.title?.title;
  document.getElementById("playback-title").textContent =
    typeof title === "string" && title.trim() ? title : "Playback detected";
  document.getElementById("source-type").textContent = source;
  document.getElementById("media-summary").textContent = best
    ? `Best candidate · ${source}` : "Best candidate unavailable";
  document.getElementById("media-priority").textContent = `Priority: ${priority}`;

  const subtitles = Array.isArray(snapshot.subtitles?.candidates) ? snapshot.subtitles.candidates : [];
  const subtitleCount = subtitles.filter((candidate) => candidate?.role === "SUBTITLE").length;
  const otherCount = subtitles.filter((candidate) =>
    candidate?.role === "THUMBNAIL" || candidate?.role === "UNKNOWN"
  ).length;
  document.getElementById("subtitle-count").textContent = `${subtitleCount} detected`;
  document.getElementById("other-timed-text").textContent =
    `${otherCount} other timed-text ${otherCount === 1 ? "resource" : "resources"}`;
  document.getElementById("other-timed-text").hidden = otherCount === 0;

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
