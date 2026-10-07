import { z } from 'zod';

import {
  MAX_BOOKING_MINUTES,
  MIN_BOOKING_MINUTES,
  TITLE_MAX_LENGTH,
  WORKDAY_END_MINUTES,
  WORKDAY_START_MINUTES,
} from './booking.constants';
import type { Booking, BookingFormValues, BookingTiming } from './booking.types';
import { getMinutesOfDay, getTodayIso, isValidIsoDate } from '../utils/date.helpers';
import {
  findConflictingBooking,
  formatTimeRange,
  isValidTime,
  minutesToTime,
  timeToMinutes,
} from '../utils/time.helpers';

export const BOOKING_MESSAGES = {
  titleRequired: 'Введите название.',
  titleTooLong: `Название — не длиннее ${TITLE_MAX_LENGTH} символов.`,
  dateRequired: 'Выберите дату.',
  dateInvalid: 'Некорректная дата.',
  startRequired: 'Выберите время начала.',
  endRequired: 'Выберите время окончания.',
  outsideWorkingHours: `Бронировать можно только в рабочее время: ${minutesToTime(WORKDAY_START_MINUTES)}–${minutesToTime(WORKDAY_END_MINUTES)}.`,
  endBeforeStart: 'Окончание должно быть позже начала.',
  tooShort: `Минимальная длительность — ${MIN_BOOKING_MINUTES} минут.`,
  tooLong: `Максимальная длительность — ${MAX_BOOKING_MINUTES / 60} часа.`,
  pastDate: 'Нельзя бронировать на прошедшую дату.',
  pastTime: 'Это время уже прошло. Выберите время позже текущего.',
  emptyUpdate: 'Нет полей для обновления.',
  conflict: (booking: Pick<Booking, 'startTime' | 'endTime'>) =>
    `Это время занято: ${formatTimeRange(booking.startTime, booking.endTime)}. Выберите другой интервал.`,
} as const;

const TIME_FORMAT = /^([01]\d|2[0-3]):[0-5]\d$/;

const timeField = (requiredMessage: string) =>
  z.string({ error: requiredMessage }).regex(TIME_FORMAT, { error: requiredMessage });

/** Shape and format of each field, without cross-field business rules. */
export const bookingFieldsSchema = z.object({
  title: z
    .string({ error: BOOKING_MESSAGES.titleRequired })
    .trim()
    .min(1, { error: BOOKING_MESSAGES.titleRequired })
    .max(TITLE_MAX_LENGTH, { error: BOOKING_MESSAGES.titleTooLong }),
  date: z
    .string({ error: BOOKING_MESSAGES.dateRequired })
    .min(1, { error: BOOKING_MESSAGES.dateRequired })
    .refine(isValidIsoDate, { error: BOOKING_MESSAGES.dateInvalid }),
  startTime: timeField(BOOKING_MESSAGES.startRequired),
  endTime: timeField(BOOKING_MESSAGES.endRequired),
});

/** PATCH body: any subset of fields, but at least one. */
export const bookingUpdateSchema = bookingFieldsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, { error: BOOKING_MESSAGES.emptyUpdate });

/** Query string of `GET /api/bookings`: a single date or an inclusive range. */
export const bookingListQuerySchema = z.union([
  z.object({ date: z.string().refine(isValidIsoDate, { error: BOOKING_MESSAGES.dateInvalid }) }),
  z
    .object({
      from: z.string().refine(isValidIsoDate, { error: BOOKING_MESSAGES.dateInvalid }),
      to: z.string().refine(isValidIsoDate, { error: BOOKING_MESSAGES.dateInvalid }),
    })
    .refine(({ from, to }) => from <= to, { error: '`from` должна быть не позже `to`.', path: ['to'] }),
]);

export interface BookingRuleViolation {
  path: keyof BookingFormValues;
  message: string;
}

export interface BookingRuleOptions {
  /** Reference "now" for rule 6. */
  now: Date;
  /**
   * The persisted version of the booking being edited. When the edit keeps the
   * original date and times, the past-time rule is skipped so an ongoing meeting
   * can still be renamed.
   */
  original?: BookingTiming | null;
}

const sameTiming = (a: BookingTiming, b: BookingTiming): boolean =>
  a.date === b.date && a.startTime === b.startTime && a.endTime === b.endTime;

