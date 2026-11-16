// Outing dates are stored as plain "2026-01-31" strings with no time zone.
// JavaScript's own helpers treat such strings as UTC, which shifts the day for
// anyone not on UTC. Always go through these helpers instead.

/** "2026-01-31" for a Date, using the phone's own time zone. */
export function toDateString(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Today as "2026-01-31" in the phone's own time zone. */
export function todayString(): string {
  return toDateString(new Date());
}

/** Local midnight on the given "2026-01-31" day. Falls back to normal parsing for other formats. */
export function parseDate(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}
