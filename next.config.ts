import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
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
