const nodemailer = require('nodemailer');
const functions = require('firebase-functions');

let cachedTransporter = null;

const safeConfig = () => {
  try {
    return functions.config?.() || {};
  } catch (_) {
    return {};
  }
};

const createTransporter = () => {
  if (cachedTransporter) return cachedTransporter;

  const fromConfig = safeConfig().email || {};
  const service = fromConfig.service || process.env.EMAIL_SERVICE || 'gmail';
  const user = fromConfig.user || process.env.EMAIL_USER;
  const pass = fromConfig.password || process.env.EMAIL_PASSWORD;

  if (!user || !pass) {
    throw new Error(
      'Email credentials not configured (email.user / email.password or EMAIL_USER / EMAIL_PASSWORD env required).'
    );
  }

  cachedTransporter = nodemailer.createTransport({
    service,
    auth: { user, pass },
  });

  return cachedTransporter;
};

const sendEmail = async ({ to, subject, html, text }) => {
  if (!to) throw new Error('Email recipient required');
  const transporter = createTransporter();
  const fromConfig = safeConfig().email || {};
  const fromAddress = fromConfig.from || fromConfig.user || process.env.EMAIL_FROM || process.env.EMAIL_USER;

  const payload = {
    from: fromAddress,
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
