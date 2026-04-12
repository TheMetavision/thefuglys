import { useStore } from '@nanostores/react';
import { useEffect } from 'react';
import { cartItems, cartOpen, cartTotal, cartCount, removeFromCart, updateQuantity, toggleCart } from '../lib/cart';

export default function CartDrawer() {
  const items = useStore(cartItems);
  const isOpen = useStore(cartOpen);
  const total = useStore(cartTotal);
  const count = useStore(cartCount);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  async function handleCheckout() {
    if (items.length === 0) return;
    try {
      const res = await fetch('/.netlify/functions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            name: item.name,
            price: item.price,
            size: item.size,
            colour: item.colour || '',
            image: item.image || '',
            quantity: item.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
      else alert('Checkout failed. Please try again.');
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Something went wrong. Please try again.');
    }
  }

  const accent = '#99132F';
  const accentHover = '#b5172f';
  const bg = '#1e3238';

  return (
    <>
      {isOpen && (
        <div
          onClick={toggleCart}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
            zIndex: 998,
          }}
        />
      )}

      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: '400px', maxWidth: '90vw', background: bg,
          zIndex: 999,
          transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.3s ease',
          display: 'flex', flexDirection: 'column',
          borderLeft: '2px solid rgba(153, 19, 47, 0.4)',
        }}
      >
        <div style={{
          padding: '24px',
          borderBottom: '1px solid rgba(255,255,255,0.1)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        }}>
          <h2 style={{
            fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 800,
            fontSize: '1.4rem', textTransform: 'uppercase' as const,
            letterSpacing: '0.06em', color: '#fff', margin: 0,
          }}>
            Your Cart
          </h2>
          <button
            onClick={toggleCart}
            aria-label="Close cart"
            style={{
              background: 'none', border: 'none',
              color: 'rgba(255,255,255,0.6)', cursor: 'pointer',
              fontSize: '1.5rem', padding: '4px',
            }}
          >
            {'\u2715'}
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
          {items.length === 0 ? (
            <p style={{
              color: 'rgba(255,255,255,0.5)', textAlign: 'center',
              padding: '48px 0', fontFamily: "'Barlow', sans-serif",
            }}>
              Your cart is empty. Time to gear up.
            </p>
          ) : (
            items.map((item) => (
              <div
                key={`${item.productId}-${item.size}-${item.colour}`}
                style={{
                  display: 'flex', gap: '16px', padding: '16px 0',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}
              >
                {item.image && (
                  <img src={item.image} alt={item.name}
                    style={{ width: '64px', height: '64px', objectFit: 'cover', borderRadius: '2px' }}
                  />
                )}
                <div style={{ flex: 1 }}>
                  <div style={{
                    fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
                    fontSize: '0.95rem', color: '#fff',
                    textTransform: 'uppercase' as const, letterSpacing: '0.04em',
                  }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.5)', marginTop: '2px' }}>
                    {item.size}{item.colour ? ` / ${item.colour}` : ''}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px' }}>
                    <button
                      onClick={() => updateQuantity(item.productId, item.size, item.colour, item.quantity - 1)}
                      style={{
                        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                        color: '#fff', width: '28px', height: '28px', cursor: 'pointer', borderRadius: '2px', fontSize: '0.9rem',
                      }}
                    >{'\u2212'}</button>
                    <span style={{ color: '#fff', fontSize: '0.9rem', minWidth: '20px', textAlign: 'center' as const }}>
                      {item.quantity}
                    </span>
                    <button
                      onClick={() => updateQuantity(item.productId, item.size, item.colour, item.quantity + 1)}
                      style={{
                        background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
                        color: '#fff', width: '28px', height: '28px', cursor: 'pointer', borderRadius: '2px', fontSize: '0.9rem',
                      }}
                    >+</button>
                    <span style={{ marginLeft: 'auto', color: '#fff', fontWeight: 600 }}>
                      {'\u00A3'}{(item.price * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>
                <button
                  onClick={() => removeFromCart(item.productId, item.size, item.colour)}
                  aria-label={`Remove ${item.name}`}
                  style={{
                    background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                    cursor: 'pointer', fontSize: '1rem', alignSelf: 'flex-start', padding: '0 4px',
                  }}
                >{'\u2715'}</button>
              </div>
            ))
          )}
        </div>

        {items.length > 0 && (
          <div style={{ padding: '24px', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', marginBottom: '16px',
              fontFamily: "'Barlow Condensed', sans-serif", fontWeight: 700,
              fontSize: '1.1rem', textTransform: 'uppercase' as const,
              letterSpacing: '0.06em', color: '#fff',
            }}>
              <span>Total</span>
              <span>{'\u00A3'}{total.toFixed(2)}</span>
            </div>
            <button
              onClick={handleCheckout}
              style={{
                width: '100%', background: accent, color: '#fff', border: 'none',
                padding: '16px', fontFamily: "'Barlow Condensed', sans-serif",
                fontWeight: 700, fontSize: '0.95rem', letterSpacing: '0.12em',
                textTransform: 'uppercase' as const, cursor: 'pointer',
                borderRadius: '2px', transition: 'background 0.2s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = accentHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = accent)}
            >
              Checkout
            </button>
          </div>
        )}
      </div>
    </>
  );
}
