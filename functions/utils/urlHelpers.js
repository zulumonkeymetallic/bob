function buildAbsoluteUrl(path) {
  const origin = process.env.APP_BASE_URL || 'https://bob.jc1.tech';
  if (!path) return origin;
  if (path.startsWith('http')) return path;
  if (!path.startsWith('/')) return `${origin}/${path}`;
  return `${origin}${path}`;
}

module.exports = {
  buildAbsoluteUrl,
};
