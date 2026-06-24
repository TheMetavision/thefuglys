/**
 * netlify/functions/subscribe.js  (The Fuglys)
 *
 * FIX: this previously read process.env.MAILERLITE_TOKEN, but the env var
 * actually set on the Fuglys Netlify project is MAILERLITE_API_KEY — so the
 * function was returning "Newsletter not configured". Now standardised on
 * MAILERLITE_API_KEY to match the other three brands.
 *
 * The merch-page form already POSTs { email } to /.netlify/functions/subscribe,
 * so no frontend change is needed for Fuglys — only this file + the env var
 * name need to agree.
 *
 * Env vars (already set on Fuglys; mark MAILERLITE_API_KEY as "Secret"):
 *   MAILERLITE_API_KEY   - MailerLite API token (rotate it with the others)
 *   MAILERLITE_GROUP_ID  - 184360857503794692  (already set)
 */

const GROUP_ID = process.env.MAILERLITE_GROUP_ID || '';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }
  if (!process.env.MAILERLITE_API_KEY) {
    console.error('subscribe: MAILERLITE_API_KEY not set');
    return json(500, { error: 'Newsletter not configured' });
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body || '{}'));
  } catch (_) {
    return json(400, { error: 'Invalid request' });
  }

  email = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return json(400, { error: 'Please enter a valid email address' });
  }

  const payload = { email, status: 'active' };
  if (GROUP_ID) payload.groups = [GROUP_ID];

  try {
    const res = await fetch('https://connect.mailerlite.com/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${process.env.MAILERLITE_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.ok) return json(200, { ok: true });
    if (res.status === 422) return json(200, { ok: true, already: true });

    const detail = await res.text();
    console.error('subscribe: MailerLite error', res.status, detail);
    return json(502, { error: 'Could not sign you up right now. Please try again later.' });
  } catch (err) {
    console.error('subscribe: request failed', (err && err.message) || err);
    return json(502, { error: 'Could not sign you up right now. Please try again later.' });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
