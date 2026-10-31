import { useState, useEffect, useCallback } from 'react';

/**
 * useLockout hook for tracking brute-force lockout countdowns.
 * - Restores remaining lockout seconds after page reload via localStorage.
 * - Counts down every second.
 * - Automatically re-enables inputs when countdown reaches 0.
 *
 * @param {string} storageKey - Unique identifier for the form (e.g. 'results_auth', 'my_rooms', 'admin_login', 'room_join')
 * @returns {{ isLocked: boolean, retryAfter: number, lockForSeconds: (sec: number) => void, clearLockout: () => void }}
 */
export function useLockout(storageKey) {
  const getRemainingTime = useCallback(() => {
    try {
      const storedUntil = localStorage.getItem(`quiz_lockout_${storageKey}`);
      if (storedUntil) {
        const remaining = Math.ceil((Number(storedUntil) - Date.now()) / 1000);
        if (remaining > 0) return remaining;
        localStorage.removeItem(`quiz_lockout_${storageKey}`);
      }
    } catch {}
    return 0;
  }, [storageKey]);

  const [retryAfter, setRetryAfter] = useState(getRemainingTime);

  useEffect(() => {
    const initial = getRemainingTime();
    setRetryAfter(initial);
  }, [getRemainingTime]);

  useEffect(() => {
    if (retryAfter <= 0) return;

    const timer = setInterval(() => {
      setRetryAfter((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          try {
            localStorage.removeItem(`quiz_lockout_${storageKey}`);
          } catch {}
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [retryAfter, storageKey]);

  const lockForSeconds = useCallback(
    (seconds) => {
      const s = Math.max(1, Number(seconds) || 15);
      const lockUntil = Date.now() + s * 1000;
      try {
        localStorage.setItem(`quiz_lockout_${storageKey}`, String(lockUntil));
      } catch {}
      setRetryAfter(s);
    },
    [storageKey]
  );

  const clearLockout = useCallback(() => {
    try {
      localStorage.removeItem(`quiz_lockout_${storageKey}`);
    } catch {}
    setRetryAfter(0);
  }, [storageKey]);

  return {
    isLocked: retryAfter > 0,
    retryAfter,
    lockForSeconds,
    clearLockout,
  };
}

export default useLockout;

