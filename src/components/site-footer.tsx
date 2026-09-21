export function SiteFooter() {
  return (
    <footer className="border-t border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 py-8 text-sm text-muted md:flex-row md:items-center md:justify-between">
        <p>
          Afirmative Pill · Proyecto académico de arquitectura GraphQL + CQRS.
          <span className="hidden sm:inline"> Los datos clínicos son de demostración.</span>
        </p>
        <p className="font-medium text-ink-soft">
          Todo el tráfico de esta aplicación cursa por <code className="font-mono">/graphql</code>
        </p>
      </div>
    </footer>
  );
}
