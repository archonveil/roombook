import {
  BOOKING_MESSAGES,
  bookingListQuerySchema,
  bookingUpdateSchema,
  createBookingSchema,
  getBookingRuleViolations,
} from '@/core/domain/booking.schema';
import type { Booking, BookingFormValues } from '@/core/domain/booking.types';

/** Fixed clock: Wednesday 7 October 2026, 11:15 local time. */
const NOW = new Date(2026, 9, 7, 11, 15);
const TODAY = '2026-10-07';
const TOMORROW = '2026-10-08';
const YESTERDAY = '2026-10-06';

const schema = createBookingSchema({ now: () => NOW });

const values = (overrides: Partial<BookingFormValues> = {}): BookingFormValues => ({
  title: 'Планёрка',
  date: TOMORROW,
  startTime: '10:00',
  endTime: '11:00',
  ...overrides,
});

/** Collects `path → messages` for easy assertions. */
function issuesOf(input: unknown, target = schema): Record<string, string[]> {
  const result = target.safeParse(input);
  if (result.success) return {};
  return result.error.issues.reduce<Record<string, string[]>>((acc, issue) => {
    const key = issue.path.join('.') || '_form';
    (acc[key] ??= []).push(issue.message);
    return acc;
  }, {});
}

describe('booking schema — valid input', () => {
  it('accepts a regular booking', () => {
    expect(schema.safeParse(values()).success).toBe(true);
  });

  it('trims the title', () => {
    const result = schema.parse(values({ title: '  Демо  ' }));
    expect(result.title).toBe('Демо');
  });
});

describe('field formats', () => {
  it.each(['', '   '])('requires a title (%j)', (title) => {
    expect(issuesOf(values({ title }))).toEqual({ title: [BOOKING_MESSAGES.titleRequired] });
  });

  it('limits title length', () => {
    expect(issuesOf(values({ title: 'x'.repeat(121) })).title).toEqual([BOOKING_MESSAGES.titleTooLong]);
  });

  it.each(['', '2026-13-01', '2026-02-30', '07.10.2026'])('rejects invalid date %j', (date) => {
    expect(issuesOf(values({ date })).date).toBeDefined();
  });

  it('requires both times', () => {
    const issues = issuesOf(values({ startTime: '', endTime: '' }));
    expect(issues.startTime).toEqual([BOOKING_MESSAGES.startRequired]);
    expect(issues.endTime).toEqual([BOOKING_MESSAGES.endRequired]);
  });

  it('still reports time rule violations when the title is missing', () => {
    const issues = issuesOf(values({ title: '', startTime: '11:00', endTime: '10:00' }));
    expect(issues.title).toEqual([BOOKING_MESSAGES.titleRequired]);
    expect(issues.endTime).toEqual([BOOKING_MESSAGES.endBeforeStart]);
  });

  it('rejects non-object input', () => {
    expect(schema.safeParse(null).success).toBe(false);
    expect(schema.safeParse({ ...values(), startTime: 900 }).success).toBe(false);
  });
});

describe('rule 1 — working hours 09:00–18:00', () => {
  it.each([
    ['09:00', '10:00'],
    ['16:00', '18:00'],
    ['17:30', '18:00'],
  ])('accepts %s–%s at the bounds', (startTime, endTime) => {
    expect(schema.safeParse(values({ startTime, endTime })).success).toBe(true);
  });

  it('rejects a start before 09:00', () => {
    expect(issuesOf(values({ startTime: '08:30', endTime: '09:30' })).startTime).toEqual([
      BOOKING_MESSAGES.outsideWorkingHours,
    ]);
  });

  it('rejects an end after 18:00', () => {
    expect(issuesOf(values({ startTime: '17:30', endTime: '18:30' })).endTime).toEqual([
      BOOKING_MESSAGES.outsideWorkingHours,
    ]);
  });

  it('rejects a booking entirely after hours', () => {
    const issues = issuesOf(values({ startTime: '18:00', endTime: '19:00' }));
    expect(issues.startTime).toContain(BOOKING_MESSAGES.outsideWorkingHours);
    expect(issues.endTime).toContain(BOOKING_MESSAGES.outsideWorkingHours);
  });

  it('rejects a booking entirely before hours', () => {
    const issues = issuesOf(values({ startTime: '07:00', endTime: '08:00' }));
    expect(issues.startTime).toContain(BOOKING_MESSAGES.outsideWorkingHours);
    expect(issues.endTime).toContain(BOOKING_MESSAGES.outsideWorkingHours);
  });
});

describe('rule 2 — start < end', () => {
  it('rejects equal start and end', () => {
    expect(issuesOf(values({ startTime: '10:00', endTime: '10:00' })).endTime).toEqual([
      BOOKING_MESSAGES.endBeforeStart,
    ]);
  });

  it('rejects an end before the start', () => {
    expect(issuesOf(values({ startTime: '12:00', endTime: '11:00' })).endTime).toEqual([
      BOOKING_MESSAGES.endBeforeStart,
    ]);
  });
});

