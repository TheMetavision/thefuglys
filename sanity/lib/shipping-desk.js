/**
 * The Studio side of Sendcloud wall-art shipping, for sanity.config.js:
 *
 *   shippingDeskItems(S)   the "Shipping (wall art)" and "Returns" desk lists
 *                          (Returns -> Printful claims: faulty merchandise, no
 *                          label, soonest Printful deadline first)
 *   shippingTemplates      no "new return request" button (it would make a
 *                          random, publicly readable id: returns are made at
 *                          returnRequest.<ref> by /returns or the order's
 *                          Create return button)
 *   shippingActions        the order's "Create return (free label)" action
 *
 * All three are no-ops unless the Studio was built with
 * SANITY_STUDIO_SHIPPING_ENABLED=true (lib/shipping-flag.mjs). Shared by The
 * Fuglys, Labrats, Cats On Crack and The Biker Babies.
 */
import { SHIPPING_UI } from './shipping-flag.mjs';
import { CreateReturnAction } from '../actions/CreateReturnAction';

const shippingQueue = (S, title, filter) =>
  S.listItem().title(title).child(
    S.documentTypeList('order')
      .title(title)
      .filter(`_type == "order" && hasInhouse == true && (${filter})`)
      .defaultOrdering([{ field: 'placedAt', direction: 'desc' }])
  );

const returnsQueue = (S, title, filter, ordering = [{ field: 'requestedAt', direction: 'desc' }]) =>
  S.listItem().title(title).child(
    S.documentTypeList('returnRequest')
      .title(title)
      .filter(`_type == "returnRequest" && (${filter})`)
      .defaultOrdering(ordering)
      .initialValueTemplates([])
  );

// Label returns (type "return", or blank on older ones) vs Printful claims.
const LABEL = '!(type == "printfulClaim")';
const CLAIM = 'type == "printfulClaim"';
const BY_DEADLINE = [{ field: 'claimDeadline', direction: 'asc' }, { field: 'requestedAt', direction: 'asc' }];

export const shippingDeskItems = (S) => (SHIPPING_UI ? [
  S.listItem().id('shipping').title('Shipping (wall art)').child(
    S.list().title('Shipping (wall art)').items([
      shippingQueue(S, 'Plan needs a decision', 'defined(shipmentResult.planProblem) && !defined(shipmentResult.labelCreatedAt) && inhouseStatus != "dispatched"'),
      shippingQueue(S, 'Outside the UK — dispatch by hand', 'shipmentResult.international == true && inhouseStatus != "dispatched"'),
      shippingQueue(S, 'Ready to ship (labels being bought)', 'shipment.status == "ready_to_ship" && !defined(shipmentResult.state)'),
      shippingQueue(S, 'Label created — to drop off', 'shipmentResult.state == "label_created"'),
      shippingQueue(S, 'In transit', 'shipmentResult.state == "in_transit"'),
      shippingQueue(S, 'Problems', 'shipmentResult.state in ["exception", "returned_to_sender"]'),
      shippingQueue(S, 'Delivered', 'shipmentResult.state == "delivered"'),
    ])
  ),
  S.listItem().id('returns').title('Returns').child(
    S.list().title('Returns').items([
      returnsQueue(S, 'Requested', `${LABEL} && status == "requested"`),
      returnsQueue(S, 'Approved — label pending', `${LABEL} && status == "approved"`),
      returnsQueue(S, 'Label sent / in transit', `${LABEL} && status in ["label_sent", "in_transit"]`),
      returnsQueue(S, 'Ready to collect', `${LABEL} && status == "ready_to_collect"`),
      returnsQueue(S, 'Received — refund in Stripe', `${LABEL} && status == "received"`),
      S.divider(),
      S.listItem().id('printful-claims').title('Printful claims').child(
        S.list().title('Printful claims').items([
          returnsQueue(S, 'To do — report in Printful, then approve', `${CLAIM} && status in ["requested", "approved"]`, BY_DEADLINE),
          returnsQueue(S, 'Refund due — refund in Stripe', `${CLAIM} && status == "refund_due"`, BY_DEADLINE),
          returnsQueue(S, 'Replacement sent', `${CLAIM} && status == "replacement_sent"`),
          returnsQueue(S, 'All Printful claims', CLAIM),
        ])
      ),
      S.divider(),
      returnsQueue(S, 'Problems', 'defined(error) && !(status in ["received", "refunded", "replacement_sent"])'),
      returnsQueue(S, 'All returns and claims', 'true'),
    ])
  ),
] : []);

export const shippingTemplates = (prev) => prev.filter((t) => t.schemaType !== 'returnRequest');

export const shippingActions = (prev, context) =>
  (SHIPPING_UI && context.schemaType === 'order' ? [...prev, CreateReturnAction] : prev);
