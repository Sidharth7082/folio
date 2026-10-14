import type { NextConfig } from "next";

/**
 * Set only by `scripts/package.mjs`.
 *
 * A standalone build is what lets a downloaded copy run without `npm install`,
 * but it also makes the ordinary `next start` refuse to serve the result. Since
 * that is the command used day to day, packaging is opt-in rather than always on.
 */
const PACKAGING = process.env.FOLIO_PACKAGE === "1";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Emit a self-contained server in .next/standalone, with the parts of
  // node_modules it actually uses.
  output: PACKAGING ? "standalone" : undefined,
  // The library and the catalogues are the operator's data, not part of the app.
  // They are read at run time from FOLIO_HOME, and Turbopack otherwise resolves
  // `process.cwd()` at build time, finds these folders, and bakes every book and
  // both databases into the build. A packaged copy should carry the code; the
  // books arrive afterwards.
  outputFileTracingExcludes: {
    "*": ["content/**/*", "data/**/*", "public/covers/**/*"],
  },
  // adm-zip is a CommonJS package required at request time by the import route.
  // Keeping it out of the bundle avoids Turbopack trying to trace its internals.
  serverExternalPackages: ["adm-zip"],
  images: {
    // Covers are operator-supplied local assets (often SVG). Serving them
    // as-is avoids a native image-processing dependency for this local app.
    unoptimized: true,
    dangerouslyAllowSVG: true,
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
