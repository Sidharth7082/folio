import Image from "next/image";

interface CoverProps {
  src: string | null;
  title: string;
  sizes?: string;
  priority?: boolean;
}

/**
 * Novel cover art. Falls back to a typographic placeholder when the novel has
 * no cover, so cards stay aligned in the grid.
 */
export function Cover({ src, title, sizes = "(max-width: 640px) 45vw, 200px", priority }: CoverProps) {
  if (!src) {
    return (
      <div className="grid h-full w-full place-items-center bg-surface-2 px-3 text-center">
        <span className="line-clamp-4 font-serif text-xl leading-snug text-muted">{title}</span>
      </div>
    );
  }

  return (
    <>
      <Image
        src={src}
        alt={`${title} cover`}
        fill
        sizes={sizes}
        priority={priority}
        className="object-cover transition-transform duration-700 ease-out will-change-transform group-hover:scale-[1.06]"
      />
      {/* Gloss that fades in on hover, keeping overlay labels readable. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/40 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100"
      />
    </>
  );
}
