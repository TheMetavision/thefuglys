// In-memory stand-in for the bits of @sanity/client the shipping code uses:
// getDocument, fetch (answered by a function the test supplies), create,
// patch(id).set().commit(), and transaction().patch(id, fn).commit() with
// setIfMissing / set (dotted paths) / unset / ifRevisionId.
// Not a test file itself (tests/*.test.mjs is the glob).

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

function setPath(obj, path, value) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (o[parts[i]] == null || typeof o[parts[i]] !== 'object') o[parts[i]] = {};
    o = o[parts[i]];
  }
  o[parts.at(-1)] = clone(value);
}
function unsetPath(obj, path) {
  const parts = path.split('.');
  let o = obj;
  for (let i = 0; i < parts.length - 1; i++) { o = o?.[parts[i]]; if (!o) return; }
  delete o[parts.at(-1)];
}

class Patch {
  constructor() { this.ops = []; this.rev = null; }
  setIfMissing(v) { this.ops.push(['setIfMissing', v]); return this; }
  set(v) { this.ops.push(['set', v]); return this; }
  unset(v) { this.ops.push(['unset', v]); return this; }
  ifRevisionId(r) { this.rev = r; return this; }
}

export function fakeSanity(docs = {}, opts = {}) {
  const store = new Map(Object.entries(clone(docs)).map(([id, d]) => [id, { _id: id, _rev: 'r0', ...d }]));
  return makeClient(store, opts);
}

/**
 * The same client over a plain { id: doc } object the test owns, read through
 * getDocs() on every call (so the test may replace the object). For tests
 * where a fetch-stubbed function (stripe-webhook) and a client-using one
 * (printful-webhook) share one store. Revisions it writes are 'f1', 'f2', ...
 */
export function fakeSanityOver(getDocs, opts = {}) {
  const store = {
    get: (id) => getDocs()[id],
    has: (id) => Object.prototype.hasOwnProperty.call(getDocs(), id),
    set: (id, d) => { getDocs()[id] = d; },
  };
  return makeClient(store, { revPrefix: 'f', ...opts });
}

function makeClient(store, { fetch: fetchImpl = async () => null, beforeCommit, revPrefix = 'r' } = {}) {
  let revs = 0;
  const writes = [];

  function apply(id, patch) {
    const doc = store.get(id);
    if (!doc) { const e = new Error(`document ${id} not found`); e.statusCode = 404; throw e; }
    if (patch.rev && patch.rev !== doc._rev) { const e = new Error('revision mismatch'); e.statusCode = 409; throw e; }
    for (const [op, v] of patch.ops) {
      if (op === 'setIfMissing') for (const [k, val] of Object.entries(v)) { if (doc[k] === undefined) doc[k] = clone(val); }
      if (op === 'set') for (const [k, val] of Object.entries(v)) setPath(doc, k, val);
      if (op === 'unset') for (const k of v) unsetPath(doc, k);
    }
    doc._rev = `${revPrefix}${++revs}`;
    writes.push({ id, ops: clone(patch.ops) });
  }

  const client = {
    store, writes,
    async getDocument(id) { return clone(store.get(id)) ?? null; },
    async fetch(q, params) { return fetchImpl(q, params, store); },
    async create(doc) { if (store.has(doc._id)) throw new Error('exists'); store.set(doc._id, { _rev: `${revPrefix}${++revs}`, ...clone(doc) }); return doc; },
    patch(id) {
      const p = new Patch();
      return Object.assign(p, { commit: async () => apply(id, p) });
    },
    transaction() {
      const list = [];
      return {
        patch(id, fn) { list.push([id, fn(new Patch())]); return this; },
        async commit() {
          if (beforeCommit) await beforeCommit(list);
          // all-or-nothing on revision checks
          for (const [id, p] of list) {
            const d = store.get(id);
            if (p.rev && d && p.rev !== d._rev) { const e = new Error('revision mismatch'); e.statusCode = 409; throw e; }
          }
          for (const [id, p] of list) if (store.has(id)) apply(id, p);
          return { ok: true };
        },
      };
    },
  };
  return client;
}

/** A Resend stand-in: records every send; `fail` makes it return an error. */
export function fakeResend({ fail = false } = {}) {
  const sent = [];
  return {
    sent,
    emails: {
      async send(msg) {
        if (fail) return { error: { name: 'test', message: 'refused' } };
        sent.push(msg);
        return { data: { id: `em_${sent.length}` }, error: null };
      },
    },
  };
}

export const quiet = { log() {}, warn() {}, error() {} };
