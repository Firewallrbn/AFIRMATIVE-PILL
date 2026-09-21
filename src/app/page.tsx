import Image from 'next/image';
import Link from 'next/link';
import { Catalog } from '@/components/catalog';

/**
 * Portada.
 *
 * El hero es un Server Component estático: no pide datos, así que se prerenderiza y
 * aparece instantáneo. El catálogo, que sí consulta GraphQL, es el Client Component de
 * abajo. Esa división es intencional — la primera pintura no espera a la red.
 */

const TRUST = [
  { value: '50', label: 'medicamentos en catálogo' },
  { value: '100%', label: 'de las fórmulas médicas verificadas' },
  { value: 'Tiempo real', label: 'seguimiento de cada pedido' },
];

export default function HomePage() {
  return (
    <>
      <section className="relative isolate overflow-hidden bg-ink">
        <Image
          src="/hero-clinica.jpeg"
          alt="Personal médico atendiendo a una paciente en una habitación de hospital"
          fill
          priority
          sizes="100vw"
          className="object-cover object-center opacity-70"
        />
        {/* Degradado desde la izquierda: sostiene el contraste del texto sin apagar la
            foto, que es lo que transmite el "hay gente de verdad detrás". */}
        <div className="absolute inset-0 bg-gradient-to-r from-ink via-ink/75 to-ink/10" />

        <div className="relative mx-auto flex min-h-[560px] max-w-6xl flex-col justify-center px-5 py-20">
          <p className="flex items-center gap-3 text-[13px] font-semibold uppercase tracking-[0.18em] text-white/75">
            <span className="h-px w-10 bg-white/50" />
            Farmacia en línea regulada
          </p>

          <h1 className="mt-5 max-w-3xl text-[44px] font-bold leading-[1.05] tracking-tight text-white sm:text-[62px]">
            Tu tratamiento,
            <br />
            sin filas y con respaldo.
          </h1>

          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-white/80">
            Buscá entre medicamentos de venta libre y de control especial. Nosotros
            verificamos tu fórmula médica, reservamos el inventario y te mostramos cada
            cambio del pedido en el momento en que ocurre.
          </p>

          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="#catalogo"
              className="inline-flex items-center gap-2 rounded-full bg-brand px-7 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-brand-dark"
            >
              Ver catálogo
              <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" fill="none">
                <path d="M4 12 12 4M12 4H5.5M12 4v6.5" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </Link>
            <Link
              href="/ordenes"
              className="inline-flex items-center rounded-full border border-white/35 px-7 py-3.5 text-[15px] font-semibold text-white transition-colors hover:bg-white/10"
            >
              Seguir mi pedido
            </Link>
          </div>

          <dl className="mt-14 flex flex-wrap gap-x-12 gap-y-5 border-t border-white/15 pt-7">
            {TRUST.map((item) => (
              <div key={item.label}>
                <dt className="text-[22px] font-bold text-white">{item.value}</dt>
                <dd className="text-[13px] text-white/65">{item.label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <Catalog />
    </>
  );
}
