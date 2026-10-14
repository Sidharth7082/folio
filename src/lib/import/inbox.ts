import { existsSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Where the reader looks for books to pick up.
 *
 * The path is server-configured only — it is never taken from a request. A
 * client-supplied directory would turn the scan endpoint into a way to walk
 * someone else's filesystem from across the network, and there is no version of
 * that worth having for a personal reader.
 */
export const DEFAULT_INBOX_DIR = path.join(os.homedir(), "Documents", "lightnovel");

/** The configured inbox folder, absolute. */
export function resolveInboxDir(): string {
  const configured = process.env.NOVEL_READER_INBOX_DIR;
  return configured ? path.resolve(configured) : DEFAULT_INBOX_DIR;
}

export interface InboxStatus {
  dir: string;
  exists: boolean;
  /** A short, non-technical hint shown in the UI. */
  hint: string;
}

export function inboxStatus(): InboxStatus {
  const dir = resolveInboxDir();
  const exists = existsSync(dir) && statSync(dir).isDirectory();

  return {
    dir,
    exists,
    hint: exists
      ? "Drop .epub, .txt or .md files here and press Import."
      : "This folder does not exist yet. Create it, or set NOVEL_READER_INBOX_DIR to point somewhere else.",
  };
}
