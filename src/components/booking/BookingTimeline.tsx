'use client';

import { Alert, Button, Spin } from 'antd';
import { Component, memo, useMemo, type ErrorInfo, type ReactNode } from 'react';

import { SLOT_MINUTES, WORKDAY_END_MINUTES, WORKDAY_START_MINUTES } from '@/core/domain/booking.constants';
import type { Booking, IsoDate } from '@/core/domain/booking.types';
import {
  formatDayHeading,
  getMinutesOfDay,
  getTodayIso,
  isPastSlot,
  pluralizeBookings,
} from '@/core/utils/date.helpers';
import {
  formatDuration,
  formatTimeRange,
  getBookedMinutes,
  isMinuteOccupied,
  minutesToTime,
  timeToMinutes,
} from '@/core/utils/time.helpers';
import { ErrorAlert } from '@/components/shared/ErrorAlert';
import type { ApiErrorPayload } from '@/services/api-client';

import { ChevronLeftIcon, ChevronRightIcon } from './icons';

/* ---------- Geometry: one 30-minute slot = 32px, one hour = 64px ---------- */

const SLOT_HEIGHT_PX = 32;
const PX_PER_MINUTE = SLOT_HEIGHT_PX / SLOT_MINUTES;
const BLOCK_GAP_PX = 2;
const TIMELINE_HEIGHT_PX = (WORKDAY_END_MINUTES - WORKDAY_START_MINUTES) * PX_PER_MINUTE;
const HOURS = Array.from(
  { length: (WORKDAY_END_MINUTES - WORKDAY_START_MINUTES) / 60 },
  (_, index) => WORKDAY_START_MINUTES + index * 60,
);

const offsetOf = (minutes: number) => (minutes - WORKDAY_START_MINUTES) * PX_PER_MINUTE;

const blockGeometry = (start: number, end: number) => ({
  top: offsetOf(start) + BLOCK_GAP_PX,
  height: Math.max((end - start) * PX_PER_MINUTE - BLOCK_GAP_PX * 2, 12),
});

/** 30-minute blocks are laid out on one line; longer ones stack title over time. */
const blockLayout = (durationMinutes: number) =>
  durationMinutes <= SLOT_MINUTES
    ? 'flex-row items-center gap-3 px-3'
    : 'flex-col items-start justify-start gap-0.5 px-3 py-2';

/* ---------- Public types ---------- */

export interface TimelineDraft {
  start: number;
  end: number;
  title: string;
  /** Booking the draft overlaps, if any — rendered as an explicit collision. */
  conflict: Booking | null;
  isEditing: boolean;
}

export type TimelineStatus = 'loading' | 'ready' | 'error';

