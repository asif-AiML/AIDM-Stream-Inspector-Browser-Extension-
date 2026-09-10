function rankMediaCandidate(candidateEvidence) {
  const evidence = [];
  const streamTypes = globalThis.AIDM_STREAM_TYPES;
  const isManifest = candidateEvidence.type === streamTypes.HLS
    || candidateEvidence.type === streamTypes.DASH;

  evidence.push({
    code: "candidate-type",
    weight: isManifest ? 60 : 30,
    reason: isManifest
      ? "Adaptive manifest candidate; likely a useful entry point, role unconfirmed"
      : "Video/audio candidate; completeness and fragment role unknown"
  });

  // HLS naming is weak evidence, not proof of manifest contents or relationships.
  // Use only the path selected by detection, never unrelated query values or hosts.
  if (candidateEvidence.type === streamTypes.HLS) {
    const pathParts = candidateEvidence.pathname.toLowerCase().split("/");
    const filename = pathParts[pathParts.length - 1];
    const stem = filename.slice(0, -".m3u8".length);
    const parentDirectory = pathParts[pathParts.length - 2];
    const hasMasterClue = /(^|[-_.])master($|[-_.])/.test(stem);
    const hasPlaylistClue = stem === "playlist" || parentDirectory === "playlist";
    const hasAudioClue = /(^|[-_.])audio($|[-_.])/.test(stem);
    const hasVideoClue = /(^|[-_.])video($|[-_.])/.test(stem)
      || /(^|[-_.])\d{3,4}p($|[-_.])/.test(stem);
    const hasRenditionClue = hasAudioClue || hasVideoClue;

    if ((hasMasterClue || hasPlaylistClue) && hasRenditionClue) {
      evidence.push({
        code: "conflicting-hls-name",
        weight: 0,
        reason: "Weak high-level and rendition naming clues conflict; no naming adjustment"
      });
    } else if (hasMasterClue) {
      evidence.push({
        code: "master-like-name",
        weight: 30,
        reason: "Weak master filename clue; likely high-level HLS playlist"
      });
    } else if (hasPlaylistClue) {
      evidence.push({
        code: "playlist-like-path",
        weight: 10,
        reason: "Weak playlist filename or immediate-directory clue; possibly a parent playlist"
      });
    } else if (hasAudioClue && hasVideoClue) {
      evidence.push({
        code: "mixed-rendition-name",
        weight: 0,
        reason: "Both audio and video naming clues; completeness unknown, no naming adjustment"
      });
    } else if (hasAudioClue) {
      evidence.push({
        code: "audio-rendition-like-name",
        weight: -20,
        reason: "Weak audio filename clue; likely an audio rendition"
      });
    } else if (hasVideoClue) {
      evidence.push({
        code: "video-rendition-like-name",
        weight: -10,
        reason: "Weak video or quality-shaped filename clue; likely a video rendition"
      });
    } else {
      evidence.push({
        code: "unknown-hls-role",
        weight: 0,
        reason: "No supported HLS role naming clue; index names alone are neutral"
      });
    }
  }

  // Contributions keep scores explainable and allow later evidence sources to be added.
  return {
    score: evidence.reduce((total, item) => total + item.weight, 0),
    evidence
  };
}

globalThis.rankMediaCandidate = rankMediaCandidate;
