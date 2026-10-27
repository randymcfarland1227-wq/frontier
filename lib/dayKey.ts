import { useEffect, useState } from 'react';

export const localDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Today's date key; flips at midnight even if the tab sat open or the phone slept (checked on return, focus and every minute). */
export function useDayKey() {
  const [day, setDay] = useState(localDayKey);
  useEffect(() => {
    const check = () => setDay(prev => {
      const now = localDayKey();
      return now === prev ? prev : now;
    });
    const onVisible = () => document.visibilityState === 'visible' && check();
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
      window.clearInterval(timer);
    };
  }, []);
  return day;
}

/** A small per-day record kept on this device: it starts empty each new day. */
export function dayRecord<T>(key: string, day: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? (JSON.parse(raw) as { day?: string; v?: T }) : null;
    return parsed && parsed.day === day && parsed.v !== undefined ? parsed.v : fallback;
  } catch {
    return fallback;
  }
}
