import { useState, useEffect, useRef } from 'react';

/**
 * TimerBar
 * Props:
 *   totalSeconds — total time allowed (from level config)
 *   startedAt    — Date object of when the session began (from server)
 *   onTimeUp     — callback when timer reaches 0
 */
export default function TimerBar({ totalSeconds, startedAt, onTimeUp }) {
  const [remaining, setRemaining] = useState(totalSeconds);
  const calledRef = useRef(false);
  const intervalRef = useRef(null);

  useEffect(() => {
    if (!startedAt) return;

    const tick = () => {
      const elapsed = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
      const left = Math.max(0, totalSeconds - elapsed);
      setRemaining(left);

      if (left === 0 && !calledRef.current) {
        calledRef.current = true;
        clearInterval(intervalRef.current);
        onTimeUp?.();
      }
    };

    tick(); // immediate first tick
    intervalRef.current = setInterval(tick, 1000);
    return () => clearInterval(intervalRef.current);
  }, [startedAt, totalSeconds, onTimeUp]);

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  const timeStr  = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  const pct = (remaining / totalSeconds) * 100;

  const isDanger  = pct <= 25;   // last 25% → red
  const isWarning = pct <= 50 && !isDanger; // 25–50% → yellow

  const barClass = isDanger ? 'timer-bar-fill timer-danger'
                 : isWarning ? 'timer-bar-fill timer-warning'
                 : 'timer-bar-fill';

  const displayClass = isDanger ? 'timer-display timer-danger'
                     : isWarning ? 'timer-display timer-warning'
                     : 'timer-display';

  return (
    <div className="timer-container" role="timer" aria-label={`Time remaining: ${timeStr}`}>
      <div className="timer-bar-track" aria-hidden>
        <div className={barClass} style={{ width: `${pct}%` }} />
      </div>
      <span className={displayClass}>{timeStr}</span>
    </div>
  );
}
