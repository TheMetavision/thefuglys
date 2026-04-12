/**
 * src/components/CartButton.tsx
 *
 * Floating cart icon button — place in your Header or as a fixed element.
 * Shows item count badge. Clicking opens the CartDrawer.
 *
 * Replace #D4A033 with your brand accent colour.
 *
 * Usage in Header.astro:
 *   <CartButton client:load />
 */

import { useStore } from '@nanostores/react';
import { $cartCount, toggleCart } from '../lib/cart';

export default function CartButton() {
  const count = useStore($cartCount);

  return (
    <button
      onClick={toggleCart}
      aria-label={`Shopping cart with ${count} items`}
      style={{
        position: 'relative',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: '8px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Cart SVG icon */}
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ color: '#fff' }}
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>

      {/* Count badge */}
      {count > 0 && (
        <span
          style={{
            position: 'absolute',
            top: '2px',
            right: '0px',
            background: '#D4A033',
            color: '#000',
            fontSize: '11px',
            fontWeight: 700,
            width: '18px',
            height: '18px',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}
