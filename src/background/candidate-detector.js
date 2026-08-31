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
  let parsedRequestUrl;

  try {
    parsedRequestUrl = new URL(requestUrl);
  } catch (error) {
    return null;
  }

  const pathnameType = classifyObviousMediaPath(parsedRequestUrl.pathname);

  if (pathnameType !== null) {
    return pathnameType;
  }

  const rawQuery = parsedRequestUrl.search.slice(1);

  for (const queryPart of rawQuery.split("&")) {
    const separatorIndex = queryPart.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const rawValue = queryPart.slice(separatorIndex + 1);
    const rawValueType = classifyObviousMediaEvidence(rawValue, parsedRequestUrl);

    if (rawValueType !== null) {
      return rawValueType;
    }

    const decodedValue = safelyDecodeQueryValue(rawValue);

    if (decodedValue === null) {
      continue;
    }

    const decodedValueType = classifyObviousMediaEvidence(
      decodedValue,
      parsedRequestUrl
    );

    if (decodedValueType !== null) {
      return decodedValueType;
    }
  }

  return null;
}

function classifyObviousMediaEvidence(value, baseUrl) {
  try {
    return classifyObviousMediaPath(new URL(value, baseUrl).pathname);
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
