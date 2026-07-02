// Human-friendly time formatting for the document library (and anywhere else that shows a timestamp).
// Uses the platform Intl APIs — no date library dependency.

const RELATIVE_FORMATTER = new Intl.RelativeTimeFormat("en", { numeric: "always" });

// Largest-unit thresholds in seconds, checked from largest to smallest.
const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: "year", seconds: 365 * 24 * 60 * 60 },
  { unit: "month", seconds: 30 * 24 * 60 * 60 },
  { unit: "week", seconds: 7 * 24 * 60 * 60 },
  { unit: "day", seconds: 24 * 60 * 60 },
  { unit: "hour", seconds: 60 * 60 },
  { unit: "minute", seconds: 60 },
];

// "3 minutes ago", "1 week ago", … Uses numeric:"always" so it reads "1 week ago" (not "last week").
// Under a minute reads "just now".
export function formatRelativeTime(ts: number, now: number = Date.now()): string {
  const deltaSeconds = Math.round((ts - now) / 1000);
  const absSeconds = Math.abs(deltaSeconds);

  if (absSeconds < 60) return "just now";

  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (absSeconds >= seconds) {
      const value = Math.round(deltaSeconds / seconds);
      return RELATIVE_FORMATTER.format(value, unit);
    }
  }

  return "just now";
}

// Compact abbreviations, checked largest-first. Intentionally caps at weeks: months would abbreviate to
// "m", which already means minutes here, so past 4 weeks we keep counting weeks (5w, 6w, …).
const COMPACT_UNITS: Array<{ suffix: string; seconds: number }> = [
  { suffix: "w", seconds: 7 * 24 * 60 * 60 },
  { suffix: "d", seconds: 24 * 60 * 60 },
  { suffix: "h", seconds: 60 * 60 },
  { suffix: "m", seconds: 60 },
];

// Terse relative time for tight UI (e.g. "1m ago", "3h ago", "2w ago"). "just now" under a minute.
export function formatCompactRelativeTime(ts: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ts) / 1000));
  if (seconds < 60) return "just now";

  for (const { suffix, seconds: unitSeconds } of COMPACT_UNITS) {
    if (seconds >= unitSeconds) return `${Math.floor(seconds / unitSeconds)}${suffix} ago`;
  }

  return "just now";
}

const ABSOLUTE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

// Fixed compact form like "Dec 23 10:30pm" — space-separated, lowercase meridiem, no space before it.
export function formatAbsoluteDateTime(ts: number): string {
  const parts = ABSOLUTE_FORMATTER.formatToParts(new Date(ts));
  const value = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "";

  const month = value("month");
  const day = value("day");
  const hour = value("hour");
  const minute = value("minute");
  const meridiem = value("dayPeriod").toLowerCase();

  return `${month} ${day} ${hour}:${minute}${meridiem}`;
}
