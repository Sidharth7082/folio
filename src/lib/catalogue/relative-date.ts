/**
 * Date helpers for RanobeDB release dates.
 *
 * RanobeDB stores dates as `YYYYMMDD` integers, with 99999999 meaning "unset".
 * Everything here is pure and UTC-based so a server and a browser agree on
 * which day it is.
 */

const MS_PER_DAY = 86_400_000;
const UNSET = 99999999;

/** Parse a `YYYYMMDD` integer into a UTC date, or null when unset/invalid. */
export function parseYmd(value: number | null | undefined): Date | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 10000101 || value >= UNSET) return null;

  const text = String(value);
  const year = Number(text.slice(0, 4));
  const month = Number(text.slice(4, 6));
  const day = Number(text.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  return new Date(Date.UTC(year, month - 1, day));
}

/** Whole days from `from` to `to`; positive when `to` is later. */
export function daysBetween(from: Date, to: Date): number {
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.round((end - start) / MS_PER_DAY);
}

/** `YYYY-MM-DD` for an API filter, in UTC. */
export function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

/**
 * Human label for a release date relative to `now`: "Today", "Tomorrow",
 * "In 5 days", "3 days ago", or a month count for anything further out.
 * Returns an empty string for unset or invalid dates.
 */
export function formatRelativeRelease(value: number, now: Date): string {
  const date = parseYmd(value);
  if (!date) return "";

  const diff = daysBetween(now, date);

  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";

  if (diff > 1) {
    if (diff <= 45) return `In ${diff} days`;
    return `In ${Math.round(diff / 30)} months`;
  }

  const past = Math.abs(diff);
  if (past <= 45) return `${past} days ago`;
  return `${Math.round(past / 30)} months ago`;
}

/** Short, locale-neutral display form, e.g. "2026-10-14". */
export function formatIsoDate(value: number | null | undefined): string | null {
  const date = parseYmd(value);
  return date ? toIsoDate(date) : null;
}
