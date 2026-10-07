'use client';

import { useState } from 'react';
import type { FieldPath, UseFormReturn } from 'react-hook-form';

import type { Booking, BookingFormValues, BookingTiming } from '@/core/domain/booking.types';
import { type ApiErrorPayload, isConflictPayload, toApiErrorPayload } from '@/services/api-client';
import { createBooking, fetchDayBookings, updateBooking } from '@/store';
import { useAppDispatch } from '@/store/hooks';

const SERVER_FIELDS: readonly FieldPath<BookingFormValues>[] = ['title', 'date', 'startTime', 'endTime'];

const sameTiming = (a: BookingTiming, b: BookingTiming) =>
  a.date === b.date && a.startTime === b.startTime && a.endTime === b.endTime;

interface ServerFailure {
  error: ApiErrorPayload;
  timing: BookingTiming;
}

interface UseBookingSubmitOptions {
  form: UseFormReturn<BookingFormValues>;
  editingBooking: Booking | null;
  /** Timing currently selected in the form, used to hide stale conflict alerts. */
  currentTiming: BookingTiming;
  onSaved: (booking: Booking, kind: 'created' | 'updated') => void;
}

/**
 * Create / update submission. A 409 is surfaced as `serverError`, the day is
 * re-fetched in the background, and the user's input is left exactly as typed.
 */
export function useBookingSubmit({ form, editingBooking, currentTiming, onSaved }: UseBookingSubmitOptions) {
  const dispatch = useAppDispatch();
  const { handleSubmit, setError, trigger } = form;
  const [serverFailure, setServerFailure] = useState<ServerFailure | null>(null);

  const onSubmit = handleSubmit(async (values) => {
    setServerFailure(null);
    try {
      if (editingBooking) {
        onSaved(await dispatch(updateBooking({ id: editingBooking.id, changes: values })).unwrap(), 'updated');
      } else {
        onSaved(await dispatch(createBooking(values)).unwrap(), 'created');
      }
    } catch (error) {
      // `unwrap()` rejects with the thunk's serialized `ApiErrorPayload`.
      const apiError = toApiErrorPayload(error);
      setServerFailure({
        error: apiError,
        timing: { date: values.date, startTime: values.startTime, endTime: values.endTime },
      });

      if (isConflictPayload(apiError)) {
        // Rule 8: refresh the grid in the background to reveal what took the slot.
        // Form values are deliberately left untouched.
        void dispatch(fetchDayBookings({ date: values.date, force: true })).then(() => trigger(['startTime', 'endTime']));
      } else if (apiError.code === 'VALIDATION_ERROR' && apiError.details) {
        for (const field of SERVER_FIELDS) {
          const fieldMessage = apiError.details[field]?.[0];
          if (fieldMessage) setError(field, { type: 'server', message: fieldMessage });
        }
      } else if (apiError.code === 'NOT_FOUND' && editingBooking) {
        void dispatch(fetchDayBookings({ date: editingBooking.date, force: true }));
      }
    }
  });

  // A conflict alert is only relevant while the user still has the rejected timing selected.
  const serverError =
    serverFailure && !(isConflictPayload(serverFailure.error) && !sameTiming(serverFailure.timing, currentTiming))
      ? serverFailure.error
      : null;

  return { onSubmit, serverError, clearServerError: () => setServerFailure(null) };
}
