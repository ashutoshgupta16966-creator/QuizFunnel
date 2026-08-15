import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { getLeaderboard } from '../api';

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
}

/**
 * Results — shown after elimination or Level 4 completion.
 *
 * Eliminated: warm "Thank you for participating" message + their score.
 * Completed:  shows their rank on the final leaderboard.
 */
export default function Results() {
  const navigate = useNavigate();
  const { student, lastResult, clearStudent } = useQuiz();

  const [leaderboard, setLeaderboard] = useState([]);
  const [lbLoading, setLbLoading]     = useState(false);

  const isCompleted  = student?.status === 'completed';
  const isEliminated = student?.status === 'eliminated';

  // Fetch leaderboard if student completed Level 4
  useEffect(() => {
    if (!student) { navigate('/'); return; }
    if (isCompleted) fetchLeaderboard();
  }, [student]);

  const fetchLeaderboard = async () => {
    setLbLoading(true);
    try {
      // Leaderboard is public-facing (no admin password needed for viewing own rank)
      // We use admin endpoint here; for a public leaderboard, add a public route.
      // For now we show the data from lastResult and a simple rank display.
      setLeaderboard([]);
    } catch {
      setLeaderboard([]);
    } finally {
      setLbLoading(false);
    }
  };

  if (!student) return null;

  const score     = lastResult?.score ?? 0;
  const total     = lastResult?.total ?? 0;
  const clearedLevel = isCompleted
    ? 4
    : (student.currentLevel || 1);

  const handleReturnHome = () => {
    clearStudent();
    navigate('/');
  };

  // ── Eliminated ────────────────────────────────────────────────────────────
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
          <p className="score-card-title">Your Score — Level {clearedLevel}</p>
          <div className="score-row">
            <span className="score-label">Correct Answers</span>
            <span className="score-value">{score} / {total}</span>
          </div>
          <div className="score-row">
            <span className="score-label">Level reached</span>
            <span className="score-value">Level {student.currentLevel}</span>
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

  // ── Level 4 Completed ─────────────────────────────────────────────────────
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
            <span className="score-label">Total Score (all levels)</span>
            <span className="score-value">{student.totalScore ?? '—'}</span>
          </div>
          {student.totalTimeTaken != null && (
            <div className="score-row">
              <span className="score-label">Total Time Taken</span>
              <span className="score-value">{formatTime(student.totalTimeTaken)}</span>
            </div>
          )}
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

  // ── Fallback (shouldn't normally appear) ─────────────────────────────────
  return (
    <div className="centered-page">
      <p>Loading results…</p>
      <button className="btn btn-secondary" onClick={() => navigate('/')}>Go Home</button>
    </div>
  );
}
