import Link from "next/link";

interface GenreChipsProps {
  genres: { tag: string; slug: string; count: number }[];
  activeSlug?: string;
}

const chipBase =
  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap";

export function GenreChips({ genres, activeSlug }: GenreChipsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {genres.map((genre) => {
        const active = genre.slug === activeSlug;
        return (
          <Link
            key={genre.slug}
            href={`/genre/${genre.slug}`}
            aria-current={active ? "page" : undefined}
            className={[
              chipBase,
              active
                ? "border-accent bg-accent text-accent-ink"
                : "border-line bg-surface text-muted hover:border-line-strong hover:text-ink",
            ].join(" ")}
          >
            {genre.tag}
            <span className={active ? "ml-1.5 opacity-70" : "ml-1.5 opacity-50"}>
              {genre.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
