import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import confetti from 'canvas-confetti';
import { useQuiz } from '../context/QuizContext';
import ThemeToggle from '../components/ThemeToggle';
import ReviewSection from '../components/ReviewSection';
import ExitConfirmModal from '../components/ExitConfirmModal';

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

const HISTORY_STORAGE_KEY = 'quiz_attempts_history';

/**
 * Results — shown after elimination or Level 4 completion.
 */
export default function Results() {
  const navigate  = useNavigate();
  const { student, lastResult, clearStudent } = useQuiz();
  const [showExitModal, setShowExitModal] = useState(false);

  const isCompleted  = student?.status === 'completed';
  const isEliminated = student?.status === 'eliminated';

  const isAntiCheated = !!(student?.mobile && localStorage.getItem(`quiz_anti_cheated_${student.mobile}`) === '1');

  // ── Strict Scroll lock when disqualified ──────────────────────────────────
  useEffect(() => {
    if (isAntiCheated) {
      const origBodyOverflow = document.body.style.overflow;
      const origHtmlOverflow = document.documentElement.style.overflow;
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = origBodyOverflow;
        document.documentElement.style.overflow = origHtmlOverflow;
      };
    }
  }, [isAntiCheated]);

  // Intercept browser back button & swipe gestures
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);
    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
      setShowExitModal(true);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  // Guard: if there's no student in context at all, go home
  useEffect(() => {
    if (!student) navigate('/');
  }, [student, navigate]);

  const score          = lastResult?.score ?? 0;
  const total          = lastResult?.total ?? 0;
  const totalScore     = lastResult?.totalScore ?? student?.totalScore ?? score;
  const totalTimeTaken = lastResult?.totalTimeTaken ?? student?.totalTimeTaken ?? 0;

  const clearedLevel   = isCompleted ? 4 : (student?.currentLevel || 1);
  const maxPossible    = CUMULATIVE_MAX[clearedLevel] || 50;
  const accuracyPct    = maxPossible > 0
    ? Math.min(100, Math.round((totalScore / maxPossible) * 100))
    : 0;

  const formattedTime  = formatTimeMMSS(totalTimeTaken);

  // ── Win Celebration Confetti Effect ───────────────────────────────────────
  useEffect(() => {
    if (isCompleted && !isAntiCheated) {
      // Cannon bursts from left & right
      const duration = 3 * 1000;
      const animationEnd = Date.now() + duration;

      const frame = () => {
        confetti({
          particleCount: 4,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.65 },
          colors: ['#4361ee', '#4cc9f0', '#10b981', '#fbbf24', '#f72585'],
        });
        confetti({
          particleCount: 4,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.65 },
          colors: ['#4361ee', '#4cc9f0', '#10b981', '#fbbf24', '#f72585'],
        });

        if (Date.now() < animationEnd) {
          requestAnimationFrame(frame);
        }
      };

      frame();
    }
  }, [isCompleted, isAntiCheated]);

  // ── Auto-save attempt to persistent localStorage history ──────────────────
  useEffect(() => {
    if (!student || (!isCompleted && !isEliminated) || isAntiCheated) return;
    try {
      const existing = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
      const attemptId = `${student.mobile}_${clearedLevel}_${totalScore}_${totalTimeTaken}`;

      const alreadySaved = existing.some((a) => a.id === attemptId);
      if (!alreadySaved) {
        const newRecord = {
          id: attemptId,
          attemptDate: new Date().toISOString(),
          studentName: student.name,
          mobile: student.mobile,
          branch: student.branch,
          levelReached: clearedLevel,
          totalScore,
          maxPossible,
          accuracyPct,
          totalTimeTaken,
          timeFormatted: formattedTime,
          status: isCompleted ? 'completed' : 'eliminated',
        };
        const updated = [newRecord, ...existing].slice(0, 30);
        localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
      }
    } catch { /* noop */ }
  }, [student, clearedLevel, totalScore, totalTimeTaken, maxPossible, accuracyPct, formattedTime, isCompleted, isEliminated, isAntiCheated]);

  if (!student) return null;

  const handleReturnHome = () => {
    if (student?.mobile) {
      try {
        localStorage.removeItem(`quiz_anti_cheated_${student.mobile}`);
        localStorage.removeItem(`quiz_tab_switches_${student.mobile}`);
      } catch { /* noop */ }
    }
    clearStudent();
    window.location.replace('/');
  };

  // ── Anti-Cheating Disqualification Screen ──────────────────────────────────
  if (isAntiCheated) {
    return (
      <div className="disqualification-fullscreen-overlay">
        <div className="disqualification-modal-card" role="alertdialog" aria-modal="true">
          <div className="disqualification-modal-icon" role="img" aria-label="Disqualified">
            🚨
          </div>
          <h1 className="disqualification-modal-title">
            Assessment Terminated &amp; Disqualified
          </h1>
          <div className="disqualification-pill">
            <span>Violation:</span>
            <strong>Tab-Switch Limit Exceeded (10/10)</strong>
          </div>
          <p className="disqualification-modal-desc">
            Your quiz attempt was terminated and locked due to exceeding the maximum allowed limit of <strong>10 tab switches</strong>.
            All answers and performance scores for this session have been disqualified to uphold academic integrity.
          </p>
          <div className="disqualification-modal-actions">
            <button
              type="button"
              className="btn btn-home-disqualified"
              onClick={handleReturnHome}
            >
              ← Return to Home Screen
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Eliminated ─────────────────────────────────────────────────────────────
  if (isEliminated) {
    return (
      <div className="results-page">
        <div className="results-top-bar">
          <ThemeToggle />
        </div>

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

        {/* Detailed Question Review — ONLY unlocked if user was not disqualified */}
        {!isAntiCheated && <ReviewSection mobile={student.mobile} />}

        <button className="btn btn-secondary" onClick={handleReturnHome}>
          Return to Home
        </button>

        <ExitConfirmModal
          isOpen={showExitModal}
          title="Return to Home Screen?"
          subtitle="Are you sure you want to leave the results screen and return to the main entry page?"
          onCancel={() => setShowExitModal(false)}
          onConfirm={handleReturnHome}
        />
      </div>
    );
  }

  // ── Level 4 Completed (WINNER) ─────────────────────────────────────────────
  if (isCompleted) {
    return (
      <div className="results-page win-celebration-page">
        <div className="results-top-bar">
          <ThemeToggle />
        </div>

        <div className="win-banner-badge">
          🎉 VICTORY UNLOCKED 🎉
        </div>

        <div className="results-icon win-trophy-pop" role="img" aria-label="Trophy">🏆</div>
        <h1 className="results-title completed win-title-glow">Congratulations! You Won!</h1>
        <p className="results-message">
          Exceptional performance, <strong>{student.name}</strong>! You cleared all 4 levels of the Quiz Funnel.
          Your score has been registered for the final leaderboard rankings.
        </p>

        <div className="score-card win-score-card">
          <p className="score-card-title">🏆 Champion Performance Summary</p>
          <div className="score-row">
            <span className="score-label">Level 4 Final Score</span>
            <span className="score-value">{score} / {total}</span>
          </div>
          <div className="score-row">
            <span className="score-label">Grand Total Score</span>
            <span className="score-value">{totalScore} / 50</span>
          </div>
          <div className="score-row">
            <span className="score-label">Accuracy Rate</span>
            <span className="score-value">{accuracyPct}%</span>
          </div>
          <div className="score-row">
            <span className="score-label">Total Completion Speed</span>
            <span className="score-value">{formattedTime}</span>
          </div>
        </div>

        <div className="results-note win-note">
          <span>👑</span>
          <span>Rankings will be finalized after all students complete the quiz.</span>
        </div>

        {/* Detailed Question Review */}
        {!isAntiCheated && <ReviewSection mobile={student.mobile} />}

        <button className="btn btn-primary win-home-btn" onClick={handleReturnHome}>
          Return to Home
        </button>

        <ExitConfirmModal
          isOpen={showExitModal}
          title="Return to Home Screen?"
          subtitle="Are you sure you want to leave the results screen and return to the main entry page?"
          onCancel={() => setShowExitModal(false)}
          onConfirm={handleReturnHome}
        />
      </div>
    );
  }

  // ── Fallback ───────────────────────────────────────────────────────────────
  return (
    <div className="centered-page">
      <p>Loading results…</p>
      <button className="btn btn-secondary" onClick={handleReturnHome}>Go Home</button>
      <ExitConfirmModal
        isOpen={showExitModal}
        title="Return to Home Screen?"
        subtitle="Are you sure you want to return to the main entry page?"
        onCancel={() => setShowExitModal(false)}
        onConfirm={handleReturnHome}
      />
    </div>
  );
}
