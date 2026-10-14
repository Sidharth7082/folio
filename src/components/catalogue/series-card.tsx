import Image from "next/image";
import Link from "next/link";

/** RanobeDB dates are `YYYYMMDD` integers; 99999999 means "unset". */
export function formatCatalogueDate(value: number | null | undefined): string | null {
  if (value === null || value === undefined || value < 10000101) return null;
  const text = String(value);
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}

export function formatCatalogueYear(value: number | null | undefined): string | null {
  const formatted = formatCatalogueDate(value);
  return formatted ? formatted.slice(0, 4) : null;
}

interface SeriesCardProps {
  id: number;
  title: string;
  authors?: string[];
  numBooks?: number;
  status?: string;
  startDate?: number | null;
  coverFilename?: string | null;
  /** Covers flagged NSFW are never displayed. */
  showCover?: boolean;
}

export function SeriesCard({
  id,
  title,
  authors = [],
  numBooks = 0,
  status = "",
  startDate = null,
  coverFilename = null,
  showCover = true,
}: SeriesCardProps) {
  const year = formatCatalogueYear(startDate);
  const cover = showCover && coverFilename ? `/api/cover/${coverFilename}` : null;

  return (
    <Link
      href={`/catalogue/${id}`}
      className="group flex flex-col gap-3 rounded-xl focus-visible:outline-none"
    >
      <div className="relative grid aspect-2/3 w-full place-items-center overflow-hidden rounded-xl border border-line bg-surface-2 p-3 text-center shadow-[var(--shadow)]">
        {/* Always rendered, so it shows through if a cover fails to load. */}
        <span className="line-clamp-4 font-serif text-base leading-snug text-muted">{title}</span>

        {cover ? (
          <Image
            src={cover}
            alt=""
            fill
            sizes="(max-width: 640px) 45vw, 200px"
            loading="lazy"
            className="absolute inset-0 object-cover transition-transform duration-500 group-hover:scale-[1.03]"
          />
        ) : null}

        {status === "ongoing" ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            Ongoing
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-5 group-hover:text-accent">{title}</p>
        {/* No placeholder: the API list has no author data, and "Unknown author"
            on every card would read worse than no line at all. */}
        {authors.length > 0 ? (
          <p className="truncate text-xs text-muted">{authors.join(", ")}</p>
        ) : null}
        <p className="mt-0.5 truncate text-xs text-muted">
          {numBooks > 0 ? `${numBooks} book${numBooks === 1 ? "" : "s"}` : "—"}
          {year ? ` · ${year}` : ""}
        </p>
      </div>
    </Link>
  );
}
