import { NextResponse } from 'next/server';
import { z } from 'zod';

import type { ApiErrorBody, ApiErrorCode, Booking, FieldErrors } from '@/core/domain/booking.types';

export function errorResponse(
  status: number,
  code: ApiErrorCode,
  message: string,
  extra: { details?: FieldErrors; conflict?: Booking } = {},
): NextResponse<ApiErrorBody> {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export function validationErrorResponse(error: z.ZodError): NextResponse<ApiErrorBody> {
  const { formErrors, fieldErrors } = z.flattenError(error);
  const firstMessage = formErrors[0] ?? Object.values<string[] | undefined>(fieldErrors).find(Boolean)?.[0];
  return errorResponse(400, 'VALIDATION_ERROR', firstMessage ?? 'Проверьте введённые данные.', {
    details: { ...fieldErrors, ...(formErrors.length ? { _form: formErrors } : {}) },
  });
}

/** Parses a JSON body; returns `undefined` for malformed JSON instead of throwing. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export const invalidJsonResponse = () =>
  errorResponse(400, 'BAD_REQUEST', 'Тело запроса должно быть корректным JSON.');

const MIN_LATENCY_MS = 200;
const MAX_LATENCY_MS = 600;

/**
 * Simulated network latency so loading states and races are observable in dev.
 * Must be awaited BEFORE any check-then-write sequence, never between the two.
 */
export async function simulateLatency(): Promise<void> {
  if (process.env.NODE_ENV === 'test' || process.env.MOCK_API_LATENCY === 'off') return;
  const ms = MIN_LATENCY_MS + Math.random() * (MAX_LATENCY_MS - MIN_LATENCY_MS);
  await new Promise((resolve) => setTimeout(resolve, ms));
}
