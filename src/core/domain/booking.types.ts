/** Calendar date in `YYYY-MM-DD` format (local, no timezone). */
export type IsoDate = string;

/** Month key in `YYYY-MM` format. */
export type MonthKey = string;

/** Time of day in 24h `HH:mm` format. */
export type TimeOfDay = string;

/** A booking as persisted by the API. */
export interface Booking {
  id: string;
  title: string;
  date: IsoDate;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
  createdAt: string;
  updatedAt: string;
}

/** Values edited in the booking form; also the shape of a create payload. */
export interface BookingFormValues {
  title: string;
  date: IsoDate;
  startTime: TimeOfDay;
  endTime: TimeOfDay;
}

export type CreateBookingPayload = BookingFormValues;

export type UpdateBookingPayload = Partial<BookingFormValues>;

/** The timing part of a booking, used for overlap checks. */
export type BookingTiming = Pick<Booking, 'date' | 'startTime' | 'endTime'>;

/** Half-open interval `[start, end)` in minutes from midnight. */
export interface TimeInterval {
  start: number;
  end: number;
}

export type BookingListQuery = { date: IsoDate } | { from: IsoDate; to: IsoDate };

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'BOOKING_CONFLICT'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'INTERNAL_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'CANCELED'
  | 'UNKNOWN_ERROR';

/** Field name → list of messages, as produced by `z.flattenError`. */
export type FieldErrors = Partial<Record<string, string[]>>;

/** JSON body of every non-2xx API response. */
export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: FieldErrors;
    conflict?: Booking;
  };
}
