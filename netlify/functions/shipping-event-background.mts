// netlify/functions/shipping-event-background.mts
//
// Started only by shipping-event (handoff key + the service's signature over
// the same body, see _shared/shipping-event-handoff.mjs). Does what a
// tracking event does -- see _shared/shipping-events.mjs: the order's
// shipment events, first-scan dispatch email (once), delivered stamp, team
// alerts, return status -- every step safe to repeat.
//
// A failure throws, so Netlify retries the background function (about 1 and
// 3 minutes later); the next tracking event re-checks the dispatch email too.

import { runShippingEvent } from './_shared/shipping-event-handoff.mjs';
import { applyParcelEvent, applyReturnEvent } from './_shared/shipping-events.mjs';
import { sanity, getResend } from './_shared/shipping-deps.mts';

export default async function handler(req: Request): Promise<Response> {
  const deps = { sanity, getResend };
  const r: any = await runShippingEvent(req, {
    apply: (event: any) => (event.kind === 'parcel' ? applyParcelEvent(event, deps) : applyReturnEvent(event, deps)),
  });
  console.log(`shipping-event-background: ${r.status} ${r.body}`);
  if (r.retry) throw new Error(`shipping-event-background: ${r.body}`);
  return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
