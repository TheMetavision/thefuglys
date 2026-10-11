// The "Confirm your subscription" email, branded from the same env vars as the
// contact emails (BRAND_NAME, LOGO_URL, EMAIL_HEADER_BG, BRAND_ACCENT,
// SITE_URL), in their email-safe style: table layout, inline styles, 600px max,
// bgcolor attributes for Outlook, colour-scheme meta, alt text on the logo,
// and a preheader in real characters.
//
// The copy comes from the caller, so each brand keeps its own voice. No
// visitor input appears in the email except the link we generate, and it says
// plainly that ignoring it means nothing happens.

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Black or white, whichever reads better on `hex`. */
function textOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return '#ffffff';
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? '#000000' : '#ffffff';
}

export function brandFromEnv(env = process.env) {
  const headerBg = env.EMAIL_HEADER_BG || '#0e0e14';
  return {
    name: env.BRAND_NAME || 'Newsletter',
    logoUrl: env.LOGO_URL || '',
    headerBg,
    accent: env.BRAND_ACCENT || headerBg,
    siteUrl: (env.SITE_URL || '').replace(/\/$/, ''),
  };
}

/**
 * copy: { subject, preheader, heading, intro, button, signoff }
 */
export function confirmationEmail({ brand, copy, confirmUrl }) {
  const href = esc(confirmUrl);
  const host = brand.siteUrl.replace(/^https?:\/\//, '');
  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const header = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.name)}" width="200" style="display:block;width:200px;max-width:64%;height:auto;border:0;margin:0 auto;">`
    : `<span style="font-family:${font};font-size:22px;font-weight:800;letter-spacing:1px;color:${textOn(brand.headerBg)};">${esc(brand.name)}</span>`;
  const btnText = textOn(brand.accent);
  // Footer and logo-less header sit on the header colour: dark text on a light one.
  const onHeader = textOn(brand.headerBg);
  const footerMuted = onHeader === '#000000' ? '#2b2f36' : '#b8bcc4';
  const html = `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${esc(copy.heading)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f2f3f5;" bgcolor="#f2f3f5">
<div style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#f2f3f5;">${esc(copy.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f2f3f5" style="background-color:#f2f3f5;">
  <tr><td align="center" style="padding:24px 12px;">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;">
      <tr><td align="center" bgcolor="${brand.headerBg}" style="background-color:${brand.headerBg};padding:28px 24px;border-radius:10px 10px 0 0;">${header}</td></tr>
      <tr><td bgcolor="${brand.accent}" style="background-color:${brand.accent};height:4px;line-height:4px;font-size:4px;">&nbsp;</td></tr>
      <tr><td bgcolor="#ffffff" style="background-color:#ffffff;padding:32px 28px;font-family:${font};color:#1f2125;">
        <h1 style="margin:0 0 16px;font-size:24px;line-height:1.3;color:#1f2125;">${esc(copy.heading)}</h1>
        <p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2125;">${esc(copy.intro)}</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0;">
          <tr><td bgcolor="${brand.accent}" style="background-color:${brand.accent};border-radius:6px;">
            <a href="${href}" style="display:inline-block;padding:14px 26px;font-family:${font};font-size:15px;font-weight:bold;color:${btnText};text-decoration:none;border-radius:6px;">${esc(copy.button)}</a>
          </td></tr>
        </table>
        <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#5f6670;">The link works once and expires in 48 hours. If the button doesn’t work, paste this into your browser:<br><a href="${href}" style="color:#5f6670;word-break:break-all;">${href}</a></p>
        <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#5f6670;"><strong>Didn’t sign up?</strong> Someone may have entered your address by mistake. Ignore this email and you won’t be added to anything.</p>
        <p style="margin:0;font-size:15px;line-height:1.6;color:#1f2125;">${esc(copy.signoff)}</p>
      </td></tr>
      <tr><td bgcolor="${brand.headerBg}" style="background-color:${brand.headerBg};padding:20px 28px;border-radius:0 0 10px 10px;font-family:${font};font-size:12px;line-height:1.6;color:${footerMuted};">
        <strong style="color:${onHeader};">${esc(brand.name)}</strong>${host ? ` &middot; <a href="${esc(brand.siteUrl)}" style="color:${onHeader};text-decoration:underline;">${esc(host)}</a>` : ''}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
  const text =
    `${copy.heading}\n\n${copy.intro}\n\n` +
    `Confirm here:\n${confirmUrl}\n\n` +
    'The link works once and expires in 48 hours.\n\n' +
    'Didn’t sign up? Someone may have entered your address by mistake. Ignore this email and you won’t be added to anything.\n\n' +
    `${copy.signoff}\n\n${brand.name}${brand.siteUrl ? ` — ${brand.siteUrl}` : ''}`;
  return { subject: copy.subject, preheader: copy.preheader, html, text };
}
