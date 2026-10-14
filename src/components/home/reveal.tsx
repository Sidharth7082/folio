"use client";

import { useEffect, useRef, useState } from "react";

interface RevealProps {
  children: React.ReactNode;
  /** Stagger in ms, applied as the transition delay. */
  delay?: number;
  className?: string;
}

/**
 * Fades and lifts its children into view once, when they first intersect.
 *
 * Content is hidden by CSS (`.reveal`) but a `@media (scripting: none)` rule
 * keeps it visible without JavaScript, and `prefers-reduced-motion` disables
 * the movement entirely.
 */
export function Reveal({ children, delay = 0, className = "" }: RevealProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const found: HTMLDivElement | null = ref.current;
    if (found === null) return;
    // Bound to a fresh non-nullable name so the closures below keep the type.
    const node: HTMLDivElement = found;

    // No observer (very old browser): reveal on the next frame rather than
    // synchronously, which would cascade a render during the effect.
    if (typeof IntersectionObserver === "undefined") {
      const frame = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(frame);
    }

    let revealed = false;
    let observer: IntersectionObserver | null = null;

    function reveal() {
      if (revealed) return;
      revealed = true;
      setVisible(true);
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
    }

    /**
     * Safety net. A fast scroll (wheel fling, End key, restored position) can
     * jump a section from "below the fold" to "above it" without any reported
     * intersection, which would leave it invisible forever. Checking bounding
     * rects on scroll guarantees anything at or past the fold gets revealed.
     */
    function onScroll() {
      if (revealed) return;
      if (node.getBoundingClientRect().top < window.innerHeight * 0.95) reveal();
    }

    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) reveal();
        }
      },
      { rootMargin: "0px 0px -10% 0px", threshold: 0.05 },
    );

    observer.observe(node);
    window.addEventListener("scroll", onScroll, { passive: true });
    // Catches a deep link or a restored scroll position on first paint.
    const frame = requestAnimationFrame(onScroll);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div
      ref={ref}
      className={`reveal${visible ? " is-visible" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--delay": `${delay}ms` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}