/**
 * Pure implementation of business rules 1, 2, 3, 4 and 6. Malformed fields are
 * skipped here — they are reported by the field-level schema.
 */
export function getBookingRuleViolations(
  values: Partial<BookingFormValues>,
  { now, original }: BookingRuleOptions,
): BookingRuleViolation[] {
  const violations: BookingRuleViolation[] = [];
  const { date, startTime, endTime } = values;
  const hasStart = isValidTime(startTime);
  const hasEnd = isValidTime(endTime);
  const start = hasStart ? timeToMinutes(startTime) : null;
  const end = hasEnd ? timeToMinutes(endTime) : null;

  // Rule 1: working hours 09:00–18:00.
  if (start !== null && (start < WORKDAY_START_MINUTES || start >= WORKDAY_END_MINUTES)) {
    violations.push({ path: 'startTime', message: BOOKING_MESSAGES.outsideWorkingHours });
  }
  if (end !== null && (end <= WORKDAY_START_MINUTES || end > WORKDAY_END_MINUTES)) {
    violations.push({ path: 'endTime', message: BOOKING_MESSAGES.outsideWorkingHours });
  }

  // Rules 2–4: ordering and duration bounds.
  if (start !== null && end !== null) {
    const duration = end - start;
    if (duration <= 0) {
      violations.push({ path: 'endTime', message: BOOKING_MESSAGES.endBeforeStart });
    } else if (duration < MIN_BOOKING_MINUTES) {
      violations.push({ path: 'endTime', message: BOOKING_MESSAGES.tooShort });
    } else if (duration > MAX_BOOKING_MINUTES) {
      violations.push({ path: 'endTime', message: BOOKING_MESSAGES.tooLong });
    }
  }

  // Rule 6: no bookings in the past.
  if (isValidIsoDate(date)) {
    const unchanged =
      original != null && hasStart && hasEnd && sameTiming(original, { date, startTime, endTime });
    if (!unchanged) {
      const today = getTodayIso(now);
      if (date < today) {
        violations.push({ path: 'date', message: BOOKING_MESSAGES.pastDate });
      } else if (date === today && start !== null && start < getMinutesOfDay(now)) {
        violations.push({ path: 'startTime', message: BOOKING_MESSAGES.pastTime });
      }
    }
  }

  return violations;
}

export interface BookingSchemaOptions {
  /** Clock used for rule 6; evaluated on every parse so validation never goes stale. */
  now?: () => Date;
  /** Bookings already on record. When given, rule 5 (no overlaps) is validated too. */
  existingBookings?: readonly Booking[];
  /** Id of the booking being edited — excluded from overlap checks (rule 7). */
  excludeId?: string | null;
  /** Persisted timing of the edited booking, see {@link BookingRuleOptions.original}. */
  original?: BookingTiming | null;
}

/**
 * Full booking schema: field formats plus business rules 1–4 and 6, and rule 5
 * when `existingBookings` is supplied. Used by the client form and the API.
 */
export function createBookingSchema(options: BookingSchemaOptions = {}) {
  const { now = () => new Date(), existingBookings, excludeId = null, original = null } = options;

  return bookingFieldsSchema.superRefine((values, ctx) => {
    const violations = getBookingRuleViolations(values, { now: now(), original });
    for (const { path, message } of violations) {
      ctx.addIssue({ code: 'custom', path: [path], message });
    }

    if (existingBookings && violations.length === 0) {
      const conflict = findConflictingBooking(values, existingBookings, excludeId);
      if (conflict) {
        ctx.addIssue({ code: 'custom', path: ['endTime'], message: BOOKING_MESSAGES.conflict(conflict) });
      }
    }
  });
}

/** Default schema for create payloads and the client form (rules 1–4, 6). */
export const bookingFormSchema = createBookingSchema();

export type BookingSchemaInput = z.input<typeof bookingFormSchema>;
export type BookingSchemaOutput = z.output<typeof bookingFormSchema>;

// Compile-time guarantee that the schema and the domain interface never drift apart.
type Equals<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const schemaMatchesInterface: Equals<BookingSchemaOutput, BookingFormValues> = true;
void schemaMatchesInterface;
