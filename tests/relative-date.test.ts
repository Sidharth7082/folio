/**
 * Tests for the RanobeDB date helpers used by the release rails.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addDays,
  daysBetween,
  formatIsoDate,
  formatRelativeRelease,
  parseYmd,
  toIsoDate,
} from "../src/lib/catalogue/relative-date.ts";

/** Fixed "now" so relative labels are deterministic. */
const NOW = new Date(Date.UTC(2026, 9, 14)); // 2026-10-14
const ymd = (date: Date) =>
  Number(`${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`);

describe("parseYmd", () => {
  it("parses a YYYYMMDD integer into a UTC date", () => {
    assert.equal(parseYmd(20261014)?.toISOString(), "2026-10-14T00:00:00.000Z");
  });

  it("rejects the unset sentinel, zero and non-numbers", () => {
    assert.equal(parseYmd(99999999), null);
    assert.equal(parseYmd(0), null);
    assert.equal(parseYmd(null), null);
    assert.equal(parseYmd(undefined), null);
    assert.equal(parseYmd(Number.NaN), null);
  });

  it("rejects impossible months and days", () => {
    assert.equal(parseYmd(20261301), null);
    assert.equal(parseYmd(20261032), null);
    assert.equal(parseYmd(20260010), null);
  });
});

describe("toIsoDate / addDays / daysBetween", () => {
  it("formats an ISO date in UTC", () => {
    assert.equal(toIsoDate(NOW), "2026-10-14");
  });

  it("adds and subtracts whole days", () => {
    assert.equal(toIsoDate(addDays(NOW, 1)), "2026-10-15");
    assert.equal(toIsoDate(addDays(NOW, -1)), "2026-10-13");
  });

  it("crosses month boundaries", () => {
    assert.equal(toIsoDate(addDays(NOW, 20)), "2026-11-03");
    assert.equal(toIsoDate(addDays(NOW, -20)), "2026-09-24");
  });

  it("measures whole days, ignoring time of day", () => {
    assert.equal(daysBetween(NOW, addDays(NOW, 3)), 3);
    assert.equal(daysBetween(NOW, addDays(NOW, -3)), -3);
    assert.equal(daysBetween(NOW, NOW), 0);
  });
});

describe("formatRelativeRelease", () => {
  it("labels today, tomorrow and yesterday", () => {
    assert.equal(formatRelativeRelease(ymd(NOW), NOW), "Today");
    assert.equal(formatRelativeRelease(ymd(addDays(NOW, 1)), NOW), "Tomorrow");
    assert.equal(formatRelativeRelease(ymd(addDays(NOW, -1)), NOW), "Yesterday");
  });

  it("labels near-future and near-past releases in days", () => {
    assert.equal(formatRelativeRelease(ymd(addDays(NOW, 5)), NOW), "In 5 days");
    assert.equal(formatRelativeRelease(ymd(addDays(NOW, -5)), NOW), "5 days ago");
  });

  it("switches to months beyond 45 days", () => {
    assert.equal(formatRelativeRelease(ymd(addDays(NOW, 45)), NOW), "In 45 days");
    assert.equal(formatRelativeRelease(ymd(addDays(NOW, 46)), NOW), "In 2 months");
    assert.equal(formatRelativeRelease(ymd(addDays(NOW, -46)), NOW), "2 months ago");
  });

  it("returns an empty label for unusable dates", () => {
    assert.equal(formatRelativeRelease(99999999, NOW), "");
    assert.equal(formatRelativeRelease(0, NOW), "");
  });
});

describe("formatIsoDate", () => {
  it("renders a display date", () => {
    assert.equal(formatIsoDate(20261014), "2026-10-14");
  });

  it("returns null for unusable dates", () => {
    assert.equal(formatIsoDate(99999999), null);
    assert.equal(formatIsoDate(null), null);
  });
});
