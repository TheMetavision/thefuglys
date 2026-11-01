// netlify/functions/shipping-label.mts
//
// GET /api/shipping-label?l=<labelId>&x=<expiry>&s=<signature>
//
// The "Print label" link in the team's "Label ready" email and on the order
// in the Studio. The link is signed with a key derived from
// SHIPPING_SECRET (_shared/shipping-internal.mjs) and expires after
// 30 days; it names one label and nothing else. The PDF is fetched from the
// shipping service with a signed request, so neither the Studio nor the email
// ever holds the shipping secret. No admin password: the site has no admin
// area, and the link itself is the credential (team inbox only).
//
// An expired link says how to get a new one: Shipment -> On hold -> Ready to ship.

import { shippingEnabled } from './_shared/shipping-client.mjs';
import { verifyLabelLink } from './_shared/shipping-internal.mjs';
import { fetchLabel } from './_shared/shipping-deps.mts';

const page = (status: number, msg: string) => new Response(
  `<!doctype html><meta charset="utf-8"><meta name="robots" content="noindex"><title>Label</title><body style="font-family:Arial,sans-serif;padding:32px;max-width:560px">${msg}</body>`,
  { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } },
);

const EXPIRED = '<h1>This label link has expired</h1><p>In the Studio, open the order, set Shipment to <strong>On hold</strong>, publish, then <strong>Ready to ship</strong> and publish again. New links arrive by email and appear on the order.</p>';
const INVALID = '<h1>This link is not valid</h1><p>Use the Print label link from the latest email or from the order in the Studio.</p>';

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== 'GET') return page(405, 'Method not allowed');
  if (!shippingEnabled()) return page(404, 'Not found');
  const v = verifyLabelLink(new URL(req.url).searchParams);
  if (!v.ok) return v.reason === 'expired' ? page(410, EXPIRED) : page(403, INVALID);
  const labelId = v.labelId as string;
  try {
    const pdf = await fetchLabel(labelId) as Buffer;
    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="label-${labelId.replace(/[^\w-]/g, '')}.pdf"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (err: any) {
    console.error(`shipping-label: ${labelId}: ${err?.code || ''} ${err?.message || err}`);
    return page(err?.code === 'not_found' ? 404 : 502, '<h1>The label could not be fetched</h1><p>Try again in a minute. If it keeps failing, check the shipping service.</p>');
  }
}
