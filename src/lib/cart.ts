import { atom, computed } from 'nanostores';

export interface CartItem {
  productId: string;
  name: string;
  price: number;
  size: string;
  colour: string;
  image: string;
  stripePriceId: string;
  printfulVariantId: string;
  quantity: number;
}

export const cartItems = atom<CartItem[]>([]);
export const cartOpen = atom(false);

export const cartTotal = computed(cartItems, (items) =>
  items.reduce((sum, item) => sum + item.price * item.quantity, 0)
);

export const cartCount = computed(cartItems, (items) =>
  items.reduce((sum, item) => sum + item.quantity, 0)
);

export function addToCart(item: Omit<CartItem, 'quantity'>) {
  const current = cartItems.get();
  const existing = current.find(
    (i) =>
      i.productId === item.productId &&
      i.size === item.size &&
      i.colour === item.colour
  );

  if (existing) {
    cartItems.set(
      current.map((i) =>
        i === existing ? { ...i, quantity: i.quantity + 1 } : i
      )
    );
  } else {
    cartItems.set([...current, { ...item, quantity: 1 }]);
  }

  cartOpen.set(true);
}

export function removeFromCart(productId: string, size: string, colour: string) {
  cartItems.set(
    cartItems.get().filter(
      (i) =>
        !(i.productId === productId && i.size === size && i.colour === colour)
    )
  );
}

export function updateQuantity(productId: string, size: string, colour: string, quantity: number) {
  if (quantity <= 0) {
    removeFromCart(productId, size, colour);
    return;
  }

  cartItems.set(
    cartItems.get().map((i) =>
      i.productId === productId && i.size === size && i.colour === colour
        ? { ...i, quantity }
        : i
    )
  );
}

export function clearCart() {
  cartItems.set([]);
}

export function toggleCart() {
  cartOpen.set(!cartOpen.get());
}
