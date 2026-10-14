import Link from "next/link";

import type { Novel } from "@/lib/content/types";
import { NovelCard } from "@/components/catalog/novel-card";

interface NovelGridProps {
  novels: Novel[];
  priorityCount?: number;
}

export function NovelGrid({ novels, priorityCount = 0 }: NovelGridProps) {
  return (
    <div className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
      {novels.map((novel, index) => (
        <NovelCard key={novel.slug} novel={novel} priority={index < priorityCount} />
      ))}
    </div>
  );
}

interface SectionRowProps {
  title: string;
  /** Optional supporting line under the heading. */
  kicker?: string;
  href?: string;
  className?: string;
  children: React.ReactNode;
}

export function SectionRow({ title, kicker, href, className = "", children }: SectionRowProps) {
  return (
    <section className={`mt-16${className ? ` ${className}` : ""}`}>
      <div className="mb-6">
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
            {kicker ? <p className="mt-1.5 text-sm text-muted">{kicker}</p> : null}
          </div>

          {href ? (
            <Link
              href={href}
              className="group/all inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-accent"
            >
              View all
              <span
                aria-hidden
                className="transition-transform duration-300 group-hover/all:translate-x-1"
              >
                →
              </span>
            </Link>
          ) : null}
        </div>

        <span
          aria-hidden
          className="rule-grow mt-4 block h-px w-full bg-gradient-to-r from-accent/50 via-line to-transparent"
        />
      </div>

      {children}
    </section>
  );
}
