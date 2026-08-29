import { useState, useEffect, useRef } from 'react';

export default function QuestionTimer({ durationSeconds = 30, questionIndex, onTimeUp }) {
  const [timeLeft, setTimeLeft] = useState(durationSeconds);
  const onTimeUpRef = useRef(onTimeUp);

  useEffect(() => {
    onTimeUpRef.current = onTimeUp;
  }, [onTimeUp]);

  // Reset timer on question change or duration change
  useEffect(() => {
    setTimeLeft(durationSeconds);
  }, [questionIndex, durationSeconds]);

  // Decrement timer
  useEffect(() => {
    if (timeLeft <= 0) {
      if (onTimeUpRef.current) {
        onTimeUpRef.current();
      }
      return;
    }

    const timer = setInterval(() => {
      setTimeLeft((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(timer);
  }, [timeLeft]);

  const pct = Math.max(0, Math.min(100, (timeLeft / durationSeconds) * 100));
  const isUrgent = timeLeft <= 5;

  return (
    <div className={`question-timer-wrapper ${isUrgent ? 'urgent' : ''}`}>
      <div className="question-timer-header">
        <span className="question-timer-label">⏱️ Question Timer</span>
        <span className="question-timer-time">{timeLeft}s</span>
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