describe('rules 3 & 4 — duration between 30 and 120 minutes', () => {
  it.each([
    ['10:00', '10:30', 30],
    ['10:00', '12:00', 120],
    ['10:00', '11:15', 75],
  ])('accepts %s–%s (%i min)', (startTime, endTime) => {
    expect(schema.safeParse(values({ startTime, endTime })).success).toBe(true);
  });

  it.each([
    ['10:00', '10:29'],
    ['10:00', '10:15'],
    ['10:00', '10:01'],
  ])('rejects %s–%s as too short', (startTime, endTime) => {
    expect(issuesOf(values({ startTime, endTime })).endTime).toEqual([BOOKING_MESSAGES.tooShort]);
  });

  it.each([
    ['10:00', '12:01'],
    ['09:00', '12:00'],
    ['09:00', '18:00'],
  ])('rejects %s–%s as too long', (startTime, endTime) => {
    expect(issuesOf(values({ startTime, endTime })).endTime).toEqual([BOOKING_MESSAGES.tooLong]);
  });
});

describe('rule 6 — no bookings in the past', () => {
  it('rejects any slot on a past date', () => {
    expect(issuesOf(values({ date: YESTERDAY })).date).toEqual([BOOKING_MESSAGES.pastDate]);
  });

  it('rejects a slot earlier today', () => {
    expect(issuesOf(values({ date: TODAY, startTime: '10:00', endTime: '11:00' })).startTime).toEqual([
      BOOKING_MESSAGES.pastTime,
    ]);
  });

  it('rejects a slot that started a minute ago (11:14 at 11:15)', () => {
    expect(issuesOf(values({ date: TODAY, startTime: '11:14', endTime: '12:00' })).startTime).toEqual([
      BOOKING_MESSAGES.pastTime,
    ]);
  });

  it('accepts a slot starting exactly now', () => {
    expect(schema.safeParse(values({ date: TODAY, startTime: '11:15', endTime: '12:00' })).success).toBe(true);
  });

  it('accepts a later slot today and any future date', () => {
    expect(schema.safeParse(values({ date: TODAY, startTime: '11:30', endTime: '12:30' })).success).toBe(true);
    expect(schema.safeParse(values({ date: TOMORROW, startTime: '09:00', endTime: '10:00' })).success).toBe(true);
  });

  it('evaluates "now" on every parse rather than when the schema is created', () => {
    let clock = new Date(2026, 9, 7, 9, 0);
    const liveSchema = createBookingSchema({ now: () => clock });
    const input = values({ date: TODAY, startTime: '10:00', endTime: '11:00' });

    expect(liveSchema.safeParse(input).success).toBe(true);
    clock = new Date(2026, 9, 7, 10, 30);
    expect(liveSchema.safeParse(input).success).toBe(false);
  });

  it('lets an ongoing booking be edited when its timing is unchanged (rename)', () => {
    const original = { date: TODAY, startTime: '11:00', endTime: '12:00' };
    const editSchema = createBookingSchema({ now: () => NOW, original });
    expect(editSchema.safeParse(values({ ...original, title: 'Новое имя' })).success).toBe(true);
    // Moving it is a new timing, so the rule applies again.
    expect(editSchema.safeParse(values({ date: TODAY, startTime: '10:30', endTime: '11:30' })).success).toBe(false);
  });
});

describe('rule 5 & 7 — overlap check when existing bookings are supplied', () => {
  const existing: Booking[] = [
    {
      id: 'b1',
      title: 'Собеседование',
      date: TOMORROW,
      startTime: '11:00',
      endTime: '12:00',
      createdAt: '',
      updatedAt: '',
    },
  ];
  const withBookings = createBookingSchema({ now: () => NOW, existingBookings: existing });

  it('rejects an overlapping slot with a message naming the taken range', () => {
    expect(issuesOf(values({ startTime: '11:30', endTime: '12:30' }), withBookings).endTime).toEqual([
      BOOKING_MESSAGES.conflict(existing[0]!),
    ]);
  });

  it('allows touching borders', () => {
    expect(withBookings.safeParse(values({ startTime: '10:00', endTime: '11:00' })).success).toBe(true);
    expect(withBookings.safeParse(values({ startTime: '12:00', endTime: '13:00' })).success).toBe(true);
  });

  it('excludes the edited booking from the check', () => {
    const editing = createBookingSchema({ now: () => NOW, existingBookings: existing, excludeId: 'b1' });
    expect(editing.safeParse(values({ startTime: '11:00', endTime: '12:30' })).success).toBe(true);
  });
});

describe('getBookingRuleViolations', () => {
  it('returns no violations for valid values', () => {
    expect(getBookingRuleViolations(values(), { now: NOW })).toEqual([]);
  });

  it('skips malformed fields (reported by the field schema instead)', () => {
    expect(getBookingRuleViolations({ date: 'nope', startTime: 'x', endTime: '' }, { now: NOW })).toEqual([]);
  });
});

describe('bookingUpdateSchema', () => {
  it('accepts a partial update', () => {
    expect(bookingUpdateSchema.safeParse({ title: 'Ок' }).success).toBe(true);
  });

  it('rejects an empty update and unknown keys', () => {
    expect(bookingUpdateSchema.safeParse({}).success).toBe(false);
    expect(bookingUpdateSchema.safeParse({ id: 'x' }).success).toBe(false);
  });
});

describe('bookingListQuerySchema', () => {
  it('accepts a single date or a range', () => {
    expect(bookingListQuerySchema.safeParse({ date: TODAY }).success).toBe(true);
    expect(bookingListQuerySchema.safeParse({ from: '2026-10-01', to: '2026-10-31' }).success).toBe(true);
  });

  it('rejects missing or inverted parameters', () => {
    expect(bookingListQuerySchema.safeParse({}).success).toBe(false);
    expect(bookingListQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(false);
  });
});
