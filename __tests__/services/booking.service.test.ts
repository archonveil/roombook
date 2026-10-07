import { AxiosError, AxiosHeaders, CanceledError, type AxiosAdapter, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';

import type { Booking } from '@/core/domain/booking.types';
import {
  ApiError,
  ConflictError,
  createApiClient,
  isApiError,
  isConflictError,
  normalizeApiError,
} from '@/services/api-client';
import { BookingService } from '@/services/booking.service';

const BOOKING: Booking = {
  id: 'b1',
  title: 'Демо для клиента',
  date: '2026-10-08',
  startTime: '14:00',
  endTime: '15:30',
  createdAt: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:00:00.000Z',
};

type Reply = { status: number; data?: unknown } | { network: 'timeout' | 'offline' | 'canceled' };

/**
 * Minimal Axios adapter that mimics the real one's `settle` behaviour:
 * non-2xx statuses reject with an AxiosError carrying the response.
 */
function createMockAdapter(reply: Reply | ((config: InternalAxiosRequestConfig) => Reply)) {
  const calls: InternalAxiosRequestConfig[] = [];
  const adapter: AxiosAdapter = async (config) => {
    calls.push(config);
    const result = typeof reply === 'function' ? reply(config) : reply;

    if ('network' in result) {
      if (result.network === 'timeout') {
        throw new AxiosError('timeout of 10000ms exceeded', AxiosError.ECONNABORTED, config);
      }
      if (result.network === 'canceled') {
        throw new CanceledError(undefined, config);
      }
      throw new AxiosError('Network Error', AxiosError.ERR_NETWORK, config);
    }

    const response: AxiosResponse = {
      data: result.data,
      status: result.status,
      statusText: String(result.status),
      headers: new AxiosHeaders(),
      config,
    };
    if (result.status >= 200 && result.status < 300) return response;
    throw new AxiosError(`Request failed with status code ${result.status}`, AxiosError.ERR_BAD_RESPONSE, config, null, response);
  };
  return { adapter, calls };
}

function serviceWith(reply: Parameters<typeof createMockAdapter>[0]) {
  const mock = createMockAdapter(reply);
  return { service: new BookingService(createApiClient({ adapter: mock.adapter })), calls: mock.calls };
}

async function captureError(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('Expected the promise to reject');
}

describe('BookingService — endpoint mapping', () => {
  it('GET /bookings with a date query', async () => {
    const { service, calls } = serviceWith({ status: 200, data: [BOOKING] });
    await expect(service.list({ date: '2026-10-08' })).resolves.toEqual([BOOKING]);
    expect(calls[0]?.method).toBe('get');
    expect(calls[0]?.url).toBe('/bookings');
    expect(calls[0]?.baseURL).toBe('/api');
    expect(calls[0]?.params).toEqual({ date: '2026-10-08' });
  });

  it('GET /bookings with a range query', async () => {
    const { service, calls } = serviceWith({ status: 200, data: [] });
    await service.list({ from: '2026-10-01', to: '2026-10-31' });
    expect(calls[0]?.params).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('POST /bookings with a JSON body', async () => {
    const { service, calls } = serviceWith({ status: 201, data: BOOKING });
    const payload = { title: BOOKING.title, date: BOOKING.date, startTime: '14:00', endTime: '15:30' };
    await expect(service.create(payload)).resolves.toEqual(BOOKING);
    expect(calls[0]?.method).toBe('post');
    expect(JSON.parse(String(calls[0]?.data))).toEqual(payload);
    expect(calls[0]?.headers.get('Content-Type')).toBe('application/json');
  });

  it('PATCH /bookings/:id with an encoded id', async () => {
    const { service, calls } = serviceWith({ status: 200, data: BOOKING });
    await service.update('id with/slash', { title: 'Новое' });
    expect(calls[0]?.method).toBe('patch');
    expect(calls[0]?.url).toBe('/bookings/id%20with%2Fslash');
  });

  it('DELETE /bookings/:id resolves to undefined on 204', async () => {
    const { service, calls } = serviceWith({ status: 204, data: '' });
    await expect(service.remove('b1')).resolves.toBeUndefined();
    expect(calls[0]?.method).toBe('delete');
    expect(calls[0]?.url).toBe('/bookings/b1');
  });
});

describe('api-client error interceptor', () => {
  it('turns a 409 into a ConflictError carrying the conflicting booking', async () => {
    const { service } = serviceWith({
      status: 409,
      data: { error: { code: 'BOOKING_CONFLICT', message: 'Пока вы заполняли форму, это время заняли.', conflict: BOOKING } },
    });

    const error = await captureError(service.create({ title: 'x', date: BOOKING.date, startTime: '14:30', endTime: '15:00' }));

    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toBeInstanceOf(ApiError);
    expect(isConflictError(error)).toBe(true);
    const conflict = error as ConflictError;
    expect(conflict.status).toBe(409);
    expect(conflict.code).toBe('BOOKING_CONFLICT');
    expect(conflict.message).toBe('Пока вы заполняли форму, это время заняли.');
    expect(conflict.conflict).toEqual(BOOKING);
  });

  it('bubbles a 409 as ConflictError even without a JSON body', async () => {
    const { service } = serviceWith({ status: 409, data: '<html>Conflict</html>' });
    const error = await captureError(service.update('b1', { startTime: '10:00' }));
    expect(isConflictError(error)).toBe(true);
    expect((error as ConflictError).message).toBe('Это время уже занято.');
    expect((error as ConflictError).conflict).toBeUndefined();
  });

  it('maps a 400 to a VALIDATION_ERROR with field details', async () => {
    const details = { endTime: ['Максимальная длительность — 2 часа.'] };
    const { service } = serviceWith({
      status: 400,
      data: { error: { code: 'VALIDATION_ERROR', message: 'Максимальная длительность — 2 часа.', details } },
    });
    const error = await captureError(service.create({ title: 'x', date: BOOKING.date, startTime: '09:00', endTime: '12:00' }));
    expect(isApiError(error)).toBe(true);
    expect(isConflictError(error)).toBe(false);
    expect(error).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', details });
  });

  it('maps a 404 to NOT_FOUND', async () => {
    const { service } = serviceWith({ status: 404, data: { error: { code: 'NOT_FOUND', message: 'Не найдено.' } } });
    await expect(service.remove('missing')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND', message: 'Не найдено.' });
  });

  it('falls back to a status-derived code and default message for unstructured 5xx bodies', async () => {
    const { service } = serviceWith({ status: 503, data: 'Service Unavailable' });
    const error = await captureError(service.list({ date: BOOKING.date }));
    expect(error).toMatchObject({ status: 503, code: 'INTERNAL_ERROR' });
    expect((error as ApiError).message).toMatch(/Ошибка на сервере/);
  });

  it('ignores unknown error codes from the server', async () => {
    const { service } = serviceWith({ status: 400, data: { error: { code: 'SOMETHING_NEW', message: 'Странно.' } } });
    await expect(service.list({ date: BOOKING.date })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Странно.' });
  });

  it.each([
    ['timeout', 'TIMEOUT'],
    ['offline', 'NETWORK_ERROR'],
    ['canceled', 'CANCELED'],
  ] as const)('maps a %s failure without a response to %s', async (network, code) => {
    const { service } = serviceWith({ network });
    await expect(service.list({ date: BOOKING.date })).rejects.toMatchObject({ status: 0, code });
  });

  it('keeps the original Axios error as the cause', async () => {
    const { service } = serviceWith({ status: 500 });
    const error = (await captureError(service.list({ date: BOOKING.date }))) as ApiError;
    expect(error.cause).toBeInstanceOf(AxiosError);
  });
});

describe('normalizeApiError', () => {
  it('returns ApiError instances untouched', () => {
    const original = new ConflictError('taken');
    expect(normalizeApiError(original)).toBe(original);
  });

  it('wraps arbitrary errors as UNKNOWN_ERROR', () => {
    const error = normalizeApiError(new TypeError('boom'));
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'UNKNOWN_ERROR', status: 0, message: 'boom' });
  });

  it('wraps non-Error values with a default message', () => {
    expect(normalizeApiError('weird').message).toMatch(/Что-то пошло не так/);
  });
});
