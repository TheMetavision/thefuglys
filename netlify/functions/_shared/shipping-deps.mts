// netlify/functions/_shared/shipping-deps.mts
//
// The real clients the shipping functions are wired to. Tests never import
// this: they hand the _shared/*.mjs logic fakes instead.

import { createClient } from '@sanity/client';
import { Resend } from 'resend';
import { sanityWriteToken, setting } from './site-config.mjs';
import { shippingCreate, shippingRequest } from './shipping-client.mjs';

export const sanity = createClient({
  projectId: setting('SANITY_PROJECT_ID'),
  dataset: setting('SANITY_DATASET'),
  apiVersion: '2026-04-14',
  token: sanityWriteToken(),
  useCdn: false,
});

// Built on first use, not at import: `new Resend()` throws without a key.
let resendClient: Resend | null = null;
export const getResend = () => {
  if (resendClient) return resendClient;
  if (!process.env.RESEND_API_KEY) return null;
  return (resendClient = new Resend(process.env.RESEND_API_KEY));
};

export const shipping = (path: string, body: object) => shippingCreate(path, body);
export const fetchLabel = (labelId: string) =>
  shippingRequest(`label?labelId=${encodeURIComponent(labelId)}`, { method: 'GET' });

/**
 * Start one of our own functions (a background one answers 202 at once).
 * AWAITED by the caller: a function's environment freezes on return, so an
 * un-awaited fetch never leaves in production. Locally (netlify dev) the
 * request goes to the same origin; live, to the site's main URL.
 */
export async function startInternal(req: Request, path: string, body: object, headers: Record<string, string>, { timeoutMs = 4000 } = {}) {
  const here = new URL(req.url);
  const local = ['localhost', '127.0.0.1', '::1'].includes(here.hostname);
  const base = local ? here.origin : (process.env.URL || setting('SITE_URL')).replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err: any) {
    return { ok: false, error: err?.name === 'TimeoutError' ? 'timed out' : (err?.message || String(err)) };
  }
}
