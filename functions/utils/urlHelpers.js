function buildAbsoluteUrl(path) {
  const origin = process.env.APP_BASE_URL || 'https://bob.jc1.tech';
  if (!path) return origin;
  if (path.startsWith('http')) return path;
  if (!path.startsWith('/')) return `${origin}/${path}`;
  return `${origin}${path}`;
}

function buildEntityPath(type, id, ref) {
  const raw = ref || id;
  if (!type || !raw) return null;
  const safeId = encodeURIComponent(String(raw));
  if (type === 'task') return `/tasks/${safeId}`;
  if (type === 'story') return `/stories/${safeId}`;
  if (type === 'goal') return `/goals/${safeId}`;
  return null;
}

function buildEntityUrl(type, id, ref) {
  const path = buildEntityPath(type, id, ref);
  return path ? buildAbsoluteUrl(path) : null;
}

module.exports = {
  buildAbsoluteUrl,
  buildEntityPath,
  buildEntityUrl,
};
