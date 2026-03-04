const { DateTime } = require('luxon');

const normalizeOverrideMap = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, entry]) => {
    acc[String(key)] = Array.isArray(entry) ? entry : [];
    return acc;
  }, {});
};

const normalizeThemeAllocationPlan = (raw) => {
  if (Array.isArray(raw)) {
    return {
      allocations: raw,
      weeklyOverrides: {},
    };
  }

  if (!raw || typeof raw !== 'object') {
    return {
      allocations: [],
      weeklyOverrides: {},
    };
  }

  return {
    allocations: Array.isArray(raw.allocations) ? raw.allocations : [],
    weeklyOverrides: normalizeOverrideMap(raw.weeklyOverrides),
  };
};

const resolveDateTime = (value, zone = 'Europe/London') => {
  if (DateTime.isDateTime(value)) return value.setZone(zone);
  if (value instanceof Date) return DateTime.fromJSDate(value, { zone });
  if (typeof value === 'number') return DateTime.fromMillis(value, { zone });
  if (typeof value === 'string') {
    const iso = DateTime.fromISO(value, { zone });
    if (iso.isValid) return iso;
    const millis = Date.parse(value);
    if (!Number.isNaN(millis)) return DateTime.fromMillis(millis, { zone });
  }
  return DateTime.now().setZone(zone);
};

const getAllocationWeekKey = (value, zone = 'Europe/London') => resolveDateTime(value, zone).startOf('week').toISODate();

const hasWeekOverride = (plan, weekKey) => Object.prototype.hasOwnProperty.call(plan.weeklyOverrides || {}, String(weekKey || ''));

const resolveThemeAllocationsForWeek = (planOrRaw, weekKey) => {
  const plan = normalizeThemeAllocationPlan(planOrRaw);
  const key = String(weekKey || '');
  if (key && hasWeekOverride(plan, key)) {
    return Array.isArray(plan.weeklyOverrides[key]) ? plan.weeklyOverrides[key] : [];
  }
  return plan.allocations;
};

const resolveThemeAllocationsForDate = (planOrRaw, value, zone = 'Europe/London') => {
  const weekKey = getAllocationWeekKey(value, zone);
  return resolveThemeAllocationsForWeek(planOrRaw, weekKey);
};

module.exports = {
  normalizeThemeAllocationPlan,
  getAllocationWeekKey,
  resolveThemeAllocationsForWeek,
  resolveThemeAllocationsForDate,
};
