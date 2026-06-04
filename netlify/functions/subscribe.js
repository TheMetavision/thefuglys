/**
 * netlify/functions/subscribe.js  (The Fuglys)
 *
 * Server-side newsletter signup. The merch page form POSTs { email } here;
 * this function adds the subscriber to the Fuglys MailerLite group using a
 * token held in an env var — so no API token is ever exposed in client JS.
 *
 * Required env vars:
 *   MAILERLITE_TOKEN     — MailerLite API token
 *   MAILERLITE_GROUP_ID  — The Fuglys MailerLite group id
 *                          (set this in Netlify — no safe brand default)
 *
 * NOTE: if you already have a working subscribe function on The Fuglys, keep
 * it and just point it at the Fuglys group — you don't need two.
 */

const GROUP_ID = process.env.MAILERLITE_GROUP_ID || ''; // ← set in Netlify env
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  if (!process.env.MAILERLITE_TOKEN) {
    console.error('subscribe: MAILERLITE_TOKEN not set');
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Newsletter not configured' }) };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please enter a valid email address' }) };
  }

  // groups omitted if GROUP_ID unset — subscriber still added to the account.
  const payload = { email, status: 'active' };
  if (GROUP_ID) payload.groups = [GROUP_ID];

  try {
    const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${process.env.MAILERLITE_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });

    // MailerLite returns 200/201 for create, 200 for an already-existing
    // subscriber (idempotent upsert) — all are success from the user's view.
    if (res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    const detail = await res.text();
    console.error('subscribe: MailerLite error', res.status, detail);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not sign you up right now. Please try again later.' }) };
  } catch (err) {
    console.error('subscribe: request failed', err.message || err);
    return { statusCode: 502, headers, body: JSON.stringify({ error: 'Could not sign you up right now. Please try again later.' }) };
  }
};
