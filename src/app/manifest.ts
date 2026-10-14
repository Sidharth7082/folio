import type { MetadataRoute } from "next";

/**
 * The install manifest, which is what turns the reading room into something a
 * phone can keep on its home screen.
 *
 * Next serves this at `/manifest.webmanifest` and links it from every page, so
 * there is no static file to keep in step.
 *
 * Deliberately no `orientation`: a novel reads fine in landscape on a tablet,
 * and locking rotation is a worse experience than the layout it protects.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Folio — reading room",
    short_name: "Folio",
    description:
      "A self-hosted light-novel reading room: browse, read, and track your place.",
    // A stable identity, so installing over an older build updates the existing
    // icon rather than adding a second one.
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#0c0e13",
    theme_color: "#0c0e13",
    categories: ["books", "education", "entertainment"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        // Padded artwork with a full-bleed background, because Android crops
        // this one to whatever shape the launcher uses.
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
