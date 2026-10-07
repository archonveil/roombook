'use client';

import { useMemo } from 'react';

import { SLOT_MINUTES, WORKDAY_END_MINUTES, WORKDAY_START_MINUTES } from '@/core/domain/booking.constants';
import type { Booking, IsoDate } from '@/core/domain/booking.types';
import { getMinutesOfDay, getTodayIso, isPastDate, isPastSlot, isValidIsoDate } from '@/core/utils/date.helpers';
import { isMinuteOccupied } from '@/core/utils/time.helpers';

const ALL_MINUTES = Array.from({ length: 60 }, (_, minute) => minute);
const ALL_HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** Builds AntD `disabledTime` from a per-minute predicate. */
const buildDisabledTime = (isDisabled: (minutes: number) => boolean) => () => ({
  disabledHours: () =>
    ALL_HOURS.filter((hour) => [0, SLOT_MINUTES].every((minute) => isDisabled(hour * 60 + minute))),
  disabledMinutes: (hour: number) => ALL_MINUTES.filter((minute) => isDisabled(hour * 60 + minute)),
});

/** AntD `disabledTime` callbacks for the start / end pickers (rules 1, 5, 6). */
export function useTimeConstraints(date: IsoDate, dayBookings: readonly Booking[], editingBooking: Booking | null, now: Date) {
  const others = useMemo(
    () => (editingBooking ? dayBookings.filter((booking) => booking.id !== editingBooking.id) : dayBookings),
    [dayBookings, editingBooking],
  );

  return useMemo(() => {
    const validDate = isValidIsoDate(date);
    const dateIsPast = validDate && isPastDate(date, now);
    const nowMinutes = date === getTodayIso(now) ? getMinutesOfDay(now) : -1;

    return {
      startTime: buildDisabledTime(
        (minutes) =>
          minutes < WORKDAY_START_MINUTES ||
          minutes >= WORKDAY_END_MINUTES ||
          (validDate && isPastSlot(date, minutes, now)) ||
          isMinuteOccupied(minutes, others),
      ),
      endTime: buildDisabledTime(
        (minutes) =>
          minutes <= WORKDAY_START_MINUTES ||
          minutes > WORKDAY_END_MINUTES ||
          dateIsPast ||
          minutes <= nowMinutes ||
          // An end time is unavailable if the minute just before it is taken.
          isMinuteOccupied(minutes - 1, others),
      ),
    };
  }, [date, now, others]);
}
