import Link from "next/link";

import { Cover } from "@/components/catalog/cover";
import type { Novel } from "@/lib/content/types";

const STATUS_LABEL: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "Hiatus",
  unknown: "",
};

interface NovelCardProps {
  novel: Novel;
  /** Optional one-line context, e.g. "Chapter 12" for continue-reading rows. */
  footnote?: string;
  priority?: boolean;
}

export function NovelCard({ novel, footnote, priority }: NovelCardProps) {
  const status = STATUS_LABEL[novel.status] ?? "";

  return (
    <Link
      href={`/novel/${novel.slug}`}
      className="group flex flex-col gap-3 rounded-xl focus-visible:outline-none"
    >
      <div className="lift relative aspect-2/3 w-full overflow-hidden rounded-xl border border-line bg-surface-2 shadow-[var(--shadow)]">
        <Cover src={novel.cover} title={novel.title} priority={priority} />

        {novel.badges.length > 0 ? (
          <span className="absolute left-2 top-2 rounded-md bg-accent px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-accent-ink shadow-sm">
            {novel.badges[0]}
          </span>
        ) : null}

        {status ? (
          <span className="absolute bottom-2 right-2 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur-sm">
            {status}
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="truncate text-sm font-semibold leading-5 transition-colors duration-300 group-hover:text-accent">
          {novel.title}
        </p>
        <p className="truncate text-xs text-muted">{novel.author}</p>
        {footnote ? (
          <p className="mt-0.5 truncate text-xs text-accent">{footnote}</p>
        ) : null}
      </div>
    </Link>
  );
}
