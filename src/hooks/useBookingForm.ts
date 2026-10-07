'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useCallback, useEffect, useRef } from 'react';
import { useForm, type Resolver, type UseFormReturn } from 'react-hook-form';

import { createBookingSchema } from '@/core/domain/booking.schema';
import type { Booking, BookingFormValues, IsoDate } from '@/core/domain/booking.types';
import { selectDayBookings } from '@/store';
import { useAppStore } from '@/store/hooks';

export const emptyBookingValues = (date: IsoDate, title = ''): BookingFormValues => ({
  title,
  date,
  startTime: '',
  endTime: '',
});

export interface UseBookingFormOptions {
  date: IsoDate;
  /** The booking being edited, or `null` when creating. */
  editingBooking: Booking | null;
}

/**
 * React Hook Form wired to the Zod booking schema. The resolver is rebuilt per
 * validation so rule 6 always uses the current time, and rule 5 always sees the
 * freshest cached bookings for the form's date (read straight from the store, so
 * a background refresh after a 409 is picked up immediately).
 */
export function useBookingForm({ date, editingBooking }: UseBookingFormOptions): UseFormReturn<BookingFormValues> {
  const store = useAppStore();
  const editingRef = useRef(editingBooking);
  useEffect(() => {
    editingRef.current = editingBooking;
  }, [editingBooking]);

  const resolver = useCallback<Resolver<BookingFormValues>>((values, context, options) => {
    const editing = editingRef.current;
    const schema = createBookingSchema({
      existingBookings: selectDayBookings(store.getState(), values.date),
      excludeId: editing?.id ?? null,
      original: editing,
    });
    return zodResolver(schema)(values, context, options);
  }, [store]);

  return useForm<BookingFormValues>({
    resolver,
    mode: 'onChange',
    reValidateMode: 'onChange',
    defaultValues: emptyBookingValues(date),
  });
}
