import type { Booking } from '@/core/domain/booking.types';
import {
  findConflictingBooking,
  findNextBookingStart,
  formatDuration,
  formatTimeRange,
  getBookedMinutes,
  getDurationMinutes,
  hasTimingConflict,
  intervalsOverlap,
  isMinuteOccupied,
  isValidTime,
  minutesToTime,
  sortBookingsByStart,
  timeToMinutes,
} from '@/core/utils/time.helpers';

const DATE = '2026-10-07';

const booking = (id: string, startTime: string, endTime: string, date = DATE): Booking => ({
  id,
  title: `Booking ${id}`,
  date,
  startTime,
  endTime,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
});

describe('timeToMinutes / minutesToTime', () => {
  it.each([
    ['00:00', 0],
    ['09:00', 540],
    ['09:30', 570],
    ['18:00', 1080],
    ['23:59', 1439],
  ])('converts %s ⇄ %i', (time, minutes) => {
    expect(timeToMinutes(time)).toBe(minutes);
    expect(minutesToTime(minutes)).toBe(time);
  });

  it.each(['9:00', '24:00', '12:60', '12:5', '', 'noon', '12:00:00'])('rejects malformed time "%s"', (time) => {
    expect(isValidTime(time)).toBe(false);
    expect(() => timeToMinutes(time)).toThrow(RangeError);
  });

  it.each([-1, 1440, 10.5, Number.NaN])('rejects out-of-range minutes %p', (minutes) => {
    expect(() => minutesToTime(minutes)).toThrow(RangeError);
  });

  it('computes durations', () => {
    expect(getDurationMinutes('10:00', '11:30')).toBe(90);
    expect(getDurationMinutes('11:00', '10:00')).toBe(-60);
  });
});

describe('intervalsOverlap', () => {
  const tenToEleven = { start: 600, end: 660 };

  it.each([
    ['identical', { start: 600, end: 660 }],
    ['partially before', { start: 570, end: 630 }],
    ['partially after', { start: 630, end: 690 }],
    ['fully inside', { start: 615, end: 645 }],
    ['fully containing', { start: 540, end: 720 }],
    ['sharing the start, longer', { start: 600, end: 720 }],
    ['sharing the end, shorter', { start: 630, end: 660 }],
    ['one minute into the end', { start: 659, end: 700 }],
    ['one minute before the start', { start: 560, end: 601 }],
  ])('detects overlap: %s', (_label, other) => {
    expect(intervalsOverlap(tenToEleven, other)).toBe(true);
    expect(intervalsOverlap(other, tenToEleven)).toBe(true);
  });

  it.each([
    ['touching at the end (11:00–12:00)', { start: 660, end: 720 }],
    ['touching at the start (09:00–10:00)', { start: 540, end: 600 }],
    ['fully before', { start: 540, end: 570 }],
    ['fully after', { start: 690, end: 750 }],
  ])('allows non-overlapping intervals: %s', (_label, other) => {
    expect(intervalsOverlap(tenToEleven, other)).toBe(false);
    expect(intervalsOverlap(other, tenToEleven)).toBe(false);
  });
});

