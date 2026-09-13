globalThis.AIDM_SUBTITLE_ROLES = Object.freeze({
  SUBTITLE: "SUBTITLE",
  THUMBNAIL: "THUMBNAIL",
  UNKNOWN: "UNKNOWN"
});

function classifySubtitleRole(candidateEvidence) {
  const roles = globalThis.AIDM_SUBTITLE_ROLES;
  const formats = globalThis.AIDM_SUBTITLE_FORMATS;

  if ([formats.SRT, formats.ASS, formats.SSA].includes(candidateEvidence.format)) {
    return {
      role: roles.SUBTITLE,
      evidence: [{
        code: "subtitle-format",
        reason: candidateEvidence.source === "response MIME"
          ? "Subtitle-specific MIME format; likely subtitle, contents unverified"
          : "Subtitle-specific format extension; likely subtitle, contents unverified"
      }]
    };
  }

  if (candidateEvidence.format === formats.VTT) {
    const pathParts = candidateEvidence.pathname.toLowerCase().split("/");
    const filename = pathParts.pop();
    // MIME-discovered VTT paths need not have a .vtt suffix.
    const stem = filename.endsWith(".vtt") ? filename.slice(0, -".vtt".length) : filename;

    // A specific preview filename outweighs a general subtitle directory clue.
    // Inspect only the detector-selected path, without decoding it again.
    if (/(^|[-_.])(thumbnail|thumbnails|thumbs|storyboard|storyboards|sprite|sprites)($|[-_.])/.test(stem)) {
      return {
        role: roles.THUMBNAIL,
        evidence: [{
          code: "vtt-preview-name",
          reason: "VTT thumbnail/storyboard filename token; likely preview data, takes precedence over subtitle path clues"
        }]
      };
    }

    if (pathParts.some((part) => ["subs", "subtitles", "captions"].includes(part))) {
      return {
        role: roles.SUBTITLE,
        evidence: [{
          code: "vtt-subtitle-directory",
          reason: "Subtitle directory clue in VTT evidence path; likely subtitle, contents unverified"
        }]
      };
    }

    if (/(^|[-_.])(subtitle|subtitles|caption|captions)($|[-_.])/.test(stem)) {
      return {
        role: roles.SUBTITLE,
        evidence: [{
          code: "vtt-subtitle-name",
          reason: "Subtitle/caption filename token; likely subtitle, contents unverified"
        }]
      };
    }
  }

  return {
    role: roles.UNKNOWN,
    evidence: [{
      code: "unknown-timed-text-role",
      reason: "No supported role clue; timed-text contents unverified"
    }]
  };
}

globalThis.classifySubtitleRole = classifySubtitleRole;