export interface BookingTimelineProps {
  date: IsoDate;
  now: Date;
  bookings: readonly Booking[];
  status: TimelineStatus;
  isRefreshing: boolean;
  error: ApiErrorPayload | null;
  /** The booking open in the form; hidden from the grid so it never blocks its own slot. */
  editingId: string | null;
  draft: TimelineDraft | null;
  /** Result of the last completed action, e.g. «Забронировано: 12:00–13:00.» */
  notice: string | null;
  onSlotSelect: (minutes: number) => void;
  onBookingSelect: (booking: Booking) => void;
  onRetry: () => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

/* ---------- Slots ---------- */

type SlotState = 'free' | 'busy' | 'past' | 'loading';

interface TimelineSlotProps {
  minutes: number;
  state: SlotState;
  onSelect: (minutes: number) => void;
}

const SLOT_ARIA: Record<SlotState, (time: string) => string> = {
  free: (time) => `Свободно с ${time}. Открыть форму бронирования`,
  busy: (time) => `Занято, ${time}`,
  past: (time) => `${time} — время прошло`,
  loading: (time) => `${time}, загрузка`,
};

const TimelineSlot = memo(function TimelineSlot({ minutes, state, onSelect }: TimelineSlotProps) {
  const time = minutesToTime(minutes);
  return (
    <button
      type="button"
      aria-label={SLOT_ARIA[state](time)}
      disabled={state !== 'free'}
      onClick={() => onSelect(minutes)}
      className="min-h-0 flex-1 cursor-pointer rounded-sm border-0 bg-transparent px-3 text-left text-caption text-transparent outline-none hover:bg-canvas hover:text-ink-muted focus-visible:text-ink-muted focus-visible:shadow-[inset_0_0_0_2px_var(--color-accent)] disabled:cursor-default disabled:hover:bg-transparent disabled:hover:text-transparent"
    >
      Забронировать с {time}
    </button>
  );
});

interface TimelineRowProps {
  hourStart: number;
  firstState: SlotState;
  secondState: SlotState;
  onSlotSelect: (minutes: number) => void;
}

const TimelineRow = memo(function TimelineRow({ hourStart, firstState, secondState, onSlotSelect }: TimelineRowProps) {
  return (
    <div className="flex h-16 gap-4">
      <div className="-mt-2 w-10 flex-none text-right text-caption text-ink-muted">{minutesToTime(hourStart)}</div>
      <div className="flex min-w-0 flex-1 flex-col border-t border-line">
        <TimelineSlot minutes={hourStart} state={firstState} onSelect={onSlotSelect} />
        <TimelineSlot minutes={hourStart + SLOT_MINUTES} state={secondState} onSelect={onSlotSelect} />
      </div>
    </div>
  );
});

/* ---------- Blocks ---------- */

interface BookingBlockProps {
  booking: Booking;
  isPast: boolean;
  onSelect: (booking: Booking) => void;
}

const BookingBlock = memo(function BookingBlock({ booking, isPast, onSelect }: BookingBlockProps) {
  const start = timeToMinutes(booking.startTime);
  const end = timeToMinutes(booking.endTime);
  const { top, height } = blockGeometry(start, end);
  const range = formatTimeRange(booking.startTime, booking.endTime);

  return (
    <button
      type="button"
      aria-label={`${booking.title}, ${range}${isPast ? ', прошло' : ''}. Редактировать`}
      onClick={() => onSelect(booking)}
      style={{ top, height }}
      className={`pointer-events-auto absolute inset-x-0 z-[1] flex cursor-pointer overflow-hidden rounded-md border-0 bg-accent-soft text-left text-ink outline-none hover:shadow-[inset_0_0_0_2px_var(--color-accent)] focus-visible:shadow-focus ${blockLayout(end - start)} ${isPast ? 'opacity-70' : ''}`}
    >
      <span className="min-w-0 max-w-full truncate text-title">{booking.title}</span>
      <span className="flex-none whitespace-nowrap text-caption text-ink-muted">
        {range} · {formatDuration(end - start)}
      </span>
    </button>
  );
});

const DraftBlock = memo(function DraftBlock({ draft }: { draft: TimelineDraft }) {
  const start = Math.max(draft.start, WORKDAY_START_MINUTES);
  const end = Math.min(draft.end, WORKDAY_END_MINUTES);
  if (end <= start) return null;

  const { top, height } = blockGeometry(start, end);
  const range = formatTimeRange(minutesToTime(draft.start), minutesToTime(draft.end));
  const conflict = draft.conflict;

  if (conflict) {
    // Transparent so the booking it collides with stays readable; the label sits on a solid badge.
    // Colour is never the only signal: the collision is always spelled out in words.
    return (
      <div
        aria-hidden="true"
        style={{ top, height }}
        className="absolute inset-x-0 z-[2] rounded-md border-2 border-dashed border-danger bg-transparent"
      >
        <span className="absolute right-2 top-1 max-w-[calc(100%-16px)] truncate rounded-full bg-surface px-2 text-caption font-semibold text-danger shadow-pop">
          Пересечение с {formatTimeRange(conflict.startTime, conflict.endTime)}
        </span>
      </div>
    );
  }

  const tone = draft.isEditing ? 'border-accent bg-accent text-on-accent' : 'border-accent bg-surface text-accent';
  const title = draft.title.trim() || (draft.isEditing ? 'Без названия' : 'Новое бронирование');

  return (
    <div
      aria-hidden="true"
      style={{ top, height }}
      className={`absolute inset-x-0 z-[2] flex overflow-hidden rounded-md border-2 ${tone} ${blockLayout(end - start)}`}
    >
      <span className="min-w-0 max-w-full truncate text-title">{title}</span>
      <span className="flex-none whitespace-nowrap text-caption">
        {range} · {formatDuration(draft.end - draft.start)}
      </span>
    </div>
  );
});

/* ---------- Header ---------- */

interface TimelineHeaderProps {
  date: IsoDate;
  now: Date;
  summary: string;
  isRefreshing: boolean;
  canGoBack: boolean;
  onPrevDay: () => void;
  onNextDay: () => void;
  onToday: () => void;
}

const TimelineHeader = memo(function TimelineHeader({
  date,
  now,
  summary,
  isRefreshing,
  canGoBack,
  onPrevDay,
  onNextDay,
  onToday,
}: TimelineHeaderProps) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-display">{formatDayHeading(date, now)}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-ink-muted" aria-live="polite">
          <span>{summary}</span>
          {isRefreshing ? (
            <span className="inline-flex items-center gap-2 text-caption">
              <Spin size="small" /> Обновление…
            </span>
          ) : null}
        </div>
      </div>
      <div className="flex gap-2">
        <Button aria-label="Предыдущий день" icon={<ChevronLeftIcon />} disabled={!canGoBack} onClick={onPrevDay} />
        <Button onClick={onToday}>Сегодня</Button>
        <Button aria-label="Следующий день" icon={<ChevronRightIcon />} onClick={onNextDay} />
      </div>
    </div>
  );
});

