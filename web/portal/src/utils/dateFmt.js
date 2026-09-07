/**
 * Date helpers shared across daily-activity / activity-feed pages.
 *
 * The on-chain program stores time as integer UTC days
 * (`day_index = unix_ts / 86_400`). The backend daily-activity replay
 * returns each day as `{ day, date }` where `date` is `YYYY-MM-DD` in UTC.
 *
 * For human display we format in the viewer's local timezone using
 * `Intl.DateTimeFormat` (auto-resolves to the browser's locale + TZ),
 * but always carry the UTC string alongside so on-chain day boundaries
 * remain unambiguous.
 */

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});

const dateTimeFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** "Sat, May 9" in viewer's TZ for a UTC `YYYY-MM-DD` string. */
export function fmtLocalDate(utcDateStr) {
  if (!utcDateStr) return '—';
  // `new Date('YYYY-MM-DD')` parses as UTC midnight — exactly what we want
  // since the on-chain day boundary is UTC midnight.
  return dateFmt.format(new Date(utcDateStr));
}

/** "Sat, May 9, 8:31 PM" in viewer's TZ for a unix-seconds timestamp. */
export function fmtLocalDateTime(unixSeconds) {
  if (!unixSeconds) return '—';
  return dateTimeFmt.format(new Date(unixSeconds * 1000));
}

/**
 * Convert an on-chain integer day-index (UTC days since epoch) to a
 * localized "Sat, May 9" string. Use this anywhere the program emits a
 * `day NNNN` value (drawdown_day, activated_day, cliff, etc.).
 */
export function fmtDayIndex(dayIndex) {
  if (dayIndex === undefined || dayIndex === null || dayIndex === 0) return '—';
  return dateFmt.format(new Date(Number(dayIndex) * 86400 * 1000));
}

/**
 * Warp-aware label for a day-index. When `secondsPerDay === 86400` returns
 * the same calendar date as `fmtDayIndex`. For warp pools (smaller day
 * length) returns "warp day N" + the wall-clock time the warp-day starts —
 * calendar dates would be misleading because warp days don't line up with
 * real days.
 */
export function fmtWarpDayLabel(dayIndex, secondsPerDay = 86400) {
  if (dayIndex === undefined || dayIndex === null) return '—';
  const idx = Number(dayIndex);
  if (idx === 0) return '—';
  const spd = Number(secondsPerDay) || 86400;
  if (spd === 86400) return fmtDayIndex(idx);
  const startMs = idx * spd * 1000;
  return `warp day ${idx} · ${dateTimeFmt.format(new Date(startMs))}`;
}

/** Whether a pool is in compressed-time test mode. */
export function isWarpMode(secondsPerDay) {
  return Number(secondsPerDay) > 0 && Number(secondsPerDay) !== 86400;
}

/** Compact "1d 3h" / "2h 15m" / "5m 12s" formatter for countdowns. */
export function fmtCountdown(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const s = Math.floor(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${String(sec).padStart(2, '0')}s`;
  if (m > 0) return `${m}m ${String(sec).padStart(2, '0')}s`;
  return `${sec}s`;
}

/** Returns the viewer's IANA timezone name (e.g. "Asia/Karachi"). */
export function localTzName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'local';
  }
}
