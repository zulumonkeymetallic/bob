// Unified email sender: Nylas v3
// This module sends emails via Nylas using only the API key.
// It supports two modes:
// 1) Grant-based send if NYLAS_GRANT_ID (or per-call grantId) is provided
// 2) App outbox send when no grant is provided (if enabled for the app)
//
// Required: process.env.NYLAS_API_KEY must be available (declare as a secret on callers).

const admin = require('firebase-admin');

const NYLAS_API_BASE = process.env.NYLAS_API_BASE || 'https://api.us.nylas.com';

async function nylasFetch(path, options = {}) {
  const apiKey = process.env.NYLAS_API_KEY;
  if (!apiKey) {
    throw new Error('NYLAS_API_KEY not configured');
  }
  const url = `${NYLAS_API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(options.body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || `Nylas error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

// Attempts grant send first if a grantId is available; otherwise tries app-level send.
const sendEmail = async ({ to, subject, html, text, from, grantId }) => {
  if (!to) throw new Error('Email recipient required');
  const toList = Array.isArray(to) ? to : [to];

  // Build Nylas message payload
  const message = {
    subject: subject || '(no subject)',
    to: toList.map((addr) => ({ email: addr })),
    ...(from ? { from: [{ email: from }] } : {}),
    ...(html ? { body: html } : {}),
    ...(text && !html ? { body: text } : {}),
  };

  const tryGrantId = grantId || process.env.NYLAS_GRANT_ID || null;
  try {
    if (tryGrantId) {
      // Grant-scoped send
      const json = await nylasFetch(`/v3/grants/${encodeURIComponent(tryGrantId)}/messages/send`, { body: message });
      return { messageId: json?.data?.id || json?.id || null, response: json };
    }
  } catch (err) {
    // If grant send fails for any reason, fall through to app-level send attempt
    // but only if no explicit grantId was provided by caller
    if (grantId) throw err;
  }

  // App-level send (requires Outbox to be enabled for the Nylas app)
  const json = await nylasFetch(`/v3/messages/send`, { body: message });
  return { messageId: json?.data?.id || json?.id || null, response: json };
};

module.exports = { sendEmail };
