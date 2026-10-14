import { Cover } from "@/components/catalog/cover";
import { NovelActions } from "@/components/catalog/novel-actions";
import type { NovelWithChapters } from "@/lib/content/types";

interface HeroProps {
  novel: NovelWithChapters;
  stats: { novels: number; chapters: number; genres: number };
}

const STATUS_LABEL: Record<string, string> = {
  ongoing: "Ongoing",
  completed: "Completed",
  hiatus: "Hiatus",
  stalled: "Stalled",
  cancelled: "Cancelled",
  unknown: "",
};

/**
 * Featured-novel hero.
 *
 * The ambient backdrop is the cover itself, heavily blurred and slowly
 * drifting, so the section takes on the artwork's colours without any extra
 * asset. Text enters in a stagger; the cover floats on a slow loop. Both are
 * CSS-only, so they animate on first paint with no JavaScript.
 */
export function Hero({ novel, stats }: HeroProps) {
  const status = STATUS_LABEL[novel.status] ?? "";

  return (
    <section className="animate-in-soft relative mt-8 overflow-hidden rounded-3xl border border-line bg-surface">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {novel.cover ? (
          <div
            className="drift-bg absolute -inset-32 opacity-30 blur-3xl saturate-150"
            style={{
              backgroundImage: `url(${novel.cover})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
            }}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-tr from-bg via-bg/80 to-bg/30" />
        <div className="absolute -right-20 -top-28 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute -bottom-28 -left-20 h-72 w-72 rounded-full bg-accent/10 blur-3xl" />
      </div>

      <div className="relative grid items-center gap-8 p-6 sm:p-10 lg:grid-cols-[200px_1fr]">
        <div className="animate-in justify-self-center" style={{ "--delay": "120ms" } as React.CSSProperties}>
          <div className="float-slow">
            <div className="relative aspect-2/3 w-[176px] overflow-hidden rounded-2xl border border-line bg-surface-2 shadow-[0_30px_60px_-25px_rgba(0,0,0,0.85)] transition-transform duration-500 ease-out hover:scale-[1.03] sm:w-[200px]">
              <Cover src={novel.cover} title={novel.title} sizes="200px" priority />
            </div>
          </div>
        </div>

        <div className="min-w-0">
          {novel.badges.length > 0 ? (
            <span
              className="animate-in inline-flex items-center gap-2 rounded-full border border-accent/40 bg-accent/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-accent"
              style={{ "--delay": "80ms" } as React.CSSProperties}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-accent" />
              {novel.badges[0]}
            </span>
          ) : null}

          <h1
            className="animate-in mt-4 text-balance font-serif text-4xl leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]"
            style={{ "--delay": "160ms" } as React.CSSProperties}
          >
            {novel.title}
          </h1>

          <p
            className="animate-in mt-3 text-sm text-muted"
            style={{ "--delay": "220ms" } as React.CSSProperties}
          >
            by <span className="text-ink">{novel.author}</span> · {novel.chapterCount} chapter
            {novel.chapterCount === 1 ? "" : "s"}
            {status ? ` · ${status}` : ""}
          </p>

          <p
            className="animate-in mt-5 max-w-2xl text-sm leading-7 text-muted"
            style={{ "--delay": "280ms" } as React.CSSProperties}
          >
            {novel.synopsis}
          </p>

          {novel.genres.length > 0 ? (
            <div
              className="animate-in mt-5 flex flex-wrap gap-2"
              style={{ "--delay": "340ms" } as React.CSSProperties}
            >
              {novel.genres.map((genre) => (
                <span
                  key={genre}
                  className="rounded-full border border-line bg-bg/40 px-3 py-1 text-xs text-muted backdrop-blur-sm transition-colors duration-300 hover:border-line-strong hover:text-ink"
                >
                  {genre}
                </span>
              ))}
            </div>
          ) : null}

          <div
            className="animate-in mt-7"
            style={{ "--delay": "400ms" } as React.CSSProperties}
          >
            <NovelActions novelSlug={novel.slug} chapterCount={novel.chapterCount} />
          </div>

          <dl
            className="animate-in mt-8 flex flex-wrap gap-x-10 gap-y-4 border-t border-line pt-5"
            style={{ "--delay": "480ms" } as React.CSSProperties}
          >
            <Stat label="Novels" value={stats.novels} />
            <Stat label="Chapters" value={stats.chapters} />
            <Stat label="Genres" value={stats.genres} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-[0.15em] text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums">{value.toLocaleString()}</dd>
    </div>
  );
}