describe('findConflictingBooking / hasTimingConflict', () => {
  const day = [booking('a', '09:30', '10:30'), booking('b', '11:00', '12:00'), booking('c', '14:00', '15:30')];

  it('returns the overlapping booking', () => {
    expect(findConflictingBooking({ date: DATE, startTime: '10:00', endTime: '11:00' }, day)?.id).toBe('a');
    expect(findConflictingBooking({ date: DATE, startTime: '11:30', endTime: '13:00' }, day)?.id).toBe('b');
  });

  it('allows a booking that exactly fills a gap between two others (touching both borders)', () => {
    expect(hasTimingConflict({ date: DATE, startTime: '10:30', endTime: '11:00' }, day)).toBe(false);
    expect(hasTimingConflict({ date: DATE, startTime: '12:00', endTime: '14:00' }, day)).toBe(false);
  });

  it('allows adjacent bookings 10:00–11:00 and 11:00–12:00', () => {
    const existing = [booking('x', '10:00', '11:00')];
    expect(hasTimingConflict({ date: DATE, startTime: '11:00', endTime: '12:00' }, existing)).toBe(false);
    expect(hasTimingConflict({ date: DATE, startTime: '09:00', endTime: '10:00' }, existing)).toBe(false);
  });

  it('detects a candidate spanning several bookings', () => {
    expect(hasTimingConflict({ date: DATE, startTime: '09:00', endTime: '18:00' }, day)).toBe(true);
  });

  it('ignores bookings on other dates', () => {
    const other = [booking('z', '10:00', '11:00', '2026-10-08')];
    expect(hasTimingConflict({ date: DATE, startTime: '10:00', endTime: '11:00' }, other)).toBe(false);
  });

  it('does not let a booking conflict with its own original slot when excluded (editing)', () => {
    const candidate = { date: DATE, startTime: '09:30', endTime: '10:30' };
    expect(hasTimingConflict(candidate, day)).toBe(true);
    expect(hasTimingConflict(candidate, day, 'a')).toBe(false);
    // Extending its own slot is fine as long as it stays clear of neighbours…
    expect(hasTimingConflict({ date: DATE, startTime: '09:00', endTime: '11:00' }, day, 'a')).toBe(false);
    // …but still collides with a neighbour.
    expect(findConflictingBooking({ date: DATE, startTime: '09:30', endTime: '11:30' }, day, 'a')?.id).toBe('b');
  });

  it('treats inverted, empty or malformed candidates as non-conflicting (validated elsewhere)', () => {
    expect(hasTimingConflict({ date: DATE, startTime: '10:30', endTime: '10:00' }, day)).toBe(false);
    expect(hasTimingConflict({ date: DATE, startTime: '10:00', endTime: '10:00' }, day)).toBe(false);
    expect(hasTimingConflict({ date: DATE, startTime: '', endTime: '10:00' }, day)).toBe(false);
  });

  it('handles an empty schedule', () => {
    expect(hasTimingConflict({ date: DATE, startTime: '09:00', endTime: '10:00' }, [])).toBe(false);
  });
});

describe('slot helpers', () => {
  const day = [booking('a', '10:00', '11:00'), booking('b', '13:00', '14:00')];

  it('isMinuteOccupied uses half-open intervals', () => {
    expect(isMinuteOccupied(599, day)).toBe(false);
    expect(isMinuteOccupied(600, day)).toBe(true);
    expect(isMinuteOccupied(659, day)).toBe(true);
    expect(isMinuteOccupied(660, day)).toBe(false);
    expect(isMinuteOccupied(600, day, 'a')).toBe(false);
  });

  it('findNextBookingStart returns the nearest later start or the end of the working day', () => {
    expect(findNextBookingStart(540, day)).toBe(600);
    expect(findNextBookingStart(600, day)).toBe(780);
    expect(findNextBookingStart(840, day)).toBe(1080);
    expect(findNextBookingStart(540, day, 'a')).toBe(780);
  });

  it('sorts by start time without mutating the input', () => {
    const unsorted = [booking('late', '15:00', '16:00'), booking('early', '09:00', '10:00')];
    expect(sortBookingsByStart(unsorted).map((b) => b.id)).toEqual(['early', 'late']);
    expect(unsorted[0]?.id).toBe('late');
  });

  it('sums booked minutes', () => {
    expect(getBookedMinutes(day)).toBe(120);
    expect(getBookedMinutes([])).toBe(0);
  });
});

describe('formatters', () => {
  it('formats ranges with an en dash', () => {
    expect(formatTimeRange('09:00', '10:30')).toBe('09:00–10:30');
  });

  it.each([
    [0, '0 мин'],
    [30, '30 мин'],
    [60, '1 ч'],
    [90, '1 ч 30 мин'],
    [120, '2 ч'],
    [330, '5 ч 30 мин'],
  ])('formats %i minutes as "%s"', (minutes, expected) => {
    expect(formatDuration(minutes)).toBe(expected);
  });
});
