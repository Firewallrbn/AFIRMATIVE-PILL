import { db } from '@/server/shared/db';

/**
 * Repositorio de ESCRITURA del carrito.
 *
 * Acá sí hay INSERT/UPDATE: es el write model. El carrito es un agregado de borrador,
 * sin proyección propia, y por eso también se lee desde aquí (ver la nota de
 * read-your-writes en el SDL y en docs/cqrs.md).
 */

export type CartRow = {
  id: string;
  patient_id: string;
  status: 'OPEN' | 'CHECKED_OUT' | 'ABANDONED';
  updated_at: Date;
};

export type CartItemRow = {
  medication_id: string;
  quantity: number;
  name: string;
  sku: string;
  dosage: string;
  presentation: string;
  price: string;
  stock: number;
  requires_prescription: boolean;
};

export type PrescriptionRow = {
  id: string;
  doctor_name: string;
  medical_license: string;
  issued_at: Date;
  document_url: string;
  status: 'PENDING_VALIDATION' | 'VALIDATED' | 'REJECTED';
};

export const cartWriteRepository = {
  async create(patientId: string): Promise<CartRow> {
    const sql = db();
    return sql.begin(async (tx) => {
      const [cart] = await tx<CartRow[]>`
        insert into public.carts (patient_id)
        values (${patientId})
        returning id::text, patient_id, status, updated_at
      `;
      await tx`
        insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
        values ('Cart', ${cart.id}, 'CartCreated', ${sql.json({ patientId })})
      `;
      return cart;
    });
  },

  async findById(cartId: string): Promise<CartRow | null> {
    const sql = db();
    const [cart] = await sql<CartRow[]>`
      select id::text, patient_id, status, updated_at
      from public.carts
      where id = ${Number(cartId)}
    `;
    return cart ?? null;
  },

  /**
   * Ítems del carrito con la ficha del medicamento resuelta en el mismo SELECT.
   * Es un JOIN y no N consultas: el carrito es pequeño y acotado, no necesita DataLoader.
   */
  async findItems(cartId: string): Promise<CartItemRow[]> {
    const sql = db();
    return sql<CartItemRow[]>`
      select ci.medication_id::text, ci.quantity,
             m.name, m.sku, m.dosage, m.presentation, m.price, m.stock, m.requires_prescription
      from public.cart_items ci
      join public.medications m on m.id = ci.medication_id
      where ci.cart_id = ${Number(cartId)}
      order by ci.added_at asc
    `;
  },

  async findPrescription(cartId: string): Promise<PrescriptionRow | null> {
    const sql = db();
    const [row] = await sql<PrescriptionRow[]>`
      select id::text, doctor_name, medical_license, issued_at, document_url, status
      from public.prescriptions
      where cart_id = ${Number(cartId)}
      order by created_at desc
      limit 1
    `;
    return row ?? null;
  },

  /** Agrega o acumula cantidad. `on conflict` hace el upsert en un solo viaje. */
  async addItem(cartId: string, medicationId: string, quantity: number): Promise<void> {
    const sql = db();
    await sql.begin(async (tx) => {
      await tx`
        insert into public.cart_items (cart_id, medication_id, quantity)
        values (${Number(cartId)}, ${Number(medicationId)}, ${quantity})
        on conflict (cart_id, medication_id)
        do update set quantity = public.cart_items.quantity + excluded.quantity
      `;
      await tx`update public.carts set updated_at = now() where id = ${Number(cartId)}`;
      await tx`
        insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
        values ('Cart', ${cartId}, 'MedicationAddedToCart',
                ${sql.json({ medicationId, quantity })})
      `;
    });
  },

  async removeItem(cartId: string, medicationId: string): Promise<void> {
    const sql = db();
    await sql`
      delete from public.cart_items
      where cart_id = ${Number(cartId)} and medication_id = ${Number(medicationId)}
    `;
    await sql`update public.carts set updated_at = now() where id = ${Number(cartId)}`;
  },

  async attachPrescription(
    cartId: string,
    input: { doctorName: string; medicalLicense: string; issuedAt: string; documentUrl: string },
  ): Promise<void> {
    const sql = db();
    await sql.begin(async (tx) => {
      // Una sola receta vigente por carrito: adjuntar de nuevo reemplaza la anterior.
      await tx`delete from public.prescriptions where cart_id = ${Number(cartId)}`;
      await tx`
        insert into public.prescriptions (cart_id, doctor_name, medical_license, issued_at, document_url)
        values (${Number(cartId)}, ${input.doctorName}, ${input.medicalLicense},
                ${input.issuedAt}, ${input.documentUrl})
      `;
      await tx`update public.carts set updated_at = now() where id = ${Number(cartId)}`;
      await tx`
        insert into public.domain_events (aggregate_type, aggregate_id, event_type, payload)
        values ('Cart', ${cartId}, 'PrescriptionAttached',
                ${sql.json({ medicalLicense: input.medicalLicense })})
      `;
    });
  },
};
