'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { CART, CREATE_CART } from '@/graphql/operations';
import type { Cart } from '@/lib/types';

/**
 * Estado del carrito en el cliente.
 *
 * Solo se guarda el ID en `localStorage`; el contenido real vive en el servidor y llega
 * por `useQuery`. Es una decisión de CQRS, no de comodidad: el carrito es un agregado
 * del write model y su fuente de verdad no puede ser el navegador. Si duplicáramos los
 * ítems en el cliente tendríamos dos verdades y ninguna confiable.
 */

const STORAGE_KEY = 'afirmative-pill:cart-id';

/**
 * En un sistema real saldría de un JWT. Acá es constante para no introducir un endpoint
 * de login REST, que rompería el mandato Zero-REST del enunciado.
 */
export const PATIENT_ID = 'paciente-demo';

type CartContextValue = {
  cartId: string | null;
  cart: Cart | null;
  itemCount: number;
  loading: boolean;
  /** Devuelve el carrito abierto; si no hay, ejecuta el comando `createCart`. */
  ensureCart: () => Promise<string>;
  /** Olvida el carrito local (tras emitir el pedido, o si quedó cerrado). */
  resetCart: () => void;
  refetchCart: () => void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cartId, setCartId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setCartId(window.localStorage.getItem(STORAGE_KEY));
    setHydrated(true);
  }, []);

  const { data, loading, refetch } = useQuery<{ cart: Cart | null }>(CART, {
    variables: { id: cartId },
    skip: !cartId,
  });

  const [createCart] = useMutation(CREATE_CART);

  // Un carrito ya facturado no sirve para seguir comprando: se descarta y el próximo
  // "agregar" abre uno nuevo.
  useEffect(() => {
    if (data?.cart && data.cart.status !== 'OPEN') {
      window.localStorage.removeItem(STORAGE_KEY);
      setCartId(null);
    }
  }, [data?.cart]);

  const ensureCart = useCallback(async () => {
    if (cartId) return cartId;
    const result = await createCart({ variables: { patientId: PATIENT_ID } });
    const created = (result.data as { createCart?: { cart?: { id: string } } } | undefined)
      ?.createCart?.cart?.id;
    if (!created) throw new Error('No se pudo abrir el carrito.');
    window.localStorage.setItem(STORAGE_KEY, created);
    setCartId(created);
    return created;
  }, [cartId, createCart]);

  const resetCart = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setCartId(null);
  }, []);

  const value = useMemo<CartContextValue>(
    () => ({
      cartId,
      cart: data?.cart ?? null,
      itemCount: data?.cart?.items.reduce((total, item) => total + item.quantity, 0) ?? 0,
      loading: !hydrated || loading,
      ensureCart,
      resetCart,
      refetchCart: () => {
        void refetch();
      },
    }),
    [cartId, data?.cart, hydrated, loading, ensureCart, resetCart, refetch],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const context = useContext(CartContext);
  if (!context) throw new Error('useCart debe usarse dentro de <CartProvider>.');
  return context;
}
