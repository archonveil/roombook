import type { AxiosInstance } from 'axios';

import type { Booking, BookingListQuery, CreateBookingPayload, UpdateBookingPayload } from '@/core/domain/booking.types';

import { apiClient } from './api-client';

const BOOKINGS_PATH = '/bookings';

/** Contract of the bookings API, so callers (e.g. Redux thunks) can be given a fake in tests. */
export interface BookingApi {
  list(query: BookingListQuery, signal?: AbortSignal): Promise<Booking[]>;
  create(payload: CreateBookingPayload): Promise<Booking>;
  update(id: string, payload: UpdateBookingPayload): Promise<Booking>;
  remove(id: string): Promise<void>;
}

/**
 * Typed mapping of the bookings REST endpoints. Every method rejects with an
 * `ApiError` (or `ConflictError` for 409) thanks to the client's interceptor.
 */
export class BookingService implements BookingApi {
  constructor(private readonly client: AxiosInstance = apiClient) {}

  async list(query: BookingListQuery, signal?: AbortSignal): Promise<Booking[]> {
    const { data } = await this.client.get<Booking[]>(BOOKINGS_PATH, { params: query, signal });
    return data;
  }

  async create(payload: CreateBookingPayload): Promise<Booking> {
    const { data } = await this.client.post<Booking>(BOOKINGS_PATH, payload);
    return data;
  }

  async update(id: string, payload: UpdateBookingPayload): Promise<Booking> {
    const { data } = await this.client.patch<Booking>(`${BOOKINGS_PATH}/${encodeURIComponent(id)}`, payload);
    return data;
  }

  async remove(id: string): Promise<void> {
    await this.client.delete(`${BOOKINGS_PATH}/${encodeURIComponent(id)}`);
  }
}

export const bookingService = new BookingService();
