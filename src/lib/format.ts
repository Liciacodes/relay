// Small text helpers for the UI.

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" }); // "yesterday", "2 days ago"

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** An ISO date as "3 hours ago", "yesterday", "2 weeks ago". Empty if the date is missing. */
export function formatWhen(iso: string, now = Date.now()): string {
  const time = Date.parse(iso);
  if (Number.isNaN(time)) return "";
  const seconds = (time - now) / 1000; // negative = in the past
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

/** Milliseconds as seconds with one decimal: 812 → "0.8s". */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}
