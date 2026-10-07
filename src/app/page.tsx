'use client';

import { Button, Modal, Skeleton } from 'antd';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useWatch } from 'react-hook-form';

import { BookingModalForm } from '@/components/booking/BookingModalForm';
import { BookingTimeline, type TimelineDraft, type TimelineStatus } from '@/components/booking/BookingTimeline';
import { DateSelector } from '@/components/booking/DateSelector';
import { CalendarIcon, CloseIcon } from '@/components/booking/icons';
import { DEFAULT_BOOKING_MINUTES, WORKDAY_END_MINUTES } from '@/core/domain/booking.constants';
import type { Booking, IsoDate, MonthKey } from '@/core/domain/booking.types';
import { addDays, getMonthKey, getTodayIso } from '@/core/utils/date.helpers';
import {
  findConflictingBooking,
  findNextBookingStart,
  formatTimeRange,
  isValidTime,
  minutesToTime,
  timeToMinutes,
} from '@/core/utils/time.helpers';
import { emptyBookingValues, useBookingForm } from '@/hooks/useBookingForm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useNow } from '@/hooks/useNow';
import {
  dateSelected,
  fetchDayBookings,
  fetchMonthBookings,
  selectDayBookings,
  selectDayError,
  selectDayStatus,
  selectIsDayLoaded,
  selectIsDayRefreshing,
  selectMarkedDates,
  selectSelectedDate,
} from '@/store';
import { useAppDispatch, useAppSelector } from '@/store/hooks';

const BACKGROUND_REFRESH_MS = 60_000;
/** Rapid day/month navigation only fetches the date the user settles on. */
const NAVIGATION_FETCH_DEBOUNCE_MS = 300;
/** Matches the `desk` breakpoint in globals.css: from here the calendar is a panel, below it a dialog. */
const DESK_LAYOUT_QUERY = '(min-width: 55rem)';

export default function HomePage() {
  const now = useNow();
  return (
    <div className="min-h-screen p-4 sm:p-6 lg:p-8">
      <div className="mx-auto flex max-w-[1376px] flex-col gap-6">
        {now ? <BookingWorkspace now={now} /> : <WorkspaceSkeleton />}
      </div>
    </div>
  );
}

/**
 * Desktop: brand and actions share one row. Narrow screens: the wrapper is
 * `display: contents`, so the actions bar becomes a direct child of the page
 * column and can stick to the top for the whole scroll (a sticky element only
 * sticks within its parent).
 */
