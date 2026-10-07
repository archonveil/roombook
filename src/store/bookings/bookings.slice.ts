import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';

import type { Booking, IsoDate } from '@/core/domain/booking.types';
import { eachDateInRange } from '@/core/utils/date.helpers';
import { sortBookingsByStart } from '@/core/utils/time.helpers';
import { toApiErrorPayload } from '@/services/api-client';

import {
  createBooking,
  deleteBooking,
  fetchDayBookings,
  fetchMonthBookings,
  updateBooking,
} from './bookings.thunks';
import type { BookingsState } from './bookings.types';

export const initialBookingsState: BookingsState = {
  selectedDate: null,
  byDate: {},
  statusByDate: {},
  errorByDate: {},
  pendingRequestByDate: {},
  revisionByDate: {},
  statusByMonth: {},
  pendingRequestByMonth: {},
  pendingMutations: 0,
};

/* ---------- Draft helpers (Immer: mutating the draft is safe) ---------- */

const bumpRevision = (state: BookingsState, date: IsoDate) => {
  state.revisionByDate[date] = (state.revisionByDate[date] ?? 0) + 1;
};

const putDay = (state: BookingsState, date: IsoDate, bookings: Booking[]) => {
  state.byDate[date] = sortBookingsByStart(bookings);
  state.statusByDate[date] = 'success';
  state.errorByDate[date] = null;
  bumpRevision(state, date);
};

const removeFromDay = (state: BookingsState, date: IsoDate, id: string) => {
  const day = state.byDate[date];
  if (day) state.byDate[date] = day.filter((booking) => booking.id !== id);
  bumpRevision(state, date);
};

const upsertIntoDay = (state: BookingsState, booking: Booking) => {
  const others = (state.byDate[booking.date] ?? []).filter((item) => item.id !== booking.id);
  state.byDate[booking.date] = sortBookingsByStart([...others, booking]);
  bumpRevision(state, booking.date);
};

const mutationThunks = [createBooking, updateBooking, deleteBooking] as const;

/* ---------- Slice ---------- */

const bookingsSlice = createSlice({
  name: 'bookings',
  initialState: initialBookingsState,
  reducers: {
    dateSelected(state, action: PayloadAction<IsoDate>) {
      state.selectedDate = action.payload;
    },
  },
  extraReducers: (builder) => {
    builder
      /* ----- Day ----- */
      .addCase(fetchDayBookings.pending, (state, { meta }) => {
        const { date } = meta.arg;
        state.pendingRequestByDate[date] = meta.requestId;
        if (!(date in state.byDate)) state.statusByDate[date] = 'loading';
      })
      .addCase(fetchDayBookings.fulfilled, (state, { payload, meta }) => {
        const { date, bookings, revision } = payload;
        // A newer request for this day superseded this one — its result will land instead.
        if (state.pendingRequestByDate[date] !== meta.requestId) return;
        delete state.pendingRequestByDate[date];
        // Something was written to this day while the request was in flight: keep the fresher data.
        if ((state.revisionByDate[date] ?? 0) !== revision) {
          if (date in state.byDate) state.statusByDate[date] = 'success';
          return;
        }
        putDay(state, date, bookings);
      })
      .addCase(fetchDayBookings.rejected, (state, { payload, error, meta }) => {
        const { date } = meta.arg;
        if (state.pendingRequestByDate[date] !== meta.requestId) return;
        delete state.pendingRequestByDate[date];
        // Keep showing cached data when a background refresh fails.
        state.statusByDate[date] = date in state.byDate ? 'success' : 'error';
        state.errorByDate[date] = payload ?? toApiErrorPayload(error);
      })

      /* ----- Month ----- */
      .addCase(fetchMonthBookings.pending, (state, { meta }) => {
        state.pendingRequestByMonth[meta.arg.month] = meta.requestId;
        state.statusByMonth[meta.arg.month] = 'loading';
      })
      .addCase(fetchMonthBookings.fulfilled, (state, { payload, meta }) => {
        const { month } = meta.arg;
        if (state.pendingRequestByMonth[month] !== meta.requestId) return;
        delete state.pendingRequestByMonth[month];
        state.statusByMonth[month] = 'success';

        const grouped = new Map<IsoDate, Booking[]>();
        payload.bookings.forEach((booking) => grouped.set(booking.date, [...(grouped.get(booking.date) ?? []), booking]));

        for (const date of eachDateInRange(payload.from, payload.to)) {
          const unchanged = (state.revisionByDate[date] ?? 0) === (payload.revisions[date] ?? 0);
          // Skip days written since the request started, or with their own fetch in flight.
          if (unchanged && !state.pendingRequestByDate[date]) putDay(state, date, grouped.get(date) ?? []);
        }
      })
      .addCase(fetchMonthBookings.rejected, (state, { meta }) => {
        const { month } = meta.arg;
        if (state.pendingRequestByMonth[month] !== meta.requestId) return;
        delete state.pendingRequestByMonth[month];
        // Month data only powers calendar markers; day fetches surface errors to the user.
        state.statusByMonth[month] = 'error';
      })

      /* ----- Mutations ----- */
      .addCase(createBooking.fulfilled, (state, { payload }) => {
        upsertIntoDay(state, payload);
      })
      .addCase(updateBooking.fulfilled, (state, { payload }) => {
        // The date may have changed: drop the booking from wherever it was cached.
        for (const date of Object.keys(state.byDate)) {
          if (date !== payload.date && state.byDate[date]?.some((booking) => booking.id === payload.id)) {
            removeFromDay(state, date, payload.id);
          }
        }
        upsertIntoDay(state, payload);
      })
      .addCase(deleteBooking.pending, (state, { meta }) => {
        removeFromDay(state, meta.arg.date, meta.arg.id);
      })
      .addCase(deleteBooking.rejected, (state, { meta }) => {
        // Roll back the optimistic removal.
        upsertIntoDay(state, meta.arg);
      })
      .addMatcher(isAnyOf(...mutationThunks.map((thunk) => thunk.pending)), (state) => {
        state.pendingMutations += 1;
      })
      .addMatcher(
        isAnyOf(...mutationThunks.flatMap((thunk) => [thunk.fulfilled, thunk.rejected])),
        (state) => {
          state.pendingMutations = Math.max(0, state.pendingMutations - 1);
        },
      );
  },
});

export const { dateSelected } = bookingsSlice.actions;
export const bookingsReducer = bookingsSlice.reducer;
