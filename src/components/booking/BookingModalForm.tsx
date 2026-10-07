'use client';

import { Alert, App, Button, DatePicker, Input, Modal, TimePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useState, type ReactNode } from 'react';
import { Controller, useWatch, type UseFormReturn } from 'react-hook-form';

import { SLOT_MINUTES, TITLE_MAX_LENGTH } from '@/core/domain/booking.constants';
import type { Booking, BookingFormValues, IsoDate } from '@/core/domain/booking.types';
import { formatLongDate, getTodayIso, isPastDate, isValidIsoDate } from '@/core/utils/date.helpers';
import { formatDuration, formatTimeRange, isValidTime, timeToMinutes } from '@/core/utils/time.helpers';
import { ErrorAlert } from '@/components/shared/ErrorAlert';
import { isConflictPayload, toApiErrorPayload } from '@/services/api-client';
import { deleteBooking } from '@/store';
import { useAppDispatch } from '@/store/hooks';

import { CloseIcon } from './icons';
import { useBookingSubmit } from './useBookingSubmit';
import { useTimeConstraints } from './useTimeConstraints';

/* ---------- Helpers ---------- */

const TIME_FORMAT = 'HH:mm';
const DATE_FORMAT = 'YYYY-MM-DD';
const TIME_FIELDS = [
  { name: 'startTime', label: 'Начало', counterpart: 'endTime' },
  { name: 'endTime', label: 'Окончание', counterpart: 'startTime' },
] as const;

const timeToDayjs = (value: string): Dayjs | null => {
  if (!isValidTime(value)) return null;
  const minutes = timeToMinutes(value);
  return dayjs().hour(Math.floor(minutes / 60)).minute(minutes % 60).second(0).millisecond(0);
};

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}

