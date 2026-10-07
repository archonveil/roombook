import type { IsoDate, MonthKey } from '../domain/booking.types';

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTH_KEY_PATTERN = /^(\d{4})-(\d{2})$/;

const MONTHS = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
] as const;
const MONTHS_GENITIVE = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
] as const;
/** Monday-first, matching the calendar grid. */
const WEEKDAYS = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'] as const;

const pad = (value: number): string => String(value).padStart(2, '0');

/**
 * Date arithmetic is done on UTC midnights so DST transitions in the
 * user's timezone can never shift a calendar day.
 */
function isoToUtc(iso: IsoDate): Date {
  const match = ISO_DATE_PATTERN.exec(iso);
  if (!match) throw new RangeError(`Invalid date "${iso}": expected YYYY-MM-DD`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

function utcToIso(date: Date): IsoDate {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function parseMonthKey(month: MonthKey): { year: number; monthIndex: number } {
  const match = MONTH_KEY_PATTERN.exec(month);
  if (!match) throw new RangeError(`Invalid month "${month}": expected YYYY-MM`);
  return { year: Number(match[1]), monthIndex: Number(match[2]) - 1 };
}

export function isValidIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_PATTERN.exec(value);
  if (!match) return false;
  return utcToIso(isoToUtc(value)) === value;
}

/** Local calendar date of a `Date` instance. */
export function toIsoDate(date: Date): IsoDate {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function getTodayIso(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

/** Minutes elapsed since local midnight. */
export function getMinutesOfDay(now: Date = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function addDays(iso: IsoDate, days: number): IsoDate {
  const date = isoToUtc(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return utcToIso(date);
}

export function getMonthKey(iso: IsoDate): MonthKey {
  return iso.slice(0, 7);
}

export function addMonths(month: MonthKey, months: number): MonthKey {
  const { year, monthIndex } = parseMonthKey(month);
  const date = new Date(Date.UTC(year, monthIndex + months, 1));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}`;
}

export function getDaysInMonth(month: MonthKey): number {
  const { year, monthIndex } = parseMonthKey(month);
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function getMonthRange(month: MonthKey): { from: IsoDate; to: IsoDate } {
  return { from: `${month}-01`, to: `${month}-${pad(getDaysInMonth(month))}` };
}

/** Every date in `[from, to]`, inclusive. */
export function eachDateInRange(from: IsoDate, to: IsoDate): IsoDate[] {
  const dates: IsoDate[] = [];
  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) dates.push(cursor);
  return dates;
}

/** Monday-first month grid: number of leading blank cells plus every date of the month. */
export function getMonthGrid(month: MonthKey): { leadingBlanks: number; days: IsoDate[] } {
  const { from, to } = getMonthRange(month);
  const leadingBlanks = (isoToUtc(from).getUTCDay() + 6) % 7;
  return { leadingBlanks, days: eachDateInRange(from, to) };
}

/** ISO dates compare correctly as strings. */
export function isPastDate(iso: IsoDate, now: Date = new Date()): boolean {
  return iso < getTodayIso(now);
}

export function isToday(iso: IsoDate, now: Date = new Date()): boolean {
  return iso === getTodayIso(now);
}

/**
 * A slot is in the past when its date is before today, or it is today and it
 * starts before the current minute. A slot starting at the current minute is bookable.
 */
export function isPastSlot(iso: IsoDate, startMinutes: number, now: Date = new Date()): boolean {
  const today = getTodayIso(now);
  if (iso < today) return true;
  if (iso > today) return false;
  return startMinutes < getMinutesOfDay(now);
}

export function getDayOfMonth(iso: IsoDate): number {
  return isoToUtc(iso).getUTCDate();
}

/** `"2026-10-07"` → `"7 октября"`. */
export function formatShortDate(iso: IsoDate): string {
  const date = isoToUtc(iso);
  return `${date.getUTCDate()} ${MONTHS_GENITIVE[date.getUTCMonth()]}`;
}

/** `"2026-10-07"` → `"7 октября, среда"`. */
export function formatLongDate(iso: IsoDate): string {
  const weekday = WEEKDAYS[(isoToUtc(iso).getUTCDay() + 6) % 7];
  return `${formatShortDate(iso)}, ${weekday}`;
}

/** Day heading: `"Сегодня, 7 октября"` for today, otherwise the long date. */
export function formatDayHeading(iso: IsoDate, now: Date = new Date()): string {
  return isToday(iso, now) ? `Сегодня, ${formatShortDate(iso)}` : formatLongDate(iso);
}

/** `"2026-10"` → `"Октябрь 2026"`. */
export function formatMonthLabel(month: MonthKey): string {
  const { year, monthIndex } = parseMonthKey(month);
  return `${MONTHS[monthIndex]} ${year}`;
}

/** Russian plural form of «бронирование» for a count. */
export function pluralizeBookings(count: number): string {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return 'бронирование';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'бронирования';
  return 'бронирований';
}
