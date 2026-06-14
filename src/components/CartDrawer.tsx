/**
 * src/components/CartDrawer.tsx
 * The Fuglys — Cart drawer component
 *
 * Brand palette: surface #1e3238, page #263F44, accent #b3162e / #99132f (red),
 * text #FFFFFF. Headings Bebas Neue. Mounted by Layout.astro as <CartDrawer client:load />.
 */

import { useStore } from '@nanostores/react';
import { useEffect, useState } from 'react';
import { $cartItems, $cartOpen, $cartTotal, $cartCount, $qualifiesForFreeShipping, $amountToFreeShipping, FREE_SHIPPING_THRESHOLD, removeFromCart, toggleCart, addToCart, clearCart } from '../lib/cart';
// @ts-ignore — shared CommonJS pricing module (no .d.ts; resolved by Vite at build)
import { isWallArt, artworkVariantLabel } from '../lib/artwork-pricing.cjs';

export default function CartDrawer() {
  const items = useStore($cartItems);
  const isOpen = useStore($cartOpen);
  const total = useStore($cartTotal);
  const count = useStore($cartCount);
  const freeShipping = useStore($qualifiesForFreeShipping);
  const toFreeShipping = useStore($amountToFreeShipping);
  const progressPct = Math.min(100, (total / FREE_SHIPPING_THRESHOLD) * 100);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    function handleAdd(e: any) { addToCart(e.detail); }
    window.addEventListener('add-to-cart', handleAdd);
    return () => window.removeEventListener('add-to-cart', handleAdd);
  }, []);

  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Close the confirm modal if the drawer closes or the cart empties
  useEffect(() => {
    if (!isOpen || items.length === 0) setConfirmClear(false);
  }, [isOpen, items.length]);

  function handleClear() {
    clearCart();
    setConfirmClear(false);
  }

  async function handleCheckout() {
    if (items.length === 0) return;
    try {
      const res = await fetch('/.netlify/functions/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items.map((item) => ({
            id: item.id,
            title: item.title,
            price: item.price,
            size: item.size,
            colour: item.colour || '',
            format: item.format || '',
            image: item.image,
            productType: item.productType || '',
            quantity: item.quantity,
          })),
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else if (data.error) {
        alert(`Checkout failed: ${data.error}`);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Something went wrong. Please try again.');
    }
  }

  const accent = '#b3162e';      // bright brand red — legible on dark teal
  const accentDim = '#99132f';   // primary red — hover-down
  const bg = '#1e3238';          // drawer surface (--color-surface)
  const bgLight = '#223b42';     // --color-bg-card-hover
  const text = '#FFFFFF';
  const textMuted = 'rgba(255,255,255,0.72)';
  const danger = '#ff5a5a';
  const bebas = "'Bebas Neue', sans-serif";

  const styles: Record<string, React.CSSProperties> = {
    overlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      zIndex: 2000, opacity: isOpen ? 1 : 0,
      pointerEvents: isOpen ? 'all' : 'none',
      transition: 'opacity 0.3s',
    },
    drawer: {
      position: 'fixed', top: 0, right: 0, bottom: 0,
      width: '400px', maxWidth: '90vw', background: bg,
      borderLeft: `2px solid ${accent}33`,
      zIndex: 2001,
      transform: isOpen ? 'translateX(0)' : 'translateX(100%)',
      transition: 'transform 0.3s ease',
      display: 'flex', flexDirection: 'column',
    },
    header: {
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: '20px 24px', borderBottom: `1px solid ${accent}22`,
    },
    title: {
      color: accent, fontFamily: bebas, fontSize: '22px', fontWeight: 400,
      letterSpacing: '2px', textTransform: 'uppercase' as const, margin: 0,
    },
    closeBtn: {
      background: 'none', border: 'none', color: text,
      fontSize: '28px', cursor: 'pointer', padding: '0 4px',
      lineHeight: 1,
    },
    body: {
      flex: 1, overflowY: 'auto' as const, padding: '16px 24px',
    },
    empty: {
      color: textMuted, textAlign: 'center' as const,
      padding: '48px 0', fontSize: '14px',
    },
    item: {
      display: 'flex', gap: '14px', padding: '14px 0',
      borderBottom: `1px solid ${accent}11`,
    },
    itemImg: {
      width: '72px', height: '72px', objectFit: 'cover' as const,
      borderRadius: '6px', border: `1px solid ${accent}22`,
    },
    itemName: {
      color: text, fontSize: '14px', fontWeight: 600, margin: '0 0 4px',
    },
    itemVariant: {
      color: textMuted, fontSize: '12px', margin: '0 0 4px',
    },
    itemPrice: {
      color: accent, fontSize: '14px', fontWeight: 700, margin: '0 0 6px',
    },
    removeBtn: {
      background: 'none', border: 'none', color: danger,
      fontSize: '12px', cursor: 'pointer', padding: 0,
      textDecoration: 'underline',
    },
    footer: {
      padding: '20px 24px', borderTop: `1px solid ${accent}22`,
    },
    shippingBar: {
      marginBottom: '16px', padding: '12px 14px',
      background: freeShipping ? 'rgba(179,22,46,0.12)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${freeShipping ? accent : `${accent}22`}`,
      borderRadius: '4px',
    },
    shippingMsg: {
      fontFamily: bebas, fontSize: '0.8rem', letterSpacing: '1.5px',
      textTransform: 'uppercase' as const, textAlign: 'center' as const,
      margin: '0 0 8px', color: freeShipping ? accent : textMuted,
    },
    shippingTrack: {
      height: '5px', background: 'rgba(255,255,255,0.12)',
      borderRadius: '3px', overflow: 'hidden' as const,
    },
    shippingFill: {
      height: '100%', width: `${progressPct}%`,
      background: accent, borderRadius: '3px', transition: 'width 0.4s ease',
    },
    totalRow: {
      display: 'flex', justifyContent: 'space-between',
      marginBottom: '16px',
    },
    totalLabel: {
      color: text, fontSize: '16px', fontWeight: 600,
      textTransform: 'uppercase' as const, letterSpacing: '1px',
    },
    totalValue: {
      color: accent, fontSize: '20px', fontWeight: 700,
    },
    checkoutBtn: {
      width: '100%', padding: '14px', background: accentDim, color: '#fff',
      border: 'none', fontFamily: bebas, fontSize: '18px', fontWeight: 400,
      textTransform: 'uppercase' as const, letterSpacing: '2px',
      cursor: 'pointer', borderRadius: '2px',
      transition: 'background 0.2s',
    },
    clearBtn: {
      width: '100%', marginTop: '12px', padding: '8px',
      background: 'none', border: 'none', color: textMuted,
      fontSize: '12px', letterSpacing: '1.5px', textTransform: 'uppercase' as const,
      cursor: 'pointer', transition: 'color 0.2s',
    },
    payNote: {
      color: textMuted, fontSize: '11px', lineHeight: 1.5,
      textAlign: 'center' as const, margin: '4px 0 12px',
    },
    // ── Branded confirm modal ──
    modalOverlay: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)',
      zIndex: 2100, display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    },
    modalPanel: {
      position: 'relative', width: '360px', maxWidth: '90vw',
      background: bg, border: `1px solid ${accent}`,
      padding: '34px 30px 30px', textAlign: 'center' as const,
      boxShadow: `0 24px 60px rgba(0,0,0,0.6), 0 0 30px ${accent}26`,
    },
    modalStamp: {
      position: 'absolute', top: 0, right: 0, background: accent, color: '#fff',
      fontFamily: bebas, fontSize: '0.7rem', letterSpacing: '3px',
      padding: '6px 14px', textTransform: 'uppercase' as const,
    },
    modalTitle: {
      fontFamily: bebas, fontSize: '2rem', letterSpacing: '2px',
      color: text, margin: '0 0 10px', textTransform: 'uppercase' as const,
    },
    modalDivider: {
      width: '48px', height: '3px', background: accent, margin: '0 auto 16px',
    },
    modalText: {
      color: textMuted, fontSize: '14px', lineHeight: 1.6, margin: '0 0 26px',
    },
    modalBtns: { display: 'flex', gap: '12px' },
    modalCancel: {
      flex: 1, padding: '12px', background: 'transparent', color: text,
      border: `1px solid ${accent}55`, borderRadius: '2px',
      fontFamily: bebas, fontSize: '1.05rem', letterSpacing: '2px',
      textTransform: 'uppercase' as const, cursor: 'pointer',
    },
    modalConfirm: {
      flex: 1, padding: '12px', background: accentDim, color: '#fff',
      border: 'none', borderRadius: '2px',
      fontFamily: bebas, fontSize: '1.05rem', letterSpacing: '2px',
      textTransform: 'uppercase' as const, cursor: 'pointer',
    },
  };

  return (
    <>
      <div style={styles.overlay} onClick={toggleCart} />
      <div style={styles.drawer}>
        <div style={styles.header}>
          <h2 style={styles.title}>Cart ({count})</h2>
          <button style={styles.closeBtn} onClick={toggleCart}>&times;</button>
        </div>
        <div style={styles.body}>
          {items.length === 0 ? (
            <p style={styles.empty}>Your cart's empty. Go scavenge some gear from the wasteland.</p>
          ) : (
            items.map((item) => (
              <div style={styles.item} key={item.id + '-' + item.size}>
                <img style={styles.itemImg} src={item.image} alt={item.title} />
                <div>
                  <p style={styles.itemName}>{item.title}</p>
                  <p style={styles.itemVariant}>
                    {isWallArt(item)
                      ? `${artworkVariantLabel(item.format || '', item.size)} · Qty: ${item.quantity}`
                      : `${item.colour ? `${item.colour} · ` : ''}Size: ${item.size} · Qty: ${item.quantity}`}
                  </p>
                  <p style={styles.itemPrice}>&pound;{(item.price * item.quantity).toFixed(2)}</p>
                  <button style={styles.removeBtn} onClick={() => removeFromCart(item.id, item.size)}>
                    Remove
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        {items.length > 0 && (
          <div style={styles.footer}>
            <div style={styles.shippingBar}>
              <p style={styles.shippingMsg}>
                {freeShipping
                  ? "\uD83C\uDF89 You've unlocked FREE UK delivery!"
                  : `Add \u00A3${toFreeShipping.toFixed(2)} more for FREE UK delivery`}
              </p>
              <div style={styles.shippingTrack}>
                <div style={styles.shippingFill} />
              </div>
            </div>
            <div style={styles.totalRow}>
              <span style={styles.totalLabel}>Total</span>
              <span style={styles.totalValue}>&pound;{total.toFixed(2)}</span>
            </div>
            <p style={styles.payNote}>
              Payments are taken by The Metavision Multimedia Ltd and show on your statement as THE METAVISION.
            </p>
            <button
              style={styles.checkoutBtn}
              onClick={handleCheckout}
              onMouseEnter={(e) => (e.currentTarget.style.background = accent)}
              onMouseLeave={(e) => (e.currentTarget.style.background = accentDim)}
            >
              Checkout
            </button>
            <button
              style={styles.clearBtn}
              onClick={() => setConfirmClear(true)}
              onMouseEnter={(e) => (e.currentTarget.style.color = danger)}
              onMouseLeave={(e) => (e.currentTarget.style.color = textMuted)}
            >
              Clear cart
            </button>
          </div>
        )}
      </div>

      {confirmClear && (
        <div style={styles.modalOverlay} onClick={() => setConfirmClear(false)}>
          <div style={styles.modalPanel} onClick={(e) => e.stopPropagation()}>
            <span style={styles.modalStamp}>Hold up</span>
            <h3 style={styles.modalTitle}>Empty the cart?</h3>
            <div style={styles.modalDivider} />
            <p style={styles.modalText}>
              This dumps all {count} {count === 1 ? 'item' : 'items'} out of your cart. No takebacks.
            </p>
            <div style={styles.modalBtns}>
              <button
                style={styles.modalCancel}
                onClick={() => setConfirmClear(false)}
                onMouseEnter={(e) => (e.currentTarget.style.borderColor = accent)}
                onMouseLeave={(e) => (e.currentTarget.style.borderColor = `${accent}55`)}
              >
                Keep it
              </button>
              <button
                style={styles.modalConfirm}
                onClick={handleClear}
                onMouseEnter={(e) => (e.currentTarget.style.background = accent)}
                onMouseLeave={(e) => (e.currentTarget.style.background = accentDim)}
              >
                Clear it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
