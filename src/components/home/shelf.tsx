interface ShelfProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Horizontal, snapping scroll shelf. Uses native overflow scrolling, so it
 * works with trackpads, wheels, touch and the keyboard without extra JavaScript.
 * Bleeds to the viewport edge so cards can run off-screen.
 */
export function Shelf({ children, className = "" }: ShelfProps) {
  return (
    <div className={`-mx-5 px-5 ${className}`}>
      <div className="shelf shelf-fade flex gap-5 overflow-x-auto pb-4">{children}</div>
    </div>
  );
}

/** Fixed-width wrapper so shelf children snap consistently. */
export function ShelfItem({ children }: { children: React.ReactNode }) {
  return <div className="w-[9.5rem] shrink-0 sm:w-[11rem]">{children}</div>;
}
