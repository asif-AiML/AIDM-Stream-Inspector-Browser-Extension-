// Developer proof only. No detection, ranking, selection, or raw-context display.
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

requestPlaybackState().then((snapshot) => {
  currentPlaybackSnapshot = snapshot;
  document.getElementById("state-status").textContent =
    `Playback: ${snapshot.status.playback}\n`
    + `Media observations: ${snapshot.media.candidates.length}\n`
    + `Timed-text resources: ${snapshot.subtitles.candidates.length}`;
}).catch(() => {
  document.getElementById("state-status").textContent =
    "State unavailable. Reopen the popup after the extension starts.";
});
