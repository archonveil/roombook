'use client';

import { Button } from 'antd';
import { useEffect } from 'react';

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Route-level boundary for unexpected render errors. */
export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    console.error('[RoomBook] Unhandled UI error', error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-start justify-center bg-canvas px-4 pt-40">
      <section
        role="alert"
        className="flex w-full max-w-[440px] flex-col gap-4 rounded-lg bg-surface p-6 shadow-pop"
      >
        <div className="flex flex-col gap-2">
          <h1 className="text-heading">Не удалось показать расписание</h1>
          <p className="text-ink-muted">
            В интерфейсе произошла непредвиденная ошибка. Ваши бронирования на сервере не пострадали —
            попробуйте перезагрузить экран.
          </p>
          {error.digest ? <p className="text-caption text-ink-muted">Код ошибки: {error.digest}</p> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={() => window.location.reload()}>Перезагрузить страницу</Button>
          <Button type="primary" onClick={reset}>
            Попробовать снова
          </Button>
        </div>
      </section>
    </main>
  );
}
