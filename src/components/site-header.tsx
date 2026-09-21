'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCart } from '@/lib/cart-context';

const NAV = [
  { href: '/', label: 'Catálogo' },
  { href: '/ordenes', label: 'Mis pedidos' },
];

function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      {/* Cápsula partida: mitad sólida, mitad contorno. La cruz sanitaria está
          implícita en el cruce de los dos cuerpos, sin recurrir al cliché del ícono. */}
      <svg width="30" height="30" viewBox="0 0 30 30" aria-hidden="true">
        <rect x="2" y="9" width="17" height="12" rx="6" fill="var(--color-brand)" />
        <rect
          x="11"
          y="9"
          width="17"
          height="12"
          rx="6"
          fill="none"
          stroke="var(--color-brand-dark)"
          strokeWidth="2.2"
        />
      </svg>
      <span className="text-[19px] font-bold tracking-tight text-ink">
        Afirmative<span className="text-brand"> Pill</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  const pathname = usePathname();
  const { itemCount } = useCart();

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-6 px-5">
        <Link href="/" aria-label="Afirmative Pill — inicio">
          <Logo />
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-[15px] transition-colors ${
                  active ? 'font-semibold text-ink' : 'text-ink-soft hover:text-ink'
                }`}
                aria-current={active ? 'page' : undefined}
              >
                {item.label}
                {active ? <span className="mt-1 block h-0.5 rounded bg-brand" /> : null}
              </Link>
            );
          })}
        </nav>

        <Link
          href="/carrito"
          className="inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
        >
          Mi carrito
          <span
            className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-white/25 px-1.5 text-xs font-bold tabular-nums"
            aria-label={`${itemCount} ítems en el carrito`}
          >
            {itemCount}
          </span>
        </Link>
      </div>
    </header>
  );
}
