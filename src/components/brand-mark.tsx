import { useId } from 'react';

/**
 * Isotipo de Afirmative Pill: cápsula partida en diagonal dentro de un sello.
 * La mitad sólida es el medicamento; la mitad traslúcida lleva el check de la
 * fórmula verificada — lo "afirmativo" de la marca. Mismo dibujo que `app/icon.svg`.
 */
export function BrandMark({ size = 32 }: { size?: number }) {
  const gradientId = useId();

  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2d6bff" />
          <stop offset="1" stopColor="#0d3bb0" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${gradientId})`} />
      <g transform="rotate(-45 16 16)">
        <path d="M15.3 10.5H10.5a5.5 5.5 0 0 0 0 11h4.8z" fill="#fff" />
        <path
          d="M16.7 10.5h4.8a5.5 5.5 0 0 1 0 11h-4.8z"
          fill="#fff"
          fillOpacity=".22"
          stroke="#fff"
          strokeWidth="1.4"
        />
      </g>
      <path
        d="M17.3 13.4l1.7 1.7 3.3-3.6"
        fill="none"
        stroke="#fff"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
