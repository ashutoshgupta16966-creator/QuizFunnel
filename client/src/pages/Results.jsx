import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';

/**
 * Format seconds into MM:SS format (e.g. 14:25).
 */
function formatTimeMMSS(seconds) {
  if (!seconds && seconds !== 0) return '00:00';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Cumulative maximum possible questions up to each level
const CUMULATIVE_MAX = {
  1: 20,
  2: 35,
  3: 45,
  4: 50,
};

/**
 * Results — shown after elimination or Level 4 completion.
 *
 * Displays:
 *  - Final / Level score
 *  - Total Score across all levels (e.g. 38 / 50)
 *  - Accuracy Percentage (e.g. 85%)
 *  - Total Completion Time (MM:SS) for leaderboard ranking
 */
export default function Results() {
  const navigate  = useNavigate();
  const { student, lastResult, clearStudent } = useQuiz();

  const isCompleted  = student?.status === 'completed';
  const isEliminated = student?.status === 'eliminated';

  // Guard: if there's no student in context at all, go home
  useEffect(() => {
    if (!student) navigate('/');
  }, [student, navigate]);

  if (!student) return null;

  const score  = lastResult?.score ?? 0;
  const total  = lastResult?.total ?? 0;

  // Cumulative score and time across all completed levels
  const totalScore     = lastResult?.totalScore ?? student?.totalScore ?? score;
  const totalTimeTaken = lastResult?.totalTimeTaken ?? student?.totalTimeTaken ?? 0;

  const clearedLevel   = isCompleted ? 4 : (student.currentLevel || 1);
  const maxPossible    = CUMULATIVE_MAX[clearedLevel] || 50;

  const accuracyPct    = maxPossible > 0
    ? Math.min(100, Math.round((totalScore / maxPossible) * 100))
    : 0;

  const formattedTime  = formatTimeMMSS(totalTimeTaken);

  const handleReturnHome = () => {
    clearStudent();
    window.location.replace('/');
  };

  // ── Eliminated ─────────────────────────────────────────────────────────────
  if (isEliminated) {
    return (
      <div className="results-page">
        <div className="results-icon" role="img" aria-label="Thank you">🙏</div>
        <h1 className="results-title eliminated">Thank You for Participating!</h1>
        <p className="results-message">
          You gave it your best shot — and that's what matters. Every attempt
          is a step toward growth. We appreciate your enthusiasm and hope to
          see you excel next time!
        </p>

        <div className="score-card">
          <p className="score-card-title">Performance Summary — Level {clearedLevel}</p>
          <div className="score-row">
            <span className="score-label">Level {clearedLevel} Score</span>
            <span className="score-value">{score} / {total}</span>
          </div>
          <div className="score-row">
            <span className="score-label">Total Score (Cumulative)</span>
            <span className="score-value">{totalScore} / {maxPossible}</span>
          </div>
          <div className="score-row">
            <span className="score-label">Accuracy</span>
            <span className="score-value">{accuracyPct}%</span>
          </div>
          <div className="score-row">
            <span className="score-label">Total Time Taken</span>
            <span className="score-value">{formattedTime}</span>
          </div>
          {lastResult?.cutoff > 0 && (
            <div className="score-row">
              <span className="score-label">Cutoff needed</span>
              <span className="score-value">{lastResult.cutoff} / {total}</span>
            </div>
          )}
        </div>

        <button className="btn btn-secondary" onClick={handleReturnHome}>
          Return to Home
        </button>
      </div>
    );
  }

  // ── Level 4 Completed ──────────────────────────────────────────────────────
  if (isCompleted) {
    return (
      <div className="results-page">
        <div className="results-icon" role="img" aria-label="Trophy">🏆</div>
        <h1 className="results-title completed">You Completed All 4 Levels!</h1>
        <p className="results-message">
          Exceptional performance! You've made it through the entire quiz.
          Final results and selection announcements will be shared by the
          faculty after orientation.
        </p>

        <div className="score-card">
          <p className="score-card-title">Final Performance Summary</p>
          <div className="score-row">
            <span className="score-label">Level 4 Score</span>
            <span className="score-value">{score} / {total}</span>
          </div>
          <div className="score-row">
            <span className="score-label">Total Score (All 4 Levels)</span>
            <span className="score-value">{totalScore} / 50</span>
          </div>
          <div className="score-row">
            <span className="score-label">Accuracy Rate</span>
            <span className="score-value">{accuracyPct}%</span>
          </div>
          <div className="score-row">
            <span className="score-label">Total Time Taken</span>
            <span className="score-value">{formattedTime}</span>
          </div>
        </div>

        <div className="results-note">
          <span>📋</span>
          <span>Rankings will be finalized after all students complete the quiz.</span>
        </div>

        <button className="btn btn-secondary" onClick={handleReturnHome}>
          Return to Home
        </button>
      </div>
    );
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return (
    <div className="centered-page">
      <p>Loading results…</p>
      <button className="btn btn-secondary" onClick={handleReturnHome}>Go Home</button>
    </div>
  );
}
