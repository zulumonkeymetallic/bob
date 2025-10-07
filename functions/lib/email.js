const nodemailer = require('nodemailer');
const functions = require('firebase-functions');
const admin = require('firebase-admin');

let cachedTransporter = null;
let cachedConfigKey = null;
let cachedFromAddress = null;
let lastLoadedAt = 0;

const EMAIL_CONFIG_CACHE_MS = 5 * 60 * 1000; // 5 minutes

const safeConfig = () => {
  try {
    return functions.config?.() || {};
  } catch (_) {
    return {};
  }
};

const normaliseBoolean = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = String(value).toLowerCase().trim();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  return fallback;
};

const normaliseNumber = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const loadFirestoreEmailConfig = async () => {
  try {
    if (!admin.apps.length) return {};
    const snap = await admin.firestore().collection('system_settings').doc('email').get();
    if (snap.exists) {
      return snap.data() || {};
    }
  } catch (error) {
    console.warn('[email] failed to load Firestore config', error?.message || error);
  }
  return {};
};

const resolveEmailConfig = async () => {
  const configFromFunctions = safeConfig().email || {};
  const configFromFirestore = await loadFirestoreEmailConfig();

  const service = configFromFirestore.service ?? configFromFunctions.service ?? process.env.EMAIL_SERVICE ?? null;
  const host = configFromFirestore.host ?? configFromFunctions.host ?? process.env.EMAIL_HOST ?? null;
  const port = normaliseNumber(configFromFirestore.port ?? configFromFunctions.port ?? process.env.EMAIL_PORT);
  const secure = normaliseBoolean(configFromFirestore.secure ?? configFromFunctions.secure ?? process.env.EMAIL_SECURE, host ? true : false);
  const user = configFromFirestore.user ?? configFromFunctions.user ?? process.env.EMAIL_USER ?? null;
  const password = configFromFirestore.password ?? configFromFunctions.password ?? process.env.EMAIL_PASSWORD ?? null;
  const from = configFromFirestore.from ?? configFromFunctions.from ?? process.env.EMAIL_FROM ?? user ?? null;

  if (!user || !password) {
    throw new Error('Email credentials not configured (user/password required via settings or environment).');
  }

  return {
    service,
    host,
    port,
    secure,
    user,
    password,
    from,
  };
};

const createTransporter = async () => {
  const now = Date.now();
  if (cachedTransporter && now - lastLoadedAt < EMAIL_CONFIG_CACHE_MS) {
    return { transporter: cachedTransporter, from: cachedFromAddress };
  }

  const config = await resolveEmailConfig();
  const configKey = JSON.stringify({
    service: config.service,
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
  });

  if (cachedTransporter && cachedConfigKey === configKey) {
    lastLoadedAt = now;
    cachedFromAddress = config.from;
    return { transporter: cachedTransporter, from: cachedFromAddress };
  }

  let transporter;
  if (config.host) {
    // Normalize common SMTP settings to avoid TLS handshake errors like
    // "ssl3_get_record:wrong version number" from OpenSSL.
    let port = config.port || (config.secure ? 465 : 587);
    let secure = !!config.secure;
    if (port === 587 && secure === true) {
      // Port 587 uses STARTTLS; initial secure must be false
      console.warn('[email] Normalizing SMTP: port 587 requires secure=false (STARTTLS).');
      secure = false;
    }
    if (port === 465 && secure === false) {
      // Port 465 requires implicit TLS
      console.warn('[email] Normalizing SMTP: port 465 requires secure=true (implicit TLS).');
      secure = true;
    }
    transporter = nodemailer.createTransport({
      host: config.host,
      port,
      secure,
      auth: { user: config.user, pass: config.password },
    });
  } else {
    transporter = nodemailer.createTransport({
      service: config.service || 'gmail',
      auth: { user: config.user, pass: config.password },
    });
  }

  cachedTransporter = transporter;
  cachedConfigKey = configKey;
  cachedFromAddress = config.from;
  lastLoadedAt = now;

  return { transporter, from: cachedFromAddress };
};

const sendEmail = async ({ to, subject, html, text }) => {
  if (!to) throw new Error('Email recipient required');
  const { transporter, from } = await createTransporter();

  const payload = {
    from,
    to,
    subject,
    html,
    ...(text ? { text } : {}),
  };

  return transporter.sendMail(payload);
};

module.exports = {
  sendEmail,
};
