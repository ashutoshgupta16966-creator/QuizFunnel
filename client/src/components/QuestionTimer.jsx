import { useState, useEffect } from 'react';

export default function QuestionTimer({ durationSeconds = 30, questionIndex }) {
  const [timeLeft, setTimeLeft] = useState(durationSeconds);

  // Reset timer on question change or duration change
  useEffect(() => {
    setTimeLeft(durationSeconds);
  }, [questionIndex, durationSeconds]);

  // Decrement timer for visual progress only (no forced auto-move)
  useEffect(() => {
    if (timeLeft <= 0) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const pct = Math.max(0, Math.min(100, (timeLeft / durationSeconds) * 100));
  const isUrgent = timeLeft <= 5 && timeLeft > 0;

  return (
    <div className={`question-timer-wrapper ${isUrgent ? 'urgent' : ''}`}>
      <div className="question-timer-header">
        <span className="question-timer-label">⏱️ Question Pace</span>
        <span className="question-timer-time">{timeLeft > 0 ? `${timeLeft}s` : 'Time Elapsed'}</span>
      </div>
      <div className="question-timer-track">
        <div
          className="question-timer-fill"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