/* ---------- Main grid ---------- */

const SKELETON_BLOCKS = [
  { start: 570, end: 630 },
  { start: 690, end: 750 },
  { start: 840, end: 930 },
] as const;

function buildSummary(
  status: TimelineStatus,
  bookings: readonly Booking[],
  isTodayDate: boolean,
  isPastDay: boolean,
  nowMinutes: number,
): string {
  if (status === 'loading') return 'Загрузка расписания…';
  if (status === 'error') return 'Не удалось загрузить расписание.';

  const nowSuffix = isTodayDate ? `сейчас ${minutesToTime(nowMinutes)}` : '';
  if (bookings.length === 0) {
    if (isPastDay) return 'На эту дату бронирований не было. Дата в прошлом — бронирование недоступно.';
    return `На эту дату бронирований нет.${nowSuffix ? ` ${nowSuffix[0]?.toUpperCase()}${nowSuffix.slice(1)}.` : ''}`;
  }

  const free = WORKDAY_END_MINUTES - WORKDAY_START_MINUTES - getBookedMinutes(bookings);
  const parts = [`${bookings.length} ${pluralizeBookings(bookings.length)}`, `свободно ${formatDuration(free)}`];
  if (nowSuffix) parts.push(nowSuffix);
  return parts.join(' · ');
}

