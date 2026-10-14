import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-start px-5 py-24">
      <p className="text-sm font-semibold uppercase tracking-widest text-muted">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">
        That page is not in the library
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        The novel or chapter you asked for does not exist. It may have been renamed, or the
        content folder may not have been added yet.
      </p>
      <div className="mt-8 flex gap-3">
        <Link
          href="/"
          className="rounded-lg bg-accent px-5 py-2.5 text-sm font-semibold text-accent-ink transition-opacity hover:opacity-90"
        >
          Back to home
        </Link>
        <Link
          href="/browse"
          className="rounded-lg border border-line-strong px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-2"
        >
          Browse everything
        </Link>
      </div>
    </div>
  );
}
