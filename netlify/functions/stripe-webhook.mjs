import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-12-18.acacia',
});

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const sig = req.headers.get('stripe-signature');
  const body = await req.text();

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const metadata = session.metadata;
    const shipping = session.shipping_details;

    if (!shipping || !shipping.address) {
      console.error('No shipping address in session');
      return new Response('OK', { status: 200 });
    }

    const itemCount = parseInt(metadata.item_count || '0');
    const items = [];

    for (let i = 0; i < itemCount; i++) {
      items.push({
        sync_variant_id: parseInt(metadata[`item_${i}_printful_id`]),
        quantity: parseInt(metadata[`item_${i}_quantity`]),
        name: metadata[`item_${i}_name`],
      });
    }

    if (items.length === 0) {
      console.error('No items found in metadata');
      return new Response('OK', { status: 200 });
    }

    // Create Printful order
    try {
      const printfulOrder = {
        recipient: {
          name: shipping.name,
          address1: shipping.address.line1,
          address2: shipping.address.line2 || '',
          city: shipping.address.city,
          state_code: shipping.address.state || '',
          country_code: shipping.address.country,
          zip: shipping.address.postal_code,
          email: session.customer_details?.email || '',
        },
        items: items.map((item) => ({
          sync_variant_id: item.sync_variant_id,
          quantity: item.quantity,
        })),
      };

      const printfulRes = await fetch('https://api.printful.com/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.PRINTFUL_API_KEY}`,
        },
        body: JSON.stringify(printfulOrder),
      });

      const printfulData = await printfulRes.json();

      if (!printfulRes.ok) {
        console.error('Printful order failed:', printfulData);
      } else {
        console.log('Printful order created:', printfulData.result?.id);
      }
    } catch (err) {
      console.error('Printful API error:', err);
    }
  }

  return new Response('OK', { status: 200 });
}

export const config = {
  path: '/api/stripe-webhook',
};
