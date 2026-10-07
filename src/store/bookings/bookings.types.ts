import type { Booking, IsoDate, MonthKey } from '@/core/domain/booking.types';
import type { ApiErrorPayload } from '@/services/api-client';

export type LoadStatus = 'idle' | 'loading' | 'success' | 'error';

export interface BookingsState {
  /** Day shown in the timeline; `null` until the client clock is known. */
  selectedDate: IsoDate | null;
  /** Cache keyed by date. A key present (even with `[]`) means that day has been loaded. */
  byDate: Record<IsoDate, Booking[]>;
  /** `loading` only while a date has no cached data yet; later refreshes show via `pendingRequestByDate`. */
  statusByDate: Record<IsoDate, LoadStatus>;
  errorByDate: Record<IsoDate, ApiErrorPayload | null>;
  /** `requestId` of the in-flight day fetch, used for de-duplication and to drop superseded responses. */
  pendingRequestByDate: Record<IsoDate, string>;
  /**
   * Bumped on every write to a date (fetch result or mutation). A fetch records the
   * revision when it starts and is applied only if nothing was written since — so a
   * slow response can never overwrite fresher data or an optimistic update.
   */
  revisionByDate: Record<IsoDate, number>;
  statusByMonth: Record<MonthKey, LoadStatus>;
  pendingRequestByMonth: Record<MonthKey, string>;
  /** Number of create/update/delete requests in flight. */
  pendingMutations: number;
}

export interface FetchDayArgs {
  date: IsoDate;
  /** Bypass in-flight de-duplication and always hit the network. */
  force?: boolean;
}

export interface FetchMonthArgs {
  month: MonthKey;
  force?: boolean;
}
