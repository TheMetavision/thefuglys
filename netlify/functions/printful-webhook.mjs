export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const body = await req.json();
    const eventType = body.type;

    switch (eventType) {
      case 'package_shipped':
        console.log('Order shipped:', {
          orderId: body.data?.order?.id,
          trackingNumber: body.data?.shipment?.tracking_number,
          trackingUrl: body.data?.shipment?.tracking_url,
          carrier: body.data?.shipment?.carrier,
        });
        // TODO: Send shipping confirmation email via Resend/SendGrid
        // TODO: Update order status in your database if needed
        break;

      case 'order_created':
        console.log('Printful order confirmed:', body.data?.order?.id);
        break;

      case 'order_failed':
        console.error('Printful order failed:', body.data?.order?.id, body.data?.reason);
        // TODO: Alert admin / send notification
        break;

      default:
        console.log('Unhandled Printful event:', eventType);
    }

    return new Response('OK', { status: 200 });
  } catch (err) {
    console.error('Printful webhook error:', err);
    return new Response('Error', { status: 500 });
  }
}

export const config = {
  path: '/api/printful-webhook',
};
