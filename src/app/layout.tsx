import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import './globals.css';
import { ApolloWrapper } from '@/lib/apollo/ApolloWrapper';
import { CartProvider } from '@/lib/cart-context';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'Afirmative Pill — Farmacia en línea',
  description:
    'Catálogo de medicamentos con validación de fórmula médica y seguimiento de pedidos en tiempo real.',
};

/**
 * Raíz de la aplicación.
 *
 * `ApolloWrapper` envuelve absolutamente todo: es el árbol de contexto de Apollo que
 * pide el enunciado. `CartProvider` va por dentro porque necesita hooks de Apollo para
 * hablar con el servidor — el carrito no se guarda en el navegador, se consulta.
 */
export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="es" className={`${geistSans.variable} h-full`} suppressHydrationWarning>
      {/*
        `suppressHydrationWarning` acotado a <html> y <body>: varias extensiones de
        navegador (ColorZilla, QuillBot, gestores de contraseñas, traductores) inyectan
        atributos como `cz-shortcut-listen` o `data-qb-installed` en esos nodos ANTES de
        que React hidrate, y eso dispara un error de hidratación que no viene de nuestro
        código y que no podemos evitar. Solo silencia los atributos de estos dos nodos:
        cualquier desajuste real dentro del árbol se sigue reportando.
      */}
      <body className="flex min-h-full flex-col" suppressHydrationWarning>
        <ApolloWrapper>
          <CartProvider>
            <SiteHeader />
            <main className="flex-1">{children}</main>
            <SiteFooter />
          </CartProvider>
        </ApolloWrapper>
      </body>
    </html>
  );
}
