/**
 * Writing server-owned fields without Studio publishing undoing them.
 *
 * Sanity's Publish replaces the published document with the draft, whole. A
 * server write to the published document that a draft opened before it does
 * not have is rolled back when that draft is published: a dispatch email
 * marked sent goes back to unsent, labels bought vanish from the order.
 *
 * Two rules keep that from happening:
 *
 *   1. Server results live in their own fields, never in a field the operator
 *      edits. Alan owns `shipment` (status, the Ready-to-ship switch),
 *      `parcelPlan`, `inhouseStatus` and the wall-art carrier / tracking
 *      number (wallArtCarrier, wallArtTrackingNumber: the first carrier scan
 *      fills those in only when empty); the server owns `shipmentResult`,
 *      the dispatch-email stamps, and on a return request everything but the
 *      decision. Printful's fields (status, carrier, trackingNumber,
 *      trackingUrl, shippedAt, printfulOrderId) belong to printful-webhook
 *      and are never written by the shipping code.
 *   2. Every server write goes to the published document AND, in the same
 *      transaction, to its draft if one exists -- as path-level patches, so
 *      whatever Alan is typing elsewhere in the draft is untouched. The draft
 *      then carries the server's values, and publishing it changes nothing
 *      the server wrote.
 *
 * Claims (the once-only guards) put ifRevisionId on the PUBLISHED document
 * only: of two racing callers exactly one transaction lands.
 */

export const isConflict = (err) => {
  const status = err && (err.statusCode || err.response?.statusCode);
  return status === 409 || /revision/i.test((err && err.message) || '');
};

/** The top-level objects a dotted `set` writes into, so they exist first. */
function rootsOf(set) {
  const roots = {};
  for (const k of Object.keys(set || {})) {
    const i = k.indexOf('.');
    if (i > 0) roots[k.slice(0, i)] = {};
  }
  return roots;
}

/**
 * @param {object} sanity  @sanity/client with a write token
 * @param {string} id      the published document id
 * @param {object} p
 * @param {object} [p.set]
 * @param {string[]} [p.unset]
 * @param {string} [p.ifRevisionId]  guard on the published document
 */
export async function serverPatch(sanity, id, { set, unset, ifRevisionId } = {}) {
  if (String(id).startsWith('drafts.')) throw new Error(`serverPatch: ${id} is a draft id`);
  const draftId = `drafts.${id}`;
  let draft = null;
  try { draft = await sanity.getDocument(draftId); } catch { draft = null; }
  const roots = rootsOf(set);
  const apply = (p) => {
    let q = p;
    if (Object.keys(roots).length) q = q.setIfMissing(roots);
    if (set && Object.keys(set).length) q = q.set(set);
    if (unset && unset.length) q = q.unset(unset);
    return q;
  };
  const tx = sanity.transaction();
  tx.patch(id, (p) => apply(ifRevisionId ? p.ifRevisionId(ifRevisionId) : p));
  if (draft) tx.patch(draftId, (p) => apply(p));
  return tx.commit();
}

/**
 * Read, decide, write with ifRevisionId, and go round again if somebody wrote
 * in between. `decide(doc)` returns null to stop (nothing to write) or
 * { set, unset, result }. Returns { doc, result, written }.
 */
export async function readDecideWrite(sanity, id, decide, { attempts = 5 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const doc = await sanity.getDocument(id);
    const d = await decide(doc);
    if (!d) return { doc, result: null, written: false };
    try {
      await serverPatch(sanity, id, { set: d.set, unset: d.unset, ifRevisionId: doc._rev });
      return { doc, result: d.result, written: true };
    } catch (err) {
      if (!isConflict(err) || i === attempts - 1) throw err;
    }
  }
  return { doc: null, result: null, written: false };
}
