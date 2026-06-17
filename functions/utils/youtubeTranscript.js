function extractVideoId(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    if (host === 'youtu.be') return parsed.pathname.slice(1).split('?')[0] || null;
    if (['youtube.com', 'm.youtube.com'].includes(host)) return parsed.searchParams.get('v') || null;
  } catch { /* ignore */ }
  return null;
}

async function fetchTranscript(videoId) {
  const res = await fetch(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw Object.assign(new Error(`YouTube page fetch failed (${res.status})`), { code: 'VIDEO_UNAVAILABLE' });

  const html = await res.text();

  // Bracket-count extraction of captionTracks array (more robust than regex on minified JSON)
  const needle = '"captionTracks":[';
  const needleIdx = html.indexOf(needle);
  if (needleIdx === -1) {
    throw Object.assign(new Error('No captions available for this video'), { code: 'NO_CAPTIONS' });
  }

  const arrStart = needleIdx + needle.length - 1; // index of '['
  let depth = 0;
  let arrEnd = arrStart;
  for (let i = arrStart; i < html.length; i++) {
    if (html[i] === '[') depth++;
    else if (html[i] === ']') {
      depth--;
      if (depth === 0) { arrEnd = i; break; }
    }
  }

  let tracks;
  try {
    tracks = JSON.parse(html.slice(arrStart, arrEnd + 1));
  } catch {
    throw Object.assign(new Error('Failed to parse caption tracks JSON'), { code: 'PARSE_ERROR' });
  }

  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw Object.assign(new Error('No caption tracks found'), { code: 'NO_CAPTIONS' });
  }

  // Prefer manually uploaded English, then auto-generated English, then first available
  const track = tracks.find(t => t.languageCode === 'en' && t.kind !== 'asr')
    || tracks.find(t => t.languageCode === 'en')
    || tracks[0];

  if (!track?.baseUrl) {
    throw Object.assign(new Error('No valid caption track URL'), { code: 'NO_CAPTIONS' });
  }

  const captionRes = await fetch(track.baseUrl);
  if (!captionRes.ok) {
    throw Object.assign(new Error(`Caption download failed (${captionRes.status})`), { code: 'CAPTION_FETCH_FAILED' });
  }

  const xml = await captionRes.text();
  return { transcript: parseTranscriptXml(xml), trackLanguage: track.languageCode || 'unknown' };
}

function parseTranscriptXml(xml) {
  return xml
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { extractVideoId, fetchTranscript };
