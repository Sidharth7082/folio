"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface ImportedBook {
  slug: string;
  title: string;
  chapterCount: number;
  url: string;
}

interface InboxInfo {
  dir: string;
  exists: boolean;
  hint: string;
}

interface ScanResponse {
  ok: boolean;
  message?: string;
  folder?: string;
  scanned?: number;
  imported?: ImportedBook[];
  skipped?: string[];
  failed?: { file: string; message: string }[];
  truncated?: boolean;
}

function plural(count: number, word: string) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function ImportPanel() {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [books, setBooks] = useState<ImportedBook[]>([]);
  const [overwrite, setOverwrite] = useState(false);
  const [inbox, setInbox] = useState<InboxInfo | null>(null);
  const [scanNotes, setScanNotes] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/import/scan")
      .then((response) => response.json())
      .then((data: { inbox?: InboxInfo }) => {
        if (!cancelled && data.inbox) setInbox(data.inbox);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        const body = new FormData();
        body.append("file", file);
        if (overwrite) body.append("overwrite", "true");

        const response = await fetch("/api/import", { method: "POST", body });
        const data = (await response.json()) as ImportedBook & { ok: boolean; message?: string };

        if (!response.ok || !data.ok) {
          setError(data.message ?? "That file could not be imported.");
          return;
        }
        setBooks([data]);
        setNotice(`Imported “${data.title}” — ${plural(data.chapterCount, "chapter")}.`);
      } catch {
        setError("Could not reach the server. Is it still running?");
      } finally {
        setBusy(false);
      }
    },
    [overwrite],
  );

  const scan = useCallback(async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setScanNotes([]);
    try {
      const response = await fetch("/api/import/scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ overwrite }),
      });
      const data = (await response.json()) as ScanResponse;

      if (!response.ok || !data.ok) {
        setError(data.message ?? "Could not import from that folder.");
        return;
      }

      setBooks(data.imported ?? []);
      const notes: string[] = [];
      notes.push(`Looked in ${data.folder} — found ${plural(data.scanned ?? 0, "book")}.`);
      if ((data.skipped ?? []).length > 0) {
        notes.push(`Already in your library: ${data.skipped?.join(", ")}.`);
      }
      for (const failure of data.failed ?? []) {
        notes.push(`Could not read ${failure.file}: ${failure.message}`);
      }
      if (data.truncated) notes.push("There were more files than one import handles; run it again.");
      setScanNotes(notes);
      setNotice(
        (data.imported ?? []).length > 0
          ? `Imported ${plural((data.imported ?? []).length, "book")}.`
          : "Nothing new to import.",
      );
    } catch {
      setError("Could not reach the server. Is it still running?");
    } finally {
      setBusy(false);
    }
  }, [overwrite]);

  return (
    <div className="mt-8">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void upload(file);
        }}
        className={`rounded-2xl border-2 border-dashed p-10 text-center transition-colors ${
          dragging ? "border-accent bg-accent-soft" : "border-line bg-surface"
        }`}
      >
        <p className="text-sm font-medium">
          {busy ? "Importing…" : "Drag an .epub, .txt or .md file here"}
        </p>
        <p className="mt-1 text-xs text-muted">or</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="mt-3 rounded-full border border-line bg-surface-2 px-4 py-2 text-sm transition-colors hover:border-line-strong disabled:opacity-50"
        >
          Choose a file
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".epub,.txt,.md"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void upload(file);
            event.target.value = "";
          }}
        />
        <label className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={overwrite}
            onChange={(event) => setOverwrite(event.target.checked)}
          />
          Replace a book that is already in the library
        </label>
      </div>

      {error ? (
        <p className="mt-5 rounded-xl border border-line bg-surface p-4 text-sm text-ink">{error}</p>
      ) : null}

      {notice ? <p className="mt-5 text-sm text-muted">{notice}</p> : null}

      {books.length > 0 ? (
        <ul className="mt-4 space-y-2">
          {books.map((book) => (
            <li key={book.slug}>
              <Link
                href={book.url}
                className="flex items-baseline justify-between gap-4 rounded-xl border border-line bg-surface p-4 text-sm transition-colors hover:border-line-strong"
              >
                <span className="min-w-0 truncate">{book.title}</span>
                <span className="shrink-0 text-xs text-muted">
                  {plural(book.chapterCount, "chapter")} →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}

      {scanNotes.length > 0 ? (
        <ul className="mt-4 space-y-1 text-xs text-muted">
          {scanNotes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {inbox ? (
        <section className="mt-10 rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
            Import a folder
          </h2>
          <p className="mt-3 text-sm leading-6">
            Put your books in this folder and press the button. Subfolders are included.
          </p>
          <p className="mt-2 break-all font-mono text-xs text-muted">{inbox.dir}</p>
          <p className="mt-2 text-xs text-muted">{inbox.hint}</p>
          <button
            type="button"
            disabled={busy || !inbox.exists}
            onClick={() => void scan()}
            className="mt-4 rounded-full border border-line bg-surface-2 px-4 py-2 text-sm transition-colors hover:border-line-strong disabled:opacity-50"
          >
            Import from this folder
          </button>
        </section>
      ) : null}
    </div>
  );
}
