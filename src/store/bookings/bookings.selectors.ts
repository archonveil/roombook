import { createSelector } from '@reduxjs/toolkit';

import type { Booking, IsoDate } from '@/core/domain/booking.types';
import type { ApiErrorPayload } from '@/services/api-client';

import type { RootState } from '../index';
import type { LoadStatus } from './bookings.types';

const EMPTY_BOOKINGS: readonly Booking[] = Object.freeze([]);

export const selectBookingsState = (state: RootState) => state.bookings;

export const selectSelectedDate = (state: RootState): IsoDate | null => state.bookings.selectedDate;

export const selectBookingsByDate = (state: RootState) => state.bookings.byDate;

/** Returns the same empty array for unloaded dates so components don't re-render needlessly. */
export const selectDayBookings = (state: RootState, date: IsoDate): readonly Booking[] =>
  state.bookings.byDate[date] ?? EMPTY_BOOKINGS;

export const selectIsDayLoaded = (state: RootState, date: IsoDate): boolean => date in state.bookings.byDate;

export const selectDayStatus = (state: RootState, date: IsoDate): LoadStatus =>
  state.bookings.statusByDate[date] ?? 'idle';

export const selectDayError = (state: RootState, date: IsoDate): ApiErrorPayload | null =>
  state.bookings.errorByDate[date] ?? null;

/** True while cached data for the day is shown and a background refresh is running. */
export const selectIsDayRefreshing = (state: RootState, date: IsoDate): boolean =>
  date in state.bookings.byDate && Boolean(state.bookings.pendingRequestByDate[date]);

/** Dates that have at least one booking — the calendar's dot markers. */
export const selectMarkedDates = createSelector([selectBookingsByDate], (byDate): ReadonlySet<IsoDate> =>
  new Set(Object.keys(byDate).filter((date) => (byDate[date]?.length ?? 0) > 0)),
);

export const selectIsMutating = (state: RootState): boolean => state.bookings.pendingMutations > 0;
