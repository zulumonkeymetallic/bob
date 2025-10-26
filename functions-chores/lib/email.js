// Unified email sender: Brevo (Sendinblue) transactional API
// Endpoint: POST https://api.brevo.com/v3/smtp/email
// Auth: HTTP header "api-key: <BREVO_API_KEY>"

const BREVO_API_BASE = process.env.BREVO_API_BASE || 'https://api.brevo.com/v3';

async function brevoFetch(path, payload) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) throw new Error('BREVO_API_KEY not configured');
  const url = `${BREVO_API_BASE}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = json?.message || json?.error || `Brevo error ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

const sendEmail = async ({ to, subject, html, text, from, senderName }) => {
  if (!to) throw new Error('Email recipient required');
  const toList = Array.isArray(to) ? to : [to];

  // Sender precedence: explicit arg > env fallback
  let senderEmail = from || process.env.BREVO_SENDER_EMAIL || 'no-reply@bob.local';
  const sender = { email: senderEmail };
  if (senderName || process.env.BREVO_SENDER_NAME) sender.name = senderName || process.env.BREVO_SENDER_NAME;

  const payload = {
    sender,
    to: toList.map((addr) => ({ email: addr })),
    subject: subject || '(no subject)',
    ...(html ? { htmlContent: html } : {}),
    ...(text ? { textContent: text } : {}),
  };

  const json = await brevoFetch('/smtp/email', payload);
  return { messageId: json?.messageId || null, response: json };
};

module.exports = { sendEmail };
