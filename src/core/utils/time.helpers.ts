import { WORKDAY_END_MINUTES } from '../domain/booking.constants';
import type { Booking, BookingTiming, TimeInterval, TimeOfDay } from '../domain/booking.types';

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const MINUTES_PER_DAY = 24 * 60;

export function isValidTime(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && TIME_PATTERN.test(value);
}

/** `"09:30"` → `570`. Throws on malformed input so bad data never silently becomes 0. */
export function timeToMinutes(time: TimeOfDay): number {
  const match = TIME_PATTERN.exec(time);
  if (!match) {
    throw new RangeError(`Invalid time "${time}": expected HH:mm`);
  }
  return Number(match[1]) * 60 + Number(match[2]);
}

/** `570` → `"09:30"`. */
export function minutesToTime(minutes: number): TimeOfDay {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes >= MINUTES_PER_DAY) {
    throw new RangeError(`Invalid minutes value ${minutes}: expected an integer in [0, 1440)`);
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function toInterval(timing: Pick<BookingTiming, 'startTime' | 'endTime'>): TimeInterval {
  return { start: timeToMinutes(timing.startTime), end: timeToMinutes(timing.endTime) };
}

export function getDurationMinutes(startTime: TimeOfDay, endTime: TimeOfDay): number {
  return timeToMinutes(endTime) - timeToMinutes(startTime);
}

/**
 * Half-open interval intersection: `[a.start, a.end)` and `[b.start, b.end)` overlap
 * only if each starts strictly before the other ends. Touching borders
 * (10:00–11:00 and 11:00–12:00) therefore do NOT overlap.
 */
export function intervalsOverlap(a: TimeInterval, b: TimeInterval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Returns the first booking on the same date that overlaps the candidate,
 * ignoring `excludeId` (the booking being edited must not conflict with itself).
 * Candidates with malformed or non-positive ranges never conflict — those are
 * rejected by schema validation instead.
 */
export function findConflictingBooking(
  candidate: BookingTiming,
  bookings: readonly Booking[],
  excludeId?: string | null,
): Booking | undefined {
  if (!isValidTime(candidate.startTime) || !isValidTime(candidate.endTime)) return undefined;
  const target = toInterval(candidate);
  if (target.end <= target.start) return undefined;

  return bookings.find(
    (booking) =>
      booking.id !== excludeId &&
      booking.date === candidate.date &&
      intervalsOverlap(target, toInterval(booking)),
  );
}

export function hasTimingConflict(
  candidate: BookingTiming,
  bookings: readonly Booking[],
  excludeId?: string | null,
): boolean {
  return findConflictingBooking(candidate, bookings, excludeId) !== undefined;
}

/** True when `minute` falls inside `[start, end)` of any booking. Bookings must be for one date. */
export function isMinuteOccupied(
  minute: number,
  bookings: readonly Booking[],
  excludeId?: string | null,
): boolean {
  return bookings.some((booking) => {
    if (booking.id === excludeId) return false;
    const { start, end } = toInterval(booking);
    return minute >= start && minute < end;
  });
}

/** Start of the nearest booking that begins strictly after `minute`, or the end of the working day. */
export function findNextBookingStart(
  minute: number,
  bookings: readonly Booking[],
  excludeId?: string | null,
): number {
  return bookings.reduce((nearest, booking) => {
    if (booking.id === excludeId) return nearest;
    const start = timeToMinutes(booking.startTime);
    return start > minute && start < nearest ? start : nearest;
  }, WORKDAY_END_MINUTES);
}

export function sortBookingsByStart(bookings: readonly Booking[]): Booking[] {
  return [...bookings].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime) || a.id.localeCompare(b.id),
  );
}

export function getBookedMinutes(bookings: readonly Booking[]): number {
  return bookings.reduce((sum, booking) => sum + getDurationMinutes(booking.startTime, booking.endTime), 0);
}

/** `"09:00", "10:30"` → `"09:00–10:30"` (en dash, as in the design). */
export function formatTimeRange(startTime: TimeOfDay, endTime: TimeOfDay): string {
  return `${startTime}–${endTime}`;
}

/** `90` → `"1 ч 30 мин"`, `120` → `"2 ч"`, `30` → `"30 мин"`. */
export function formatDuration(minutes: number): string {
  const safe = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safe / 60);
  const rest = safe % 60;
  if (hours === 0 && rest === 0) return '0 мин';
  return [hours ? `${hours} ч` : '', rest ? `${rest} мин` : ''].filter(Boolean).join(' ');
}
