import Image from "next/image";

import { formatIsoDate, formatRelativeRelease } from "@/lib/catalogue/relative-date";
import type { ApiReleaseView } from "@/lib/catalogue/ranobedb-api";

/** RanobeDB language codes mapped to display names. */
const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  ja: "Japanese",
  de: "German",
  fr: "French",
  es: "Spanish",
  it: "Italian",
  pt: "Portuguese",
  "pt-br": "Portuguese (BR)",
  nl: "Dutch",
  sv: "Swedish",
  da: "Danish",
  fi: "Finnish",
  no: "Norwegian",
  pl: "Polish",
  cs: "Czech",
  sk: "Slovak",
  sl: "Slovenian",
  hr: "Croatian",
  sr: "Serbian",
  bg: "Bulgarian",
  ro: "Romanian",
  hu: "Hungarian",
  el: "Greek",
  ru: "Russian",
  uk: "Ukrainian",
  tr: "Turkish",
  ar: "Arabic",
  he: "Hebrew",
  fa: "Persian",
  hi: "Hindi",
  ta: "Tamil",
  ur: "Urdu",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  ko: "Korean",
  "zh-Hans": "Chinese (S.)",
  "zh-Hant": "Chinese (T.)",
  la: "Latin",
  eo: "Esperanto",
  ca: "Catalan",
  eu: "Basque",
  ga: "Irish",
  gd: "Scottish Gaelic",
  cy: "Welsh",
  is: "Icelandic",
  sq: "Albanian",
  lt: "Lithuanian",
  lv: "Latvian",
  et: "Estonian",
  mk: "Macedonian",
};

export function languageLabel(code: string): string {
  return LANGUAGE_LABEL[code] ?? code;
}

interface ReleaseCardProps {
  release: ApiReleaseView;
  /** Server render time, used for the "in N days" label. */
  now: Date;
}

/**
 * One print/digital/audio release.
 *
 * Links out to the publisher page when RanobeDB has one — releases have no
 * detail page of their own, and inventing one would be a dead end.
 */
export function ReleaseCard({ release, now }: ReleaseCardProps) {
  const cover = release.coverIsNsfw ? null : release.coverFilename;
  const relative = formatRelativeRelease(release.releaseDate, now);
  const iso = release.releaseDateParsed ?? formatIsoDate(release.releaseDate);

  const body = (
    <>
      <div className="lift relative aspect-2/3 w-full overflow-hidden rounded-xl border border-line bg-surface-2 shadow-[var(--shadow)]">
        {cover ? (
          <Image
            src={`/api/cover/${cover}`}
            alt=""
            fill
            sizes="176px"
            loading="lazy"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.06]"
          />
        ) : (
          <span className="grid h-full w-full place-items-center p-3 text-center font-serif text-sm leading-snug text-muted">
            {release.title}
          </span>
        )}

        {relative ? (
          <span className="absolute left-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
            {relative}
          </span>
        ) : null}
      </div>

      <div className="min-w-0">
        <p className="line-clamp-2 text-sm font-semibold leading-5 transition-colors duration-300 group-hover:text-accent">
          {release.title}
        </p>

        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">
            {languageLabel(release.lang)}
          </span>
          <span className="rounded-full border border-line px-2 py-0.5 text-[11px] capitalize text-muted">
            {release.format}
          </span>
        </div>

        {iso ? (
          <p className="mt-1 text-[11px] tabular-nums text-muted">{iso}</p>
        ) : null}
      </div>
    </>
  );

  if (release.website) {
    return (
      <a
        href={release.website}
        target="_blank"
        rel="noreferrer noopener"
        className="group flex flex-col gap-3 focus-visible:outline-none"
      >
        {body}
      </a>
    );
  }

  return <div className="group flex flex-col gap-3">{body}</div>;
}
