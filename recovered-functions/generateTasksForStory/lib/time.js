const { DateTime } = require('luxon');

const DEFAULT_TIMEZONE = 'Europe/London';

const coerceZone = (zone) => {
  if (!zone || typeof zone !== 'string') return DEFAULT_TIMEZONE;
  return zone;
};

const toDateTime = (input, { zone = DEFAULT_TIMEZONE, defaultValue = null } = {}) => {
  if (input == null) return defaultValue;
  if (DateTime.isDateTime(input)) return input.setZone(coerceZone(zone));
  if (input instanceof Date) return DateTime.fromJSDate(input, { zone: coerceZone(zone) });
  if (typeof input === 'number') {
    const millis = Number.isFinite(input) ? input : Number(input);
    if (!Number.isFinite(millis)) return defaultValue;
    return DateTime.fromMillis(millis, { zone: coerceZone(zone) });
  }
  if (typeof input === 'object' && typeof input.toDate === 'function') {
    try {
      return DateTime.fromJSDate(input.toDate(), { zone: coerceZone(zone) });
    } catch (_) {
      return defaultValue;
    }
  }
  if (typeof input === 'object' && typeof input.seconds === 'number') {
    const millis = Number(input.seconds) * 1000 + Number(input.nanoseconds || input.nanos || 0) / 1e6;
    return DateTime.fromMillis(millis, { zone: coerceZone(zone) });
  }
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return defaultValue;
    const parsed = DateTime.fromISO(trimmed, { zone: coerceZone(zone) });
    if (parsed.isValid) return parsed;
    const unixMs = Number(trimmed);
    if (Number.isFinite(unixMs)) {
      return DateTime.fromMillis(unixMs, { zone: coerceZone(zone) });
    }
  }
  return defaultValue;
};

const toMillis = (input) => {
  const dt = toDateTime(input, { defaultValue: null });
  return dt ? dt.toMillis() : null;
};

const startEndOfDay = (dt) => {
  if (!dt) return null;
  const start = dt.startOf('day');
  const end = dt.endOf('day');
  return { start, end };
};

const computeDayWindow = ({ day, timezone }) => {
  const zone = coerceZone(timezone);
  let dt;
  if (day instanceof Date || typeof day === 'number') {
    dt = toDateTime(day, { zone });
  } else if (typeof day === 'string') {
    const trimmed = day.trim();
    dt = trimmed ? DateTime.fromISO(trimmed, { zone }) : DateTime.now().setZone(zone);
    if (!dt.isValid) {
      const millis = Number(trimmed);
      dt = Number.isFinite(millis)
        ? DateTime.fromMillis(millis, { zone })
        : DateTime.now().setZone(zone);
    }
  } else if (DateTime.isDateTime(day)) {
    dt = day.setZone(zone);
  } else {
    dt = DateTime.now().setZone(zone);
  }
  const { start, end } = startEndOfDay(dt);
  return { day: dt, start, end };
};

const isoDate = (dt) => {
  if (!dt) return null;
  const resolved = DateTime.isDateTime(dt) ? dt : toDateTime(dt);
  return resolved ? resolved.toISODate() : null;
};

const formatDate = (dt, { locale = 'en-GB' } = {}) => {
  const resolved = DateTime.isDateTime(dt) ? dt : toDateTime(dt);
  if (!resolved) return null;
  return resolved.setLocale(locale).toLocaleString(DateTime.DATE_MED);
};

const formatDateTime = (dt, { locale = 'en-GB', includeTimeZone = false } = {}) => {
  const resolved = DateTime.isDateTime(dt) ? dt : toDateTime(dt);
  if (!resolved) return null;
  const formatted = resolved.setLocale(locale).toLocaleString(DateTime.DATETIME_MED);
  return includeTimeZone ? `${formatted} ${resolved.offsetNameShort}` : formatted;
};

module.exports = {
  DEFAULT_TIMEZONE,
  coerceZone,
  toDateTime,
  toMillis,
  computeDayWindow,
  isoDate,
  formatDate,
  formatDateTime,
};