/** Label + control + inline error, shared by the single-control fields. */
function FormField({ id, label, error, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-label">
        {label}
      </label>
      {children}
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-caption text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ---------- Component ---------- */

export interface BookingModalFormProps {
  open: boolean;
  form: UseFormReturn<BookingFormValues>;
  editingBooking: Booking | null;
  /** Bookings for the form's date, used to grey out busy times in the pickers. */
  dayBookings: readonly Booking[];
  now: Date;
  onDateChange: (date: IsoDate) => void;
  onSaved: (booking: Booking, kind: 'created' | 'updated') => void;
  onDeleted: (booking: Booking) => void;
  /** Close without saving: «Отмена», ✕ and Esc. */
  onClose: () => void;
}

/**
 * Create / edit booking dialog. Rules 1–6 are validated client-side through the
 * Zod resolver; the server remains the source of truth.
 */
export function BookingModalForm({
  open,
  form,
  editingBooking,
  dayBookings,
  now,
  onDateChange,
  onSaved,
  onDeleted,
  onClose,
}: BookingModalFormProps) {
  const { message, modal } = App.useApp();
  const dispatch = useAppDispatch();
  // While the delete confirmation is up, it replaces this dialog (as in the design).
  const [isConfirmingDelete, setConfirmingDelete] = useState(false);

  const {
    control,
    getValues,
    setFocus,
    trigger,
    formState: { errors, isSubmitting },
  } = form;

  const [date, startTime, endTime] = useWatch({ control, name: ['date', 'startTime', 'endTime'] });
  const { onSubmit, serverError, clearServerError } = useBookingSubmit({
    form,
    editingBooking,
    currentTiming: { date, startTime, endTime },
    onSaved,
  });
  const disabledTime = useTimeConstraints(date, dayBookings, editingBooking, now);

  const isEditing = editingBooking !== null;
  const title = isEditing ? 'Редактирование' : 'Новое бронирование';
  const today = getTodayIso(now);
  const creationBlocked = !isEditing && isValidIsoDate(date) && isPastDate(date, now);

  const revalidate = (field: 'startTime' | 'endTime') => {
    if (getValues(field)) void trigger(field);
  };

  const askDelete = (booking: Booking) => {
    setConfirmingDelete(true);
    modal.confirm({
      title: `Удалить бронирование ${formatTimeRange(booking.startTime, booking.endTime)}?`,
      content: (
        <p className="text-ink-muted">
          {booking.title} · {formatLongDate(booking.date)}. Вернуть его будет нельзя.
        </p>
      ),
      icon: null,
      width: 440,
      style: { top: 120 },
      okText: 'Удалить',
      okButtonProps: { danger: true },
      cancelText: 'Отмена',
      onCancel: () => setConfirmingDelete(false),
      onOk: () => {
        onDeleted(booking);
        // Optimistic: the slice removes the block immediately and restores it if the request fails.
        dispatch(deleteBooking(booking))
          .unwrap()
          .catch((error: unknown) => {
            message.error({
              content: `Не удалось удалить «${booking.title}»: ${toApiErrorPayload(error).message} Бронирование возвращено в расписание.`,
              duration: 6,
            });
          });
      },
    });
  };

  const timeError = errors.startTime?.message ?? errors.endTime?.message;
  const hasValidRange = isValidTime(startTime) && isValidTime(endTime) && timeToMinutes(endTime) > timeToMinutes(startTime);
  const timeHint = hasValidRange
    ? `Длительность: ${formatDuration(timeToMinutes(endTime) - timeToMinutes(startTime))}`
    : 'Рабочий день — с 09:00 до 18:00, шаг 30 минут.';

  return (
    <Modal
      open={open && !isConfirmingDelete}
      onCancel={onClose}
      title={null}
      footer={null}
      closable={false}
      width={480}
      style={{ top: 120 }}
      styles={{ container: { padding: 24 } }}
      // A stray click on the backdrop must not discard what the user typed.
      mask={{ closable: false }}
      afterOpenChange={(visible) => {
        if (visible && !getValues('title')) setFocus('title');
      }}
      aria-label={title}
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-heading">{title}</h2>
            <div className="text-ink-muted">{isValidIsoDate(date) ? formatLongDate(date) : 'Дата не выбрана'}</div>
          </div>
          <Button type="text" aria-label="Закрыть" icon={<CloseIcon />} onClick={onClose} className="-mr-2 -mt-2 flex-none" />
        </div>

        <ErrorAlert
          error={serverError}
          onClose={clearServerError}
          hint={
            isConflictPayload(serverError)
              ? 'Расписание обновлено. Введённые данные сохранены — выберите другой интервал.'
              : undefined
          }
        />

        {creationBlocked ? (
          <Alert
            type="info"
            showIcon
            title="Дата в прошлом — бронирование недоступно."
            description="Выберите сегодняшнюю или будущую дату."
          />
        ) : null}

        <form noValidate onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={isSubmitting}>
          <FormField id="booking-title" label="Название" error={errors.title?.message}>
            <Controller
              control={control}
              name="title"
              render={({ field, fieldState }) => (
                <Input
                  {...field}
                  id="booking-title"
                  autoComplete="off"
                  maxLength={TITLE_MAX_LENGTH}
                  placeholder="Например, планёрка отдела"
                  status={fieldState.error ? 'error' : undefined}
                  aria-invalid={Boolean(fieldState.error)}
                  aria-describedby={fieldState.error ? 'booking-title-error' : undefined}
                />
              )}
            />
          </FormField>

          <FormField id="booking-date" label="Дата" error={errors.date?.message}>
            <Controller
              control={control}
              name="date"
              render={({ field, fieldState }) => (
                <DatePicker
                  ref={field.ref}
                  id="booking-date"
                  name={field.name}
                  className="w-full"
                  format="D MMMM YYYY, dddd"
                  allowClear={false}
                  inputReadOnly
                  value={isValidIsoDate(field.value) ? dayjs(field.value) : null}
                  onBlur={field.onBlur}
                  onChange={(value) => {
                    const next = value ? value.format(DATE_FORMAT) : '';
                    field.onChange(next);
                    if (next) onDateChange(next);
                    revalidate('startTime');
                    revalidate('endTime');
                  }}
                  disabledDate={(current) => current.format(DATE_FORMAT) < today}
                  status={fieldState.error ? 'error' : undefined}
                  aria-invalid={Boolean(fieldState.error)}
                />
              )}
            />
          </FormField>

          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-3">
              {TIME_FIELDS.map(({ name, label, counterpart }) => (
                <div key={name} className="flex min-w-0 flex-col gap-2">
                  <label htmlFor={`booking-${name}`} className="text-label">
                    {label}
                  </label>
                  <Controller
                    control={control}
                    name={name}
                    render={({ field }) => (
                      <TimePicker
                        ref={field.ref}
                        id={`booking-${name}`}
                        name={field.name}
                        className="w-full"
                        format={TIME_FORMAT}
                        minuteStep={SLOT_MINUTES}
                        showNow={false}
                        needConfirm={false}
                        inputReadOnly
                        hideDisabledOptions={false}
                        placeholder="—"
                        disabled={creationBlocked}
                        disabledTime={disabledTime[name]}
                        value={timeToDayjs(field.value)}
                        onBlur={field.onBlur}
                        onChange={(value) => {
                          field.onChange(value ? value.format(TIME_FORMAT) : '');
                          revalidate(counterpart);
                        }}
                        status={timeError ? 'error' : undefined}
                        aria-invalid={Boolean(timeError)}
                        aria-describedby="booking-time-feedback"
                      />
                    )}
                  />
                </div>
              ))}
            </div>
            <div id="booking-time-feedback">
              {timeError ? (
                <div role="alert" className="text-caption text-danger">
                  {timeError}
                </div>
              ) : (
                <div className="text-caption text-ink-muted">{timeHint}</div>
              )}
            </div>
          </div>

          {editingBooking ? (
            <div className="flex flex-wrap justify-between gap-2 pt-2">
              <Button color="danger" variant="outlined" onClick={() => askDelete(editingBooking)} disabled={isSubmitting}>
                Удалить бронирование
              </Button>
              <div className="flex gap-2">
                <Button onClick={onClose} disabled={isSubmitting}>
                  Отмена
                </Button>
                <Button type="primary" htmlType="submit" loading={isSubmitting}>
                  Сохранить
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap justify-end gap-2 pt-2">
              <Button onClick={onClose} disabled={isSubmitting}>
                Отмена
              </Button>
              <Button type="primary" htmlType="submit" loading={isSubmitting} disabled={creationBlocked}>
                Забронировать
              </Button>
            </div>
          )}
        </form>
      </div>
    </Modal>
  );
}
