import { describe, expect, it } from 'vitest';
import {
  calculateTotal,
  canTransition,
  checkPrescription,
  checkStock,
  requiresPrescription,
  type OrderLine,
} from './invariants';

/**
 * Pruebas de las invariantes del dominio farmacéutico.
 *
 * Corren sin base de datos, sin GraphQL y sin servidor: las reglas viven en un módulo
 * puro y eso es justamente lo que las hace verificables. Si alguna de estas pruebas se
 * pone en rojo, el sistema está en condiciones de vender un medicamento que no existe o
 * de despachar un controlado sin receta.
 */

const OTC: OrderLine = {
  medicationId: '1',
  medicationName: 'Acetaminofén Forte',
  quantity: 2,
  requiresPrescription: false,
  availableStock: 120,
  unitPrice: 9500,
};

const CONTROLADO: OrderLine = {
  medicationId: '3',
  medicationName: 'Amoxicilina Clavulanato',
  quantity: 1,
  requiresPrescription: true,
  availableStock: 40,
  unitPrice: 46000,
};

const RECETA = {
  doctorName: 'Dra. Ana Restrepo',
  medicalLicense: 'RM-48213',
  issuedAt: '2026-09-14',
  documentUrl: 'https://ejemplo.test/formula.pdf',
};

describe('INVARIANTE 1 — control de prescripción', () => {
  it('deja pasar un pedido de puros medicamentos de venta libre sin receta', () => {
    expect(checkPrescription([OTC], null)).toBeNull();
  });

  it('bloquea el pedido si hay un controlado y no hay fórmula adjunta', () => {
    const error = checkPrescription([OTC, CONTROLADO], null);
    expect(error?.code).toBe('PRESCRIPTION_REQUIRED');
  });

  it('nombra exactamente qué medicamentos obligan a la receta', () => {
    const error = checkPrescription([OTC, CONTROLADO], null);
    expect(error).toMatchObject({ medicationIds: ['3'] });
  });

  it('acepta el pedido cuando la fórmula está adjunta', () => {
    expect(checkPrescription([OTC, CONTROLADO], RECETA)).toBeNull();
  });
});

describe('INVARIANTE 2 — disponibilidad de inventario', () => {
  it('no reporta nada cuando hay stock suficiente', () => {
    expect(checkStock([OTC, CONTROLADO])).toHaveLength(0);
  });

  it('reporta el faltante con la cantidad real disponible', () => {
    const [error] = checkStock([{ ...CONTROLADO, quantity: 50, availableStock: 40 }]);
    expect(error).toMatchObject({ code: 'OUT_OF_STOCK', requested: 50, available: 40 });
  });

  it('acumula TODOS los faltantes en una sola respuesta', () => {
    const errors = checkStock([
      { ...OTC, quantity: 999 },
      { ...CONTROLADO, quantity: 999 },
    ]);
    expect(errors).toHaveLength(2);
  });

  it('trata el stock exacto como suficiente, no como faltante', () => {
    expect(checkStock([{ ...OTC, quantity: 120, availableStock: 120 }])).toHaveLength(0);
  });
});

describe('cálculo del total', () => {
  it('suma precio por cantidad de cada línea', () => {
    expect(calculateTotal([OTC, CONTROLADO])).toBe(9500 * 2 + 46000);
  });

  it('un pedido vacío vale cero', () => {
    expect(calculateTotal([])).toBe(0);
  });
});

describe('ciclo de vida de la orden', () => {
  it('permite el camino feliz', () => {
    expect(canTransition('PENDING_APPROVAL', 'APPROVED')).toBe(true);
    expect(canTransition('APPROVED', 'DISPATCHED')).toBe(true);
  });

  it('no deja despachar sin validación farmacéutica previa', () => {
    expect(canTransition('PENDING_APPROVAL', 'DISPATCHED')).toBe(false);
  });

  it('no deja anular lo que ya salió de bodega', () => {
    expect(canTransition('DISPATCHED', 'CANCELLED')).toBe(false);
  });

  it('un estado terminal no vuelve atrás', () => {
    expect(canTransition('CANCELLED', 'APPROVED')).toBe(false);
  });
});

describe('detección de pedido con fórmula', () => {
  it('basta un controlado para marcar todo el pedido', () => {
    expect(requiresPrescription([OTC, CONTROLADO])).toBe(true);
    expect(requiresPrescription([OTC])).toBe(false);
  });
});
