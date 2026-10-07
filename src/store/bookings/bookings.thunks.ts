import { createAsyncThunk } from '@reduxjs/toolkit';

import type { Booking, BookingFormValues, IsoDate, UpdateBookingPayload } from '@/core/domain/booking.types';
import { getMonthRange } from '@/core/utils/date.helpers';
import { type ApiErrorPayload, toApiErrorPayload } from '@/services/api-client';
import type { BookingApi } from '@/services/booking.service';

import type { BookingsState, FetchDayArgs, FetchMonthArgs } from './bookings.types';

/** Dependencies injected into every thunk via the store's `extraArgument`. */
export interface ThunkExtra {
  bookingService: BookingApi;
}

// The state type is declared locally (not via RootState) to avoid an import cycle with the store.
const createAppAsyncThunk = createAsyncThunk.withTypes<{
  state: { bookings: BookingsState };
  extra: ThunkExtra;
  rejectValue: ApiErrorPayload;
}>();

export interface DayBookingsResult {
  date: IsoDate;
  bookings: Booking[];
  /** Revision of the date when the request started. */
  revision: number;
}

export const fetchDayBookings = createAppAsyncThunk(
  'bookings/fetchDay',
  async ({ date }: FetchDayArgs, { getState, extra, signal, rejectWithValue }) => {
    const revision = getState().bookings.revisionByDate[date] ?? 0;
    try {
      const bookings = await extra.bookingService.list({ date }, signal);
      return { date, bookings, revision } satisfies DayBookingsResult;
    } catch (error) {
      return rejectWithValue(toApiErrorPayload(error));
    }
  },
  {
    // De-duplicate: skip when the same day is already loading, unless forced.
    condition: ({ date, force }, { getState }) => Boolean(force) || !getState().bookings.pendingRequestByDate[date],
  },
);

export interface MonthBookingsResult {
  from: IsoDate;
  to: IsoDate;
  bookings: Booking[];
  /** Revisions of every date in the range when the request started. */
  revisions: Record<IsoDate, number>;
}

/** Loads a whole month: fills the day cache and powers the calendar markers. */
export const fetchMonthBookings = createAppAsyncThunk(
  'bookings/fetchMonth',
  async ({ month }: FetchMonthArgs, { getState, extra, signal, rejectWithValue }) => {
    const { from, to } = getMonthRange(month);
    const revisions = { ...getState().bookings.revisionByDate };
    try {
      const bookings = await extra.bookingService.list({ from, to }, signal);
      return { from, to, bookings, revisions } satisfies MonthBookingsResult;
    } catch (error) {
      return rejectWithValue(toApiErrorPayload(error));
    }
  },
  {
    condition: ({ month, force }, { getState }) => Boolean(force) || !getState().bookings.pendingRequestByMonth[month],
  },
);

export const createBooking = createAppAsyncThunk(
  'bookings/create',
  async (values: BookingFormValues, { extra, rejectWithValue }) => {
    try {
      return await extra.bookingService.create(values);
    } catch (error) {
      return rejectWithValue(toApiErrorPayload(error));
    }
  },
);

export const updateBooking = createAppAsyncThunk(
  'bookings/update',
  async ({ id, changes }: { id: string; changes: UpdateBookingPayload }, { extra, rejectWithValue }) => {
    try {
      return await extra.bookingService.update(id, changes);
    } catch (error) {
      return rejectWithValue(toApiErrorPayload(error));
    }
  },
);

/**
 * Optimistic: the slice removes the booking on `pending` and restores it on `rejected`.
 * A 404 means someone else already deleted it, so it counts as success and the day is re-synced.
 */
export const deleteBooking = createAppAsyncThunk(
  'bookings/delete',
  async (booking: Booking, { extra, dispatch, rejectWithValue }) => {
    try {
      await extra.bookingService.remove(booking.id);
    } catch (error) {
      const payload = toApiErrorPayload(error);
      if (payload.code !== 'NOT_FOUND') return rejectWithValue(payload);
      void dispatch(fetchDayBookings({ date: booking.date, force: true }));
    }
    return { id: booking.id, date: booking.date };
  },
);
