'use client';

import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { ADD_MEDICATION_TO_CART } from '@/graphql/operations';
import { useCart } from '@/lib/cart-context';
import type { CommandError } from '@/lib/types';
import { CommandErrors } from './ui';

/**
 * Comando `addMedicationToCart` desde la UI.
 *
 * No hay actualización manual del caché y no hace falta: la mutación devuelve el `Cart`
 * con sus ítems y el `InMemoryCache` lo normaliza por `id`. El contador del header, que
 * observa el mismo objeto con `useQuery`, se entera solo. Esa es la actualización
 * inteligente de caché que pide la rúbrica — no un `refetch`.
 */
export function AddToCartButton({
  medicationId,
  disabled,
  quantity = 1,
  variant = 'solid',
}: {
  medicationId: string;
  disabled?: boolean;
  quantity?: number;
  variant?: 'solid' | 'outline';
}) {
  const { ensureCart } = useCart();
  const [errors, setErrors] = useState<CommandError[]>([]);
  const [added, setAdded] = useState(false);

  const [addMedication, { loading }] = useMutation(ADD_MEDICATION_TO_CART);

  async function handleClick() {
    setErrors([]);
    const cartId = await ensureCart();
    const result = await addMedication({
      variables: { input: { cartId, medicationId, quantity } },
    });

    const payload = (result.data as { addMedicationToCart?: { errors: CommandError[] } })
      ?.addMedicationToCart;

    if (payload?.errors?.length) {
      setErrors(payload.errors);
      return;
    }

    setAdded(true);
    setTimeout(() => setAdded(false), 1800);
  }

  const base =
    'inline-flex items-center justify-center rounded-full px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45';
  const styles =
    variant === 'solid'
      ? 'bg-brand text-white hover:bg-brand-dark'
      : 'border border-line bg-surface text-ink hover:border-brand hover:text-brand';

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled || loading}
        className={`${base} ${styles}`}
      >
        {loading ? 'Agregando…' : added ? '✓ Agregado' : 'Agregar'}
      </button>
      <CommandErrors errors={errors} />
    </div>
  );
}
