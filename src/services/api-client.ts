import axios, { type AxiosInstance, type CreateAxiosDefaults } from 'axios';

import type { ApiErrorBody, ApiErrorCode, Booking, FieldErrors } from '@/core/domain/booking.types';

export interface ApiErrorOptions {
  details?: FieldErrors;
  cause?: unknown;
}

/** Normalized error for every failed API call. UI code never sees raw Axios errors. */
export class ApiError extends Error {
  override readonly name: string = 'ApiError';
  readonly status: number;
  readonly code: ApiErrorCode;
  readonly details?: FieldErrors;

  constructor(status: number, code: ApiErrorCode, message: string, options: ApiErrorOptions = {}) {
    super(message, { cause: options.cause });
    this.status = status;
    this.code = code;
    this.details = options.details;
  }
}

/** HTTP 409: the server rejected a booking because the slot is already taken. */
export class ConflictError extends ApiError {
  override readonly name: string = 'ConflictError';
  /** The booking that occupies the requested slot, when the server reports it. */
  readonly conflict?: Booking;

  constructor(message: string, options: ApiErrorOptions & { conflict?: Booking } = {}) {
    super(409, 'BOOKING_CONFLICT', message, options);
    this.conflict = options.conflict;
  }
}

export const isApiError = (error: unknown): error is ApiError => error instanceof ApiError;

export const isConflictError = (error: unknown): error is ConflictError => error instanceof ConflictError;

const DEFAULT_MESSAGES: Record<ApiErrorCode, string> = {
  VALIDATION_ERROR: 'Проверьте введённые данные.',
  BOOKING_CONFLICT: 'Это время уже занято.',
  NOT_FOUND: 'Бронирование не найдено — возможно, его уже удалили.',
  BAD_REQUEST: 'Сервер не смог обработать запрос.',
  INTERNAL_ERROR: 'Ошибка на сервере. Попробуйте ещё раз.',
  NETWORK_ERROR: 'Нет соединения с сервером. Проверьте подключение к сети.',
  TIMEOUT: 'Сервер не ответил вовремя. Попробуйте ещё раз.',
  CANCELED: 'Запрос отменён.',
  UNKNOWN_ERROR: 'Что-то пошло не так. Попробуйте ещё раз.',
};

const API_ERROR_CODES = new Set<string>(Object.keys(DEFAULT_MESSAGES));

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 400 || status === 422) return 'VALIDATION_ERROR';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409) return 'BOOKING_CONFLICT';
  if (status >= 500) return 'INTERNAL_ERROR';
  if (status >= 400) return 'BAD_REQUEST';
  return 'UNKNOWN_ERROR';
}

export function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false;
  const inner = (value as { error: unknown }).error;
  return (
    typeof inner === 'object' &&
    inner !== null &&
    typeof (inner as { message?: unknown }).message === 'string'
  );
}

/**
 * Maps anything thrown by Axios (or already-normalized errors) to an `ApiError`.
 * 409 responses always become a `ConflictError`, regardless of the body.
 */
export function normalizeApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;

  if (axios.isCancel(error) || (axios.isAxiosError(error) && error.code === 'ERR_CANCELED')) {
    return new ApiError(0, 'CANCELED', DEFAULT_MESSAGES.CANCELED, { cause: error });
  }

  if (axios.isAxiosError(error)) {
    const { response } = error;

    if (!response) {
      const timedOut = error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT';
      const code: ApiErrorCode = timedOut ? 'TIMEOUT' : 'NETWORK_ERROR';
      return new ApiError(0, code, DEFAULT_MESSAGES[code], { cause: error });
    }

    const body = isApiErrorBody(response.data) ? response.data.error : undefined;
    const status = response.status;

    if (status === 409) {
      return new ConflictError(body?.message ?? DEFAULT_MESSAGES.BOOKING_CONFLICT, {
        conflict: body?.conflict,
        details: body?.details,
        cause: error,
      });
    }

    const code = body?.code && API_ERROR_CODES.has(body.code) ? body.code : codeFromStatus(status);
    return new ApiError(status, code, body?.message ?? DEFAULT_MESSAGES[code], {
      details: body?.details,
      cause: error,
    });
  }

  const message = error instanceof Error && error.message ? error.message : DEFAULT_MESSAGES.UNKNOWN_ERROR;
  return new ApiError(0, 'UNKNOWN_ERROR', message, { cause: error });
}

export const API_BASE_URL = '/api';
export const API_TIMEOUT_MS = 10_000;

/** Builds a configured Axios instance. Exposed as a factory so tests can inject an adapter. */
export function createApiClient(config: CreateAxiosDefaults = {}): AxiosInstance {
  const client = axios.create({
    baseURL: API_BASE_URL,
    timeout: API_TIMEOUT_MS,
    ...config,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...config.headers,
    },
  });

  client.interceptors.response.use(
    (response) => {
      // 204 No Content: give callers a predictable `undefined` instead of an empty string.
      if (response.status === 204) response.data = undefined;
      return response;
    },
    (error: unknown) => Promise.reject(normalizeApiError(error)),
  );

  return client;
}

export const apiClient = createApiClient();

/**
 * Plain-object form of an `ApiError`. Redux state and actions must be serializable,
 * so thunks reject with this shape instead of class instances.
 */
export interface ApiErrorPayload {
  status: number;
  code: ApiErrorCode;
  message: string;
  details?: FieldErrors;
  /** Present on 409 responses when the server names the booking that holds the slot. */
  conflict?: Booking;
}

export function isApiErrorPayload(value: unknown): value is ApiErrorPayload {
  if (typeof value !== 'object' || value === null || value instanceof Error) return false;
  const candidate = value as Partial<ApiErrorPayload>;
  return (
    typeof candidate.status === 'number' &&
    typeof candidate.message === 'string' &&
    typeof candidate.code === 'string' &&
    API_ERROR_CODES.has(candidate.code)
  );
}

/** Converts anything thrown (Axios errors, `ApiError`, existing payloads) into an `ApiErrorPayload`. */
export function toApiErrorPayload(error: unknown): ApiErrorPayload {
  if (isApiErrorPayload(error)) return error;
  const apiError = normalizeApiError(error);
  return {
    status: apiError.status,
    code: apiError.code,
    message: apiError.message,
    ...(apiError.details ? { details: apiError.details } : {}),
    ...(isConflictError(apiError) && apiError.conflict ? { conflict: apiError.conflict } : {}),
  };
}

export const isConflictPayload = (error: ApiErrorPayload | null | undefined): boolean =>
  error?.code === 'BOOKING_CONFLICT';
