'use client';

import { Button } from 'antd';
import { memo, useCallback, useMemo } from 'react';

import type { IsoDate, MonthKey } from '@/core/domain/booking.types';
import {
  addMonths,
  formatLongDate,
  formatMonthLabel,
  getDayOfMonth,
  getMonthGrid,
  getMonthKey,
} from '@/core/utils/date.helpers';

import { ChevronLeftIcon, ChevronRightIcon } from './icons';

const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const;

export interface DateSelectorProps {
  selectedDate: IsoDate;
  /** Month currently shown in the grid (may differ from the selected date's month). */
  viewMonth: MonthKey;
  today: IsoDate;
  /** Dates that have at least one booking — rendered with a dot marker. */
  markedDates: ReadonlySet<IsoDate>;
  onSelect: (date: IsoDate) => void;
  onMonthChange: (month: MonthKey) => void;
  /** `panel`: standalone card in the page grid. `dialog`: bare content for the calendar dialog. */
  variant?: 'panel' | 'dialog';
  className?: string;
}

interface DayCellProps {
  date: IsoDate;
  isSelected: boolean;
  isToday: boolean;
  isPast: boolean;
  hasBookings: boolean;
  onSelect: (date: IsoDate) => void;
}

const DayCell = memo(function DayCell({ date, isSelected, isToday, isPast, hasBookings, onSelect }: DayCellProps) {
  const label = `${formatLongDate(date)}${isToday ? ', сегодня' : ''}${hasBookings ? ', есть бронирования' : ''}`;

  const tone = isSelected
    ? 'bg-accent text-on-accent font-semibold'
    : isToday
      ? 'bg-accent-soft text-ink font-semibold hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]'
      : isPast
        ? 'bg-transparent text-ink-muted'
        : 'bg-transparent text-ink hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]';

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={isSelected}
      aria-current={isToday ? 'date' : undefined}
      disabled={isPast}
      onClick={() => onSelect(date)}
      className={`relative aspect-square w-full cursor-pointer rounded-full border-0 p-0 text-body tabular-nums outline-none transition-shadow focus-visible:shadow-focus disabled:cursor-default ${tone}`}
    >
      {getDayOfMonth(date)}
      {hasBookings && !isPast ? (
        <span
          aria-hidden="true"
          className={`absolute bottom-[5px] left-1/2 -ml-[2px] h-1 w-1 rounded-full ${isSelected ? 'bg-on-accent' : 'bg-accent'}`}
        />
      ) : null}
    </button>
  );
});

/** Month calendar: past days disabled, days with bookings marked with a dot. */
export const DateSelector = memo(function DateSelector({
  selectedDate,
  viewMonth,
  today,
  markedDates,
  onSelect,
  onMonthChange,
  variant = 'panel',
  className = '',
}: DateSelectorProps) {
  const { leadingBlanks, days } = useMemo(() => getMonthGrid(viewMonth), [viewMonth]);
  const isCurrentMonthOrEarlier = viewMonth <= getMonthKey(today);

  const goPrevMonth = useCallback(() => onMonthChange(addMonths(viewMonth, -1)), [onMonthChange, viewMonth]);
  const goNextMonth = useCallback(() => onMonthChange(addMonths(viewMonth, 1)), [onMonthChange, viewMonth]);

  const isPanel = variant === 'panel';
  const MonthHeading = isPanel ? 'h2' : 'div';

  return (
    <section
      aria-label={isPanel ? 'Выбор даты' : undefined}
      className={`flex min-w-0 flex-col gap-4 ${isPanel ? 'shrink grow basis-[340px] rounded-lg bg-surface p-6' : ''} ${className}`}
    >
      <div className="flex items-center justify-between gap-2">
        <MonthHeading className={isPanel ? 'text-heading' : 'text-title'} aria-live="polite">
          {formatMonthLabel(viewMonth)}
        </MonthHeading>
        <div className="flex gap-2">
          <Button
            aria-label="Предыдущий месяц"
            icon={<ChevronLeftIcon />}
            disabled={isCurrentMonthOrEarlier}
            onClick={goPrevMonth}
          />
          <Button aria-label="Следующий месяц" icon={<ChevronRightIcon />} onClick={goNextMonth} />
        </div>
      </div>

      <div
        aria-hidden="true"
        className="grid grid-cols-7 gap-1 text-center text-label text-ink-muted"
      >
        {WEEKDAY_LABELS.map((weekday) => (
          <div key={weekday}>{weekday}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: leadingBlanks }, (_, index) => (
          <span key={`blank-${index}`} aria-hidden="true" />
        ))}
        {days.map((date) => (
          <DayCell
            key={date}
            date={date}
            isSelected={date === selectedDate}
            isToday={date === today}
            isPast={date < today}
            hasBookings={markedDates.has(date)}
            onSelect={onSelect}
          />
        ))}
      </div>

      <div className="flex items-center gap-2 text-caption text-ink-muted">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
        <span>Есть бронирования</span>
      </div>
    </section>
  );
});
