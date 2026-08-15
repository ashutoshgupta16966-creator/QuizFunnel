/**
 * ProgressBar
 * Shows current question position and answered count as a horizontal bar.
 *
 * Props:
 *   current  — 1-based current question number
 *   total    — total questions in this level
 *   answered — how many questions have been answered so far
 */
export default function ProgressBar({ current, total, answered }) {
  const pct = ((current - 1) / total) * 100;

  return (
    <div className="progress-bar-container">
      <div className="progress-bar-track" role="progressbar"
           aria-valuenow={current} aria-valuemin={1} aria-valuemax={total}>
        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="progress-info">
        <span>Question {current} of {total}</span>
        <span>{answered} answered</span>
      </div>
    </div>
  );
}
