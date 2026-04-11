import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

export default async function handler(req, context) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const { items } = await req.json();

    if (!items || items.length === 0) {
      return new Response(JSON.stringify({ error: 'No items provided' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const lineItems = items.map((item) => ({
      price: item.stripePriceId,
      quantity: item.quantity,
    }));

    // Store Printful variant IDs in metadata for the webhook
    const metadata = {};
    items.forEach((item, i) => {
      metadata[`item_${i}_printful_id`] = item.printfulVariantId;
      metadata[`item_${i}_quantity`] = String(item.quantity);
      metadata[`item_${i}_name`] = item.name;
      metadata[`item_${i}_size`] = item.size || '';
      metadata[`item_${i}_colour`] = item.colour || '';
    });
    metadata.item_count = String(items.length);

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: lineItems,
      shipping_address_collection: {
        allowed_countries: ['GB', 'US', 'CA', 'AU', 'DE', 'FR', 'NL', 'IE'],
      },
      metadata,
      success_url: `${process.env.SITE_URL || 'https://thefuglys.com'}/merch?success=true`,
      cancel_url: `${process.env.SITE_URL || 'https://thefuglys.com'}/merch?cancelled=true`,
    });

    return new Response(JSON.stringify({ url: session.url }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Checkout error:', error);
    return new Response(
      JSON.stringify({ error: 'Failed to create checkout session' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

export const config = {
  path: '/api/create-checkout',
};
