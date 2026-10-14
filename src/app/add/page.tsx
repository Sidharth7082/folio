import type { Metadata } from "next";

import { ImportPanel } from "@/components/import/import-panel";

export const metadata: Metadata = {
  title: "Add books",
  description: "Import an EPUB, TXT or Markdown file into your library.",
};

export default function AddPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 pb-16">
      <h1 className="pt-10 text-3xl font-semibold tracking-tight">Add books</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        Import a file you already have — an EPUB, or a plain text or Markdown manuscript. The text
        is written into <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">content/</code>{" "}
        and the cover into{" "}
        <code className="rounded bg-surface-2 px-1.5 py-0.5 text-xs">public/covers/</code>, both on
        this machine. Nothing is sent anywhere else, and nothing is fetched from the internet.
      </p>
      <ImportPanel />
    </div>
  );
}
