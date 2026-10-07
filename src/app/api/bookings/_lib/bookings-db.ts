import type { Booking, BookingFormValues, IsoDate } from '@/core/domain/booking.types';
import { addDays, getTodayIso } from '@/core/utils/date.helpers';
import { sortBookingsByStart } from '@/core/utils/time.helpers';

/**
 * In-memory persistence for the mock API. The `_lib` folder is private to the
 * App Router, so nothing here is exposed as a route.
 *
 * The array lives on `globalThis` so dev-mode module reloads (HMR) keep data.
 * All reads and writes are synchronous: a route handler's check-then-write is
 * therefore atomic with respect to other requests on the same Node process.
 */

type SeedEntry = Omit<BookingFormValues, 'date'> & { dayOffset: number };

const SEED: readonly SeedEntry[] = [
  { dayOffset: 0, startTime: '09:30', endTime: '10:30', title: 'Планёрка отдела продаж' },
  { dayOffset: 0, startTime: '11:00', endTime: '12:00', title: 'Собеседование: дизайнер' },
  { dayOffset: 0, startTime: '14:00', endTime: '15:30', title: 'Демо для клиента' },
  { dayOffset: 0, startTime: '16:30', endTime: '17:00', title: 'Ретро спринта' },
  { dayOffset: 1, startTime: '10:00', endTime: '11:30', title: 'Обзор квартального плана' },
  { dayOffset: 1, startTime: '15:00', endTime: '16:00', title: 'Синк с подрядчиком' },
  { dayOffset: 5, startTime: '09:00', endTime: '10:00', title: 'Недельное планирование' },
  { dayOffset: 8, startTime: '13:00', endTime: '14:30', title: 'Воркшоп по онбордингу' },
];

function createSeed(now: Date): Booking[] {
  const today = getTodayIso(now);
  const timestamp = now.toISOString();
  return SEED.map(({ dayOffset, ...entry }, index) => ({
    id: `seed-${index + 1}`,
    ...entry,
    date: addDays(today, dayOffset),
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
}

const globalStore = globalThis as typeof globalThis & { __roombookBookingsDb?: Booking[] };

let bookingsDb: Booking[] = (globalStore.__roombookBookingsDb ??= createSeed(new Date()));

function commit(next: Booking[]): void {
  bookingsDb = next;
  globalStore.__roombookBookingsDb = next;
}

export function listBookings(filter: { date: IsoDate } | { from: IsoDate; to: IsoDate }): Booking[] {
  const matches =
    'date' in filter
      ? bookingsDb.filter((booking) => booking.date === filter.date)
      : bookingsDb.filter((booking) => booking.date >= filter.from && booking.date <= filter.to);
  // Stable sort: by start time first, then by date, so each day stays in chronological order.
  return sortBookingsByStart(matches).sort((a, b) => a.date.localeCompare(b.date));
}

export function getBookingsForDate(date: IsoDate): Booking[] {
  return bookingsDb.filter((booking) => booking.date === date);
}

export function findBooking(id: string): Booking | undefined {
  return bookingsDb.find((booking) => booking.id === id);
}

export function insertBooking(values: BookingFormValues, now: Date = new Date()): Booking {
  const timestamp = now.toISOString();
  const booking: Booking = { id: crypto.randomUUID(), ...values, createdAt: timestamp, updatedAt: timestamp };
  commit([...bookingsDb, booking]);
  return booking;
}

export function replaceBooking(id: string, values: BookingFormValues, now: Date = new Date()): Booking | undefined {
  const existing = findBooking(id);
  if (!existing) return undefined;
  const updated: Booking = { ...existing, ...values, updatedAt: now.toISOString() };
  commit(bookingsDb.map((booking) => (booking.id === id ? updated : booking)));
  return updated;
}

export function removeBooking(id: string): boolean {
  const next = bookingsDb.filter((booking) => booking.id !== id);
  if (next.length === bookingsDb.length) return false;
  commit(next);
  return true;
}
