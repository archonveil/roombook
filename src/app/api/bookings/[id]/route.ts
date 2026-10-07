import { NextResponse, type NextRequest } from 'next/server';

import { BOOKING_MESSAGES, bookingUpdateSchema, createBookingSchema } from '@/core/domain/booking.schema';
import type { ApiErrorBody, Booking, BookingFormValues } from '@/core/domain/booking.types';
import { findConflictingBooking, formatTimeRange } from '@/core/utils/time.helpers';

import { findBooking, getBookingsForDate, removeBooking, replaceBooking } from '../_lib/bookings-db';
import {
  errorResponse,
  invalidJsonResponse,
  readJson,
  simulateLatency,
  validationErrorResponse,
} from '../_lib/http';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const notFound = () => errorResponse(404, 'NOT_FOUND', 'Бронирование не найдено — возможно, его уже удалили.');

/** PATCH /api/bookings/:id — partial update. 400 on rule violations, 404 if missing, 409 on overlap. */
export async function PATCH(request: NextRequest, { params }: RouteContext): Promise<NextResponse<Booking | ApiErrorBody>> {
  const { id } = await params;
  await simulateLatency();

  const body = await readJson(request);
  if (body === undefined) return invalidJsonResponse();

  const patch = bookingUpdateSchema.safeParse(body);
  if (!patch.success) return validationErrorResponse(patch.error);

  // Synchronous from here on: lookup, validation, overlap check and write are atomic.
  const existing = findBooking(id);
  if (!existing) return notFound();

  const merged: BookingFormValues = {
    title: patch.data.title ?? existing.title,
    date: patch.data.date ?? existing.date,
    startTime: patch.data.startTime ?? existing.startTime,
    endTime: patch.data.endTime ?? existing.endTime,
  };

  const now = new Date();
  // `original` lets an ongoing booking be renamed without tripping the past-time rule.
  const parsed = createBookingSchema({ now: () => now, original: existing }).safeParse(merged);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  // Rule 7: the booking never conflicts with its own original slot.
  const conflict = findConflictingBooking(parsed.data, getBookingsForDate(parsed.data.date), id);
  if (conflict) {
    return errorResponse(
      409,
      'BOOKING_CONFLICT',
      `Пока вы редактировали, это время заняли: ${formatTimeRange(conflict.startTime, conflict.endTime)} «${conflict.title}».`,
      { conflict, details: { endTime: [BOOKING_MESSAGES.conflict(conflict)] } },
    );
  }

  const updated = replaceBooking(id, parsed.data, now);
  return updated ? NextResponse.json(updated) : notFound();
}

/** DELETE /api/bookings/:id — 204 on success, 404 if it does not exist. */
export async function DELETE(_request: NextRequest, { params }: RouteContext): Promise<Response> {
  const { id } = await params;
  await simulateLatency();

  if (!removeBooking(id)) return notFound();
  return new Response(null, { status: 204 });
}
