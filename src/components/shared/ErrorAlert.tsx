'use client';

import { Alert, Button } from 'antd';
import { memo, type ReactNode } from 'react';

import type { ApiErrorCode } from '@/core/domain/booking.types';
import { formatTimeRange } from '@/core/utils/time.helpers';
import type { ApiErrorPayload } from '@/services/api-client';

const TITLES: Partial<Record<ApiErrorCode, string>> = {
  BOOKING_CONFLICT: 'Это время уже занято',
  VALIDATION_ERROR: 'Сервер отклонил данные',
  NOT_FOUND: 'Бронирование не найдено',
  NETWORK_ERROR: 'Нет соединения с сервером',
  TIMEOUT: 'Сервер не ответил',
  INTERNAL_ERROR: 'Ошибка на сервере',
};

export interface ErrorAlertProps {
  error: ApiErrorPayload | null;
  /** Overrides the default title derived from the error code. */
  title?: string;
  /** Extra content under the message, e.g. what the UI did in response. */
  hint?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  onClose?: () => void;
  /** `warning` for non-blocking issues (e.g. a failed background refresh). */
  severity?: 'error' | 'warning';
  className?: string;
}

/**
 * Presents an API error. For 409 conflicts it names the booking that took
 * the slot and explains that the schedule was refreshed and input kept.
 */
export const ErrorAlert = memo(function ErrorAlert({
  error,
  title,
  hint,
  onRetry,
  retryLabel = 'Повторить',
  onClose,
  severity = 'error',
  className,
}: ErrorAlertProps) {
  if (!error) return null;

  const reportedConflict = error.conflict;
  // Only add the "taken by" line when the server message doesn't already name the booking.
  const conflict = reportedConflict && !error.message.includes(reportedConflict.title) ? reportedConflict : undefined;
  const detailMessages = error.code === 'VALIDATION_ERROR' && error.details
    ? Object.values(error.details).flat().filter((message): message is string => Boolean(message) && message !== error.message)
    : [];

  const description = (
    <div className="flex flex-col gap-1 text-body">
      <span>{error.message}</span>
      {conflict ? (
        <span className="text-ink-muted">
          Занято: {formatTimeRange(conflict.startTime, conflict.endTime)} · {conflict.title}
        </span>
      ) : null}
      {detailMessages.length ? (
        <ul className="m-0 list-disc pl-5 text-ink-muted">
          {detailMessages.map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      ) : null}
      {hint ? <span className="text-ink-muted">{hint}</span> : null}
    </div>
  );

  return (
    <Alert
      className={className}
      type={severity}
      showIcon
      role="alert"
      title={<span className="text-label">{title ?? TITLES[error.code] ?? 'Что-то пошло не так'}</span>}
      description={description}
      closable={onClose ? { onClose, 'aria-label': 'Скрыть сообщение' } : false}
      action={
        onRetry ? (
          <Button size="small" onClick={onRetry}>
            {retryLabel}
          </Button>
        ) : undefined
      }
    />
  );
});
