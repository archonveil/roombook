import type { Booking, BookingListQuery } from '@/core/domain/booking.types';
import { ApiError, ConflictError } from '@/services/api-client';
import type { BookingApi } from '@/services/booking.service';
import {
  createBooking,
  dateSelected,
  deleteBooking,
  fetchDayBookings,
  fetchMonthBookings,
  makeStore,
  selectDayBookings,
  selectDayError,
  selectDayStatus,
  selectIsDayRefreshing,
  selectMarkedDates,
  selectSelectedDate,
  updateBooking,
} from '@/store';

const DATE = '2026-10-08';
const NEXT_DATE = '2026-10-09';

const booking = (id: string, startTime: string, endTime: string, date = DATE): Booking => ({
  id,
  title: `Booking ${id}`,
  date,
  startTime,
  endTime,
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createFakeApi() {
  return {
    list: jest.fn<Promise<Booking[]>, [BookingListQuery, AbortSignal?]>().mockResolvedValue([]),
    create: jest.fn<ReturnType<BookingApi['create']>, Parameters<BookingApi['create']>>(),
    update: jest.fn<ReturnType<BookingApi['update']>, Parameters<BookingApi['update']>>(),
    remove: jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined),
  } satisfies BookingApi;
}

function setup() {
  const api = createFakeApi();
  const store = makeStore({ bookingService: api });
  return { api, store, state: () => store.getState() };
}

describe('selected date', () => {
  it('starts empty and stores the chosen date', () => {
    const { store, state } = setup();
    expect(selectSelectedDate(state())).toBeNull();
    store.dispatch(dateSelected(DATE));
    expect(selectSelectedDate(state())).toBe(DATE);
  });
});

describe('fetchDayBookings', () => {
  it('caches bookings by date, sorted by start time', async () => {
    const { api, store, state } = setup();
    api.list.mockResolvedValue([booking('late', '15:00', '16:00'), booking('early', '09:00', '10:00')]);

    const request = store.dispatch(fetchDayBookings({ date: DATE }));
    expect(selectDayStatus(state(), DATE)).toBe('loading');
    await request;

    expect(api.list).toHaveBeenCalledWith({ date: DATE }, expect.any(AbortSignal));
    expect(selectDayStatus(state(), DATE)).toBe('success');
    expect(selectDayBookings(state(), DATE).map((b) => b.id)).toEqual(['early', 'late']);
  });

  it('returns a stable empty array for unloaded dates', () => {
    const { state } = setup();
    expect(selectDayBookings(state(), DATE)).toBe(selectDayBookings(state(), NEXT_DATE));
  });

  it('de-duplicates concurrent requests for the same day unless forced', async () => {
    const { api, store } = setup();
    await Promise.all([
      store.dispatch(fetchDayBookings({ date: DATE })),
      store.dispatch(fetchDayBookings({ date: DATE })),
    ]);
    expect(api.list).toHaveBeenCalledTimes(1);

    const pending = deferred<Booking[]>();
    api.list.mockReturnValueOnce(pending.promise).mockResolvedValueOnce([]);
    const first = store.dispatch(fetchDayBookings({ date: DATE }));
    const forced = store.dispatch(fetchDayBookings({ date: DATE, force: true }));
    pending.resolve([]);
    await Promise.all([first, forced]);
    expect(api.list).toHaveBeenCalledTimes(3);
  });

  it('shows cached data as refreshing, and keeps it when a background refresh fails', async () => {
    const { api, store, state } = setup();
    api.list.mockResolvedValueOnce([booking('a', '10:00', '11:00')]);
    await store.dispatch(fetchDayBookings({ date: DATE }));

    const refresh = deferred<Booking[]>();
    api.list.mockReturnValueOnce(refresh.promise);
    const request = store.dispatch(fetchDayBookings({ date: DATE, force: true }));
    expect(selectIsDayRefreshing(state(), DATE)).toBe(true);

    refresh.reject(new ApiError(0, 'NETWORK_ERROR', 'offline'));
    await request;

    expect(selectIsDayRefreshing(state(), DATE)).toBe(false);
    expect(selectDayStatus(state(), DATE)).toBe('success');
    expect(selectDayBookings(state(), DATE)).toHaveLength(1);
    expect(selectDayError(state(), DATE)).toMatchObject({ code: 'NETWORK_ERROR', message: 'offline' });
  });

  it('reports an error state when the first load fails, with a serializable error', async () => {
    const { api, store, state } = setup();
    api.list.mockRejectedValueOnce(new ApiError(500, 'INTERNAL_ERROR', 'boom'));
    await store.dispatch(fetchDayBookings({ date: DATE }));

    expect(selectDayStatus(state(), DATE)).toBe('error');
    const error = selectDayError(state(), DATE);
    expect(error).toEqual({ status: 500, code: 'INTERNAL_ERROR', message: 'boom' });
    expect(error).not.toBeInstanceOf(Error);
  });

  it('ignores a response superseded by a newer request for the same day', async () => {
    const { api, store, state } = setup();
    const slow = deferred<Booking[]>();
    api.list.mockReturnValueOnce(slow.promise).mockResolvedValueOnce([booking('fresh', '12:00', '13:00')]);

    const first = store.dispatch(fetchDayBookings({ date: DATE }));
    await store.dispatch(fetchDayBookings({ date: DATE, force: true }));
    slow.resolve([booking('stale', '09:00', '10:00')]);
    await first;

    expect(selectDayBookings(state(), DATE).map((b) => b.id)).toEqual(['fresh']);
  });
});

describe('fetchMonthBookings', () => {
  it('fills every day of the month and powers the calendar markers', async () => {
    const { api, store, state } = setup();
    api.list.mockResolvedValue([booking('a', '10:00', '11:00', '2026-10-08'), booking('b', '12:00', '13:00', '2026-10-15')]);

    await store.dispatch(fetchMonthBookings({ month: '2026-10' }));

    expect(api.list).toHaveBeenCalledWith({ from: '2026-10-01', to: '2026-10-31' }, expect.any(AbortSignal));
    expect(selectDayStatus(state(), '2026-10-31')).toBe('success');
    expect(selectDayBookings(state(), '2026-10-31')).toEqual([]);
    expect([...selectMarkedDates(state())].sort()).toEqual(['2026-10-08', '2026-10-15']);
    // Memoized: same reference while bookings are unchanged.
    expect(selectMarkedDates(state())).toBe(selectMarkedDates(state()));
  });
});

describe('createBooking / updateBooking', () => {
  it('inserts a created booking into the cached day', async () => {
    const { api, store, state } = setup();
    await store.dispatch(fetchDayBookings({ date: DATE }));
    const created = booking('new', '13:00', '14:00');
    api.create.mockResolvedValue(created);

    const result = await store.dispatch(
      createBooking({ title: created.title, date: DATE, startTime: '13:00', endTime: '14:00' }),
    ).unwrap();

    expect(result).toEqual(created);
    expect(selectDayBookings(state(), DATE)).toEqual([created]);
    expect(state().bookings.pendingMutations).toBe(0);
  });

  it('rejects a 409 with a serializable conflict payload and leaves the cache untouched', async () => {
    const existing = booking('taken', '13:30', '14:30');
    const { api, store, state } = setup();
    api.list.mockResolvedValue([]);
    await store.dispatch(fetchDayBookings({ date: DATE }));
    api.create.mockRejectedValue(new ConflictError('Это время заняли.', { conflict: existing }));

    const action = await store.dispatch(createBooking({ title: 'x', date: DATE, startTime: '13:00', endTime: '14:00' }));

    expect(createBooking.rejected.match(action)).toBe(true);
    expect(action.payload).toEqual({ status: 409, code: 'BOOKING_CONFLICT', message: 'Это время заняли.', conflict: existing });
    expect(selectDayBookings(state(), DATE)).toEqual([]);
    expect(state().bookings.pendingMutations).toBe(0);
  });

  it('moves an updated booking to its new date', async () => {
    const original = booking('m', '10:00', '11:00', DATE);
    const { api, store, state } = setup();
    api.list.mockResolvedValueOnce([original]).mockResolvedValueOnce([]);
    await store.dispatch(fetchDayBookings({ date: DATE }));
    await store.dispatch(fetchDayBookings({ date: NEXT_DATE }));
    const moved = { ...original, date: NEXT_DATE };
    api.update.mockResolvedValue(moved);

    await store.dispatch(updateBooking({ id: 'm', changes: { date: NEXT_DATE } })).unwrap();

    expect(api.update).toHaveBeenCalledWith('m', { date: NEXT_DATE });
    expect(selectDayBookings(state(), DATE)).toEqual([]);
    expect(selectDayBookings(state(), NEXT_DATE)).toEqual([moved]);
  });
});

describe('deleteBooking (optimistic)', () => {
  const target = booking('del', '10:00', '11:00');
  const neighbour = booking('keep', '12:00', '13:00');

  async function loaded() {
    const ctx = setup();
    ctx.api.list.mockResolvedValueOnce([target, neighbour]);
    await ctx.store.dispatch(fetchDayBookings({ date: DATE }));
    return ctx;
  }

  it('removes the booking before the server responds', async () => {
    const pending = deferred<void>();
    const { api, store, state } = await loaded();
    api.remove.mockReturnValue(pending.promise);

    const request = store.dispatch(deleteBooking(target));
    expect(selectDayBookings(state(), DATE).map((b) => b.id)).toEqual(['keep']);

    pending.resolve();
    await request;
    expect(selectDayBookings(state(), DATE).map((b) => b.id)).toEqual(['keep']);
  });

  it('rolls back when the server fails', async () => {
    const { api, store, state } = await loaded();
    api.remove.mockRejectedValue(new ApiError(500, 'INTERNAL_ERROR', 'boom'));

    await expect(store.dispatch(deleteBooking(target)).unwrap()).rejects.toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(selectDayBookings(state(), DATE).map((b) => b.id)).toEqual(['del', 'keep']);
  });

  it('treats 404 as already deleted and re-syncs the day', async () => {
    const { api, store, state } = await loaded();
    api.remove.mockRejectedValue(new ApiError(404, 'NOT_FOUND', 'gone'));
    api.list.mockResolvedValueOnce([neighbour]);

    await store.dispatch(deleteBooking(target)).unwrap();
    await new Promise((resolve) => setImmediate(resolve));

    expect(api.list).toHaveBeenLastCalledWith({ date: DATE }, expect.any(AbortSignal));
    expect(selectDayBookings(state(), DATE).map((b) => b.id)).toEqual(['keep']);
  });

  it('is not undone by a fetch that started before the deletion', async () => {
    const { api, store, state } = await loaded();
    const slowFetch = deferred<Booking[]>();
    api.list.mockReturnValueOnce(slowFetch.promise);

    const fetchRequest = store.dispatch(fetchDayBookings({ date: DATE, force: true }));
    await store.dispatch(deleteBooking(target));
    slowFetch.resolve([target, neighbour]); // Response reflects the server before the delete.
    await fetchRequest;

    expect(selectDayBookings(state(), DATE).map((b) => b.id)).toEqual(['keep']);
  });
});
