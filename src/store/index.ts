import { combineReducers, configureStore } from '@reduxjs/toolkit';

import { bookingService } from '@/services/booking.service';

import { bookingsReducer } from './bookings/bookings.slice';
import type { ThunkExtra } from './bookings/bookings.thunks';

export const rootReducer = combineReducers({
  bookings: bookingsReducer,
});

export type RootState = ReturnType<typeof rootReducer>;

/**
 * Creates a store instance. With the App Router a store must never be a module
 * singleton (it would be shared between server requests), so `StoreProvider`
 * creates one per client session. Dependencies are injectable for tests.
 */
export function makeStore(extra: Partial<ThunkExtra> = {}, preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        thunk: { extraArgument: { bookingService, ...extra } satisfies ThunkExtra },
      }),
    devTools: process.env.NODE_ENV !== 'production',
  });
}

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];

export * from './bookings/bookings.slice';
export * from './bookings/bookings.thunks';
export * from './bookings/bookings.selectors';
export type * from './bookings/bookings.types';
