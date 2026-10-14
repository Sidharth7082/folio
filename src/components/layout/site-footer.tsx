export function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted">
        <p className="font-medium text-ink">Folio</p>
        <p>
          A self-hosted reading room. Content is supplied by the operator and must be
          either their own work, a licensed translation, or in the public domain.
        </p>
      </div>
    </footer>
  );
}
