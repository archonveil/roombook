import { NextResponse, type NextRequest } from 'next/server';

import { BOOKING_MESSAGES, bookingListQuerySchema, createBookingSchema } from '@/core/domain/booking.schema';
import type { ApiErrorBody, Booking } from '@/core/domain/booking.types';
import { findConflictingBooking, formatTimeRange } from '@/core/utils/time.helpers';

import { getBookingsForDate, insertBooking, listBookings } from './_lib/bookings-db';
import {
  errorResponse,
  invalidJsonResponse,
  readJson,
  simulateLatency,
  validationErrorResponse,
} from './_lib/http';

/** GET /api/bookings?date=YYYY-MM-DD  |  GET /api/bookings?from=YYYY-MM-DD&to=YYYY-MM-DD */
export async function GET(request: NextRequest): Promise<NextResponse<Booking[] | ApiErrorBody>> {
  await simulateLatency();

  const query = bookingListQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) {
    return errorResponse(400, 'VALIDATION_ERROR', 'Укажите параметр date или пару from и to в формате YYYY-MM-DD.');
  }

  return NextResponse.json(listBookings(query.data), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

/** POST /api/bookings — create a booking. 400 on rule violations, 409 on overlap. */
export async function POST(request: NextRequest): Promise<NextResponse<Booking | ApiErrorBody>> {
  await simulateLatency();

  const body = await readJson(request);
  if (body === undefined) return invalidJsonResponse();

  const now = new Date();
  const parsed = createBookingSchema({ now: () => now }).safeParse(body);
  if (!parsed.success) return validationErrorResponse(parsed.error);

  // Synchronous from here on: the overlap check and the insert cannot interleave with another request.
  const conflict = findConflictingBooking(parsed.data, getBookingsForDate(parsed.data.date));
  if (conflict) {
    return errorResponse(
      409,
      'BOOKING_CONFLICT',
      `Пока вы заполняли форму, это время заняли: ${formatTimeRange(conflict.startTime, conflict.endTime)} «${conflict.title}».`,
      { conflict, details: { endTime: [BOOKING_MESSAGES.conflict(conflict)] } },
    );
  }

  const booking = insertBooking(parsed.data, now);
  return NextResponse.json(booking, { status: 201 });
}