function PageHeader({ actions }: { actions?: ReactNode }) {
  return (
    <div className="contents desk:flex desk:flex-wrap desk:items-center desk:justify-between desk:gap-x-6 desk:gap-y-2">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <div className="text-heading font-bold">RoomBook</div>
        <div className="text-ink-muted">Переговорная комната · рабочий день 09:00–18:00</div>
      </header>
      {actions ? (
        <div
          role="toolbar"
          aria-label="Действия"
          // Full-bleed canvas strip on mobile so content scrolls underneath; plain row on desktop.
          className="sticky top-0 z-20 -mx-4 -my-3 flex gap-2 bg-canvas px-4 py-3 sm:-mx-6 sm:px-6 desk:static desk:m-0 desk:bg-transparent desk:p-0"
        >
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/** Shown during SSR/hydration, before the client clock is known. */
function WorkspaceSkeleton() {
  return (
    <>
      <PageHeader />
      <main aria-busy="true" aria-label="Загрузка" className="flex flex-wrap items-start gap-6">
        <div className="hidden min-w-0 shrink grow basis-[340px] rounded-lg bg-surface p-6 desk:block">
          <Skeleton active paragraph={{ rows: 7 }} />
        </div>
        <div className="min-w-0 shrink grow-[999] basis-[480px] rounded-lg bg-surface p-6">
          <Skeleton active title={{ width: '50%' }} paragraph={{ rows: 12 }} />
        </div>
      </main>
    </>
  );
}

function BookingWorkspace({ now }: { now: Date }) {
  const today = getTodayIso(now);
  const isDeskLayout = useMediaQuery(DESK_LAYOUT_QUERY, true);

  /* ----- Store ----- */
  const dispatch = useAppDispatch();
  const storedDate = useAppSelector(selectSelectedDate);
  const selectedDate: IsoDate = storedDate ?? today;
  const dayBookings = useAppSelector((state) => selectDayBookings(state, selectedDate));
  const dayStatus = useAppSelector((state) => selectDayStatus(state, selectedDate));
  const hasDayData = useAppSelector((state) => selectIsDayLoaded(state, selectedDate));
  const isRefreshing = useAppSelector((state) => selectIsDayRefreshing(state, selectedDate));
  const dayError = useAppSelector((state) => selectDayError(state, selectedDate));
  const markedDates = useAppSelector(selectMarkedDates);

  const setSelectedDate = useCallback((date: IsoDate) => dispatch(dateSelected(date)), [dispatch]);

  /* ----- Local UI state ----- */
  const [viewMonth, setViewMonth] = useState<MonthKey>(() => getMonthKey(selectedDate));
  const [isFormOpen, setFormOpen] = useState(false);
  const [editingBooking, setEditingBooking] = useState<Booking | null>(null);
  const [isCalendarOpen, setCalendarOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const form = useBookingForm({ date: selectedDate, editingBooking });
  const [draftTitle, draftStart, draftEnd] = useWatch({
    control: form.control,
    name: ['title', 'startTime', 'endTime'],
  });

  /* ----- Data fetching ----- */
  useEffect(() => {
    if (!storedDate) setSelectedDate(today);
  }, [storedDate, setSelectedDate, today]);

  // Navigation updates the UI instantly; the request waits until clicking stops.
  const dateToFetch = useDebouncedValue(selectedDate, NAVIGATION_FETCH_DEBOUNCE_MS);
  const monthToFetch = useDebouncedValue(viewMonth, NAVIGATION_FETCH_DEBOUNCE_MS);

  useEffect(() => {
    void dispatch(fetchDayBookings({ date: dateToFetch }));
  }, [dispatch, dateToFetch]);

  useEffect(() => {
    void dispatch(fetchMonthBookings({ month: monthToFetch }));
  }, [dispatch, monthToFetch]);

  // Keep the visible day fresh: other people book too. Fewer stale views → fewer 409s.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void dispatch(fetchDayBookings({ date: selectedDate, force: true }));
    };
    const interval = window.setInterval(refresh, BACKGROUND_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [dispatch, selectedDate]);

  /* ----- Derived ----- */
  const timelineStatus: TimelineStatus = hasDayData ? 'ready' : dayStatus === 'error' ? 'error' : 'loading';

  // The selection is previewed on the grid only while the form is open.
  const draft = useMemo<TimelineDraft | null>(() => {
    if (!isFormOpen || !isValidTime(draftStart) || !isValidTime(draftEnd)) return null;
    const start = timeToMinutes(draftStart);
    const end = timeToMinutes(draftEnd);
    if (end <= start) return null;
    const conflict =
      findConflictingBooking(
        { date: selectedDate, startTime: draftStart, endTime: draftEnd },
        dayBookings,
        editingBooking?.id,
      ) ?? null;
    return { start, end, title: draftTitle ?? '', conflict, isEditing: editingBooking !== null };
  }, [dayBookings, draftEnd, draftStart, draftTitle, editingBooking, isFormOpen, selectedDate]);

  /* ----- Form lifecycle ----- */

  /** Closes the dialog and leaves a blank create form for the given date. */
  const resetForm = useCallback(
    (date: IsoDate) => {
      setFormOpen(false);
      setEditingBooking(null);
      form.reset(emptyBookingValues(date));
    },
    [form],
  );

  const openCreate = useCallback(() => {
    setNotice(null);
    setEditingBooking(null);
    form.reset(emptyBookingValues(selectedDate));
    setFormOpen(true);
  }, [form, selectedDate]);

  /** A free slot opens a fresh form starting there: one hour, cut short by the next booking. */
  const handleSlotSelect = useCallback(
    (start: number) => {
      const end = Math.min(start + DEFAULT_BOOKING_MINUTES, findNextBookingStart(start, dayBookings), WORKDAY_END_MINUTES);
      setNotice(null);
      setEditingBooking(null);
      form.reset({ ...emptyBookingValues(selectedDate), startTime: minutesToTime(start), endTime: minutesToTime(end) });
      setFormOpen(true);
      void form.trigger(['startTime', 'endTime']);
    },
    [dayBookings, form, selectedDate],
  );

  const handleBookingSelect = useCallback(
    (booking: Booking) => {
      setNotice(null);
      setEditingBooking(booking);
      form.reset({ title: booking.title, date: booking.date, startTime: booking.startTime, endTime: booking.endTime });
      setFormOpen(true);
    },
    [form],
  );

  const handleFormClose = useCallback(() => resetForm(selectedDate), [resetForm, selectedDate]);

  const handleSaved = useCallback(
    (booking: Booking, kind: 'created' | 'updated') => {
      const range = formatTimeRange(booking.startTime, booking.endTime);
      setNotice(kind === 'created' ? `Забронировано: ${range}.` : `Сохранено: ${range}.`);
      setSelectedDate(booking.date);
      resetForm(booking.date);
    },
    [resetForm, setSelectedDate],
  );

  const handleDeleted = useCallback(
    (booking: Booking) => {
      setNotice(`Удалено: ${formatTimeRange(booking.startTime, booking.endTime)}.`);
      resetForm(selectedDate);
    },
    [resetForm, selectedDate],
  );

  /* ----- Navigation ----- */

  /** Calendar and day navigation: switch day, clear any form and notice. */
  const goToDate = useCallback(
    (date: IsoDate) => {
      setSelectedDate(date);
      setViewMonth(getMonthKey(date));
      setNotice(null);
      setCalendarOpen(false);
      resetForm(date);
    },
    [resetForm, setSelectedDate],
  );

  const handlePrevDay = useCallback(() => goToDate(addDays(selectedDate, -1)), [goToDate, selectedDate]);
  const handleNextDay = useCallback(() => goToDate(addDays(selectedDate, 1)), [goToDate, selectedDate]);
  const handleToday = useCallback(() => goToDate(today), [goToDate, today]);

  /** The form's own date picker moves the grid but keeps the form (and edit mode) intact. */
  const handleFormDateChange = useCallback(
    (date: IsoDate) => {
      setSelectedDate(date);
      setViewMonth(getMonthKey(date));
    },
    [setSelectedDate],
  );

  const handleRetry = useCallback(
    () => void dispatch(fetchDayBookings({ date: selectedDate, force: true })),
    [dispatch, selectedDate],
  );

  const calendarProps = {
    selectedDate,
    viewMonth,
    today,
    markedDates,
    onSelect: goToDate,
    onMonthChange: setViewMonth,
  };

  return (
    <>
      <PageHeader
        actions={
          <>
            {/* Wrapper is ours, so `desk:hidden` isn't overridden by AntD's button display rule. */}
            <span className="contents desk:hidden">
              <Button icon={<CalendarIcon />} aria-expanded={isCalendarOpen} onClick={() => setCalendarOpen(true)} className="flex-1">
                Календарь
              </Button>
            </span>
            <Button type="primary" onClick={openCreate} className="flex-1 desk:flex-none">
              Новое бронирование
            </Button>
          </>
        }
      />

      <main className="flex flex-wrap items-start gap-6">
        <DateSelector {...calendarProps} className="hidden desk:flex" />

        <BookingTimeline
          date={selectedDate}
          now={now}
          bookings={dayBookings}
          status={timelineStatus}
          isRefreshing={isRefreshing}
          error={dayError}
          editingId={isFormOpen ? (editingBooking?.id ?? null) : null}
          draft={draft}
          notice={notice}
          onSlotSelect={handleSlotSelect}
          onBookingSelect={handleBookingSelect}
          onRetry={handleRetry}
          onPrevDay={handlePrevDay}
          onNextDay={handleNextDay}
          onToday={handleToday}
        />
      </main>

      {/* Narrow screens: the calendar lives in a dialog («Телефон: календарь открыт»). */}
      <Modal
        open={isCalendarOpen && !isDeskLayout}
        onCancel={() => setCalendarOpen(false)}
        title={null}
        footer={null}
        closable={false}
        width={400}
        style={{ top: 120 }}
        styles={{ container: { padding: 24 } }}
        aria-label="Выбор даты"
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-heading">Выберите дату</h2>
            <Button
              type="text"
              aria-label="Закрыть"
              icon={<CloseIcon />}
              onClick={() => setCalendarOpen(false)}
              className="-mr-2 -mt-2 flex-none"
            />
          </div>
          <DateSelector {...calendarProps} variant="dialog" />
        </div>
      </Modal>

      <BookingModalForm
        // Remount per booking so server errors and dialog state never leak between bookings.
        key={editingBooking?.id ?? 'create'}
        open={isFormOpen}
        form={form}
        editingBooking={editingBooking}
        dayBookings={dayBookings}
        now={now}
        onDateChange={handleFormDateChange}
        onSaved={handleSaved}
        onDeleted={handleDeleted}
        onClose={handleFormClose}
      />
    </>
  );
}