function BookingTimelineView({
  date,
  now,
  bookings,
  status,
  isRefreshing,
  error,
  editingId,
  draft,
  notice,
  onSlotSelect,
  onBookingSelect,
  onRetry,
  onPrevDay,
  onNextDay,
  onToday,
}: BookingTimelineProps) {
  const today = getTodayIso(now);
  const isTodayDate = date === today;
  const isPastDay = date < today;
  const nowMinutes = getMinutesOfDay(now);

  const visibleBookings = useMemo(
    () => (editingId ? bookings.filter((booking) => booking.id !== editingId) : bookings),
    [bookings, editingId],
  );

  const rows = useMemo(() => {
    const stateOf = (minutes: number): SlotState => {
      if (status !== 'ready') return 'loading';
      if (isPastSlot(date, minutes, now)) return 'past';
      return isMinuteOccupied(minutes, visibleBookings) ? 'busy' : 'free';
    };
    return HOURS.map((hourStart) => ({
      hourStart,
      firstState: stateOf(hourStart),
      secondState: stateOf(hourStart + SLOT_MINUTES),
    }));
  }, [date, now, status, visibleBookings]);

  const summary = buildSummary(status, bookings, isTodayDate, isPastDay, nowMinutes);

  const pastUntil = isPastDay
    ? WORKDAY_END_MINUTES
    : isTodayDate
      ? Math.min(Math.max(nowMinutes, WORKDAY_START_MINUTES), WORKDAY_END_MINUTES)
      : WORKDAY_START_MINUTES;
  const showNowLine = isTodayDate && nowMinutes >= WORKDAY_START_MINUTES && nowMinutes <= WORKDAY_END_MINUTES;
  const isEmptyBookableDay = status === 'ready' && bookings.length === 0 && !isPastDay;

  return (
    <section
      aria-label="Бронирования на выбранную дату"
      aria-busy={status === 'loading' || isRefreshing}
      className="flex min-w-0 shrink grow-[999] basis-[480px] flex-col gap-6 rounded-lg bg-surface p-6"
    >
      <TimelineHeader
        date={date}
        now={now}
        summary={summary}
        isRefreshing={isRefreshing}
        canGoBack={date > today}
        onPrevDay={onPrevDay}
        onNextDay={onNextDay}
        onToday={onToday}
      />

      {notice ? (
        <div role="status" className="rounded-md bg-canvas p-3">
          {notice}
        </div>
      ) : null}

      {status === 'ready' && error ? (
        <ErrorAlert
          error={error}
          severity="warning"
          title="Не удалось обновить расписание"
          hint="Показаны последние загруженные данные."
          onRetry={onRetry}
        />
      ) : null}

      {status === 'error' ? (
        <ErrorAlert error={error} title="Не удалось загрузить расписание" onRetry={onRetry} retryLabel="Загрузить снова" />
      ) : (
        <div className="relative pt-2">
          {isEmptyBookableDay ? (
            <p className="sr-only">Свободно весь день. Нажмите на время на шкале, чтобы забронировать.</p>
          ) : null}

          {rows.map((row) => (
            <TimelineRow key={row.hourStart} {...row} onSlotSelect={onSlotSelect} />
          ))}
          <div className="flex h-2 gap-4">
            <div className="-mt-2 w-10 flex-none text-right text-caption text-ink-muted">
              {minutesToTime(WORKDAY_END_MINUTES)}
            </div>
            <div className="min-w-0 flex-1 border-t border-line" />
          </div>

          <div className="pointer-events-none absolute left-14 right-0 top-2" style={{ height: TIMELINE_HEIGHT_PX }}>
            {pastUntil > WORKDAY_START_MINUTES ? (
              <div
                aria-hidden="true"
                className="absolute inset-x-0 top-0 rounded-sm bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(243_241_236/0.9)_6px_8px)]"
                style={{ height: offsetOf(pastUntil) }}
              />
            ) : null}

            {status === 'loading'
              ? SKELETON_BLOCKS.map(({ start, end }) => (
                  <div
                    key={start}
                    aria-hidden="true"
                    style={blockGeometry(start, end)}
                    className="absolute inset-x-0 animate-pulse-soft rounded-md bg-canvas"
                  />
                ))
              : visibleBookings.map((booking) => (
                  <BookingBlock
                    key={booking.id}
                    booking={booking}
                    isPast={isPastDay || (isTodayDate && timeToMinutes(booking.endTime) <= nowMinutes)}
                    onSelect={onBookingSelect}
                  />
                ))}

            {status === 'ready' && draft ? <DraftBlock draft={draft} /> : null}

            {showNowLine ? (
              <div
                aria-hidden="true"
                className="absolute -left-2 right-0 z-[3] -mt-px h-0.5 bg-accent"
                style={{ top: offsetOf(nowMinutes) }}
              >
                <span className="absolute -left-1 -top-[3px] h-2 w-2 rounded-full bg-accent" />
              </div>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------- Local error boundary ---------- */

interface BoundaryProps {
  children: ReactNode;
  /** Changing this key (e.g. the date) resets the boundary. */
  resetKey: string;
}

interface BoundaryState {
  error: Error | null;
  resetKey: string;
}

/** Contains rendering failures (e.g. corrupt booking data) to the timeline panel. */
class TimelineErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null, resetKey: this.props.resetKey };

  static getDerivedStateFromError(error: Error): Partial<BoundaryState> {
    return { error };
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    return props.resetKey !== state.resetKey ? { error: null, resetKey: props.resetKey } : null;
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[RoomBook] Timeline render failed', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <section className="flex min-w-0 shrink grow-[999] basis-[480px] flex-col gap-4 rounded-lg bg-surface p-6">
        <Alert
          type="error"
          showIcon
          role="alert"
          title="Не удалось отобразить расписание"
          description="Данные этого дня не удалось показать. Выберите другую дату или попробуйте ещё раз."
          action={
            <Button size="small" onClick={() => this.setState({ error: null })}>
              Повторить
            </Button>
          }
        />
      </section>
    );
  }
}

/** Interactive day schedule: 30-minute slots, booking blocks, draft preview and now-line. */
export const BookingTimeline = memo(function BookingTimeline(props: BookingTimelineProps) {
  return (
    <TimelineErrorBoundary resetKey={props.date}>
      <BookingTimelineView {...props} />
    </TimelineErrorBoundary>
  );
});
