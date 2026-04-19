function clampTaskPoints(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function deriveMinutesFromPayload(payload = {}) {
  const candidates = [
    payload.estimateMin,
    payload.estimatedMinutes,
    payload.estimated_duration,
    payload.estimatedDuration,
    payload.estimated_hours ? payload.estimated_hours * 60 : null,
    payload.estimatedHours ? payload.estimatedHours * 60 : null,
  ];
  for (const value of candidates) {
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return null;
}

function derivePointsFromEffort(effort) {
  if (!effort) return null;
  const token = String(effort).trim().toUpperCase();
  if (!token) return null;
  if (token === 'XS') return 1;
  if (token.startsWith('S')) return 1;
  if (token.startsWith('M')) return 2;
  if (token === 'XL') return 6;
  if (token.startsWith('L')) return 4;
  return null;
}

function deriveTaskPoints(payload = {}) {
  const minutes = deriveMinutesFromPayload(payload);
  if (minutes) {
    return clampTaskPoints(minutes / 60) ?? 1;
  }
  const effortPoints = derivePointsFromEffort(payload.effort);
  if (effortPoints) {
    return clampTaskPoints(effortPoints) ?? 1;
  }
  return 1;
}

function ensureTaskPoints(payload = {}, context = {}) {
  const target = { ...payload };
  const normalized = clampTaskPoints(target.points);
  if (normalized) {
    target.points = normalized;
    return target;
  }
  target.points = deriveTaskPoints({ ...context, ...payload });
  return target;
}

module.exports = {
  clampTaskPoints,
  deriveTaskPoints,
  ensureTaskPoints,
};
