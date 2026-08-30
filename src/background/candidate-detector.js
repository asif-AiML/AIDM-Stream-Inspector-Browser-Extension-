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
  let pathname;

  try {
    pathname = new URL(requestUrl).pathname.toLowerCase();
  } catch (error) {
    return null;
  }

  for (const mediaType of obviousMediaExtensions) {
    if (mediaType.extensions.some((extension) => pathname.endsWith(extension))) {
      return mediaType.type;
    }
  }

  return null;
}

globalThis.detectObviousMediaCandidate = detectObviousMediaCandidate;
