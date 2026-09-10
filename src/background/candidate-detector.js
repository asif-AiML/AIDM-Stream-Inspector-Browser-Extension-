const obviousMediaExtensions = [
  { type: globalThis.AIDM_STREAM_TYPES.HLS, extensions: [".m3u8"] },
  { type: globalThis.AIDM_STREAM_TYPES.DASH, extensions: [".mpd"] },
  {
    type: globalThis.AIDM_STREAM_TYPES.DIRECT_VIDEO,
    extensions: [".mp4", ".webm", ".m4v", ".mov"]
  },
  {
    type: globalThis.AIDM_STREAM_TYPES.AUDIO,
    extensions: [".mp3", ".m4a", ".aac", ".ogg", ".opus", ".wav", ".flac"]
  }
];

function detectObviousMediaCandidate(requestUrl) {
  const evidence = detectObviousMediaCandidateEvidence(requestUrl);
  return evidence === null ? null : evidence.type;
}

function detectObviousMediaCandidateEvidence(requestUrl) {
  let parsedRequestUrl;

  try {
    parsedRequestUrl = new URL(requestUrl);
  } catch (error) {
    return null;
  }

  const pathnameType = classifyObviousMediaPath(parsedRequestUrl.pathname);

  if (pathnameType !== null) {
    return {
      type: pathnameType,
      pathname: parsedRequestUrl.pathname,
      source: "request pathname"
    };
  }

  const rawQuery = parsedRequestUrl.search.slice(1);

  for (const queryPart of rawQuery.split("&")) {
    const separatorIndex = queryPart.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const rawValue = queryPart.slice(separatorIndex + 1);
    const rawValueEvidence = classifyObviousMediaEvidence(rawValue, parsedRequestUrl);

    const decodedValue = safelyDecodeQueryValue(rawValue);
    const decodedValueEvidence = decodedValue === null
      ? null
      : classifyObviousMediaEvidence(decodedValue, parsedRequestUrl);

    if (rawValueEvidence !== null) {
      // Encoded separators can leave a raw value ending in .m3u8. Expose the
      // decoded path for naming evidence only when it confirms the same type.
      return decodedValueEvidence !== null
        && decodedValueEvidence.type === rawValueEvidence.type
        ? decodedValueEvidence
        : rawValueEvidence;
    }

    if (decodedValueEvidence !== null) {
      return decodedValueEvidence;
    }
  }

  return null;
}

function classifyObviousMediaEvidence(value, baseUrl) {
  try {
    const pathname = new URL(value, baseUrl).pathname;
    const type = classifyObviousMediaPath(pathname);
    return type === null ? null : { type, pathname, source: "query-embedded pathname" };
  } catch (error) {
    return null;
  }
}

function classifyObviousMediaPath(pathname) {
  const lowercasePathname = pathname.toLowerCase();

  for (const mediaType of obviousMediaExtensions) {
    if (mediaType.extensions.some(
      (extension) => lowercasePathname.endsWith(extension)
    )) {
      return mediaType.type;
    }
  }

  return null;
}

function safelyDecodeQueryValue(rawValue) {
  try {
    return decodeURIComponent(rawValue.replace(/\+/g, " "));
  } catch (error) {
    return null;
  }
}

globalThis.detectObviousMediaCandidate = detectObviousMediaCandidate;
globalThis.detectObviousMediaCandidateEvidence = detectObviousMediaCandidateEvidence;
