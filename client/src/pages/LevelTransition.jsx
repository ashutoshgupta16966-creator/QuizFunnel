import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { LEVELS } from '../config';

// Simple CSS confetti burst — no library needed
function Confetti() {
  const pieces = Array.from({ length: 40 }, (_, i) => ({
    id: i,
    left:     `${Math.random() * 100}%`,
    delay:    `${Math.random() * 0.8}s`,
    duration: `${1.5 + Math.random() * 1.5}s`,
    color:    ['#4361EE', '#4CC9F0', '#F72585', '#FBBF24', '#10B981'][i % 5],
    size:     `${6 + Math.random() * 8}px`,
  }));

  return (
    <div className="confetti-container" aria-hidden>
      {pieces.map((p) => (
        <div
          key={p.id}
          className="confetti-piece"
          style={{
            left:              p.left,
            width:             p.size,
            height:            p.size,
            background:        p.color,
            animationDelay:    p.delay,
            animationDuration: p.duration,
            borderRadius:      Math.random() > 0.5 ? '50%' : '2px',
          }}
        />
      ))}
    </div>
  );
}

/**
 * LevelTransition — shown after a student clears a level.
 *
 * FIX: Auto-advance (countdown timer) has been REMOVED.
 * The student must explicitly click "Proceed to Next Level" to continue.
 * This prevents accidental level skips and gives students time to prepare.
 */
export default function LevelTransition() {
  const navigate = useNavigate();
  const { student, lastResult } = useQuiz();

  // Guard: redirect if state is missing or the level was not passed
  useEffect(() => {
    if (!student || !lastResult) { navigate('/'); return; }
    if (!lastResult.passed)      { navigate('/results'); return; }
  }, [student, lastResult, navigate]);

  if (!student || !lastResult) return null;

  const { score, total, nextLevel } = lastResult;
  const nextConfig   = LEVELS[nextLevel];
  const clearedLevel = nextLevel - 1;

  // Manual navigation only — user must consciously click to start next level
  const handleContinue = () => navigate(`/quiz/${nextLevel}`);

  return (
    <div className="transition-page">
      <Confetti />

      <div className="transition-content">
        <div className="transition-celebration" role="img" aria-label="Celebration">🎉</div>

        <h1 className="transition-title">Level {clearedLevel} Cleared!</h1>
        <p className="transition-score">{score} / {total} correct</p>
        <p className="transition-message">
          Outstanding! You've made it to the next round. Keep up the momentum!
        </p>

        {nextConfig && (
          <div className="transition-next-info">
            <strong>Up next:</strong> {nextConfig.label} — {nextConfig.sublabel}
            <br />
            {nextConfig.questions} questions · {Math.floor(nextConfig.timeSeconds / 60)} minutes
            {nextConfig.cutoff > 0 && ` · Need ${nextConfig.cutoff}/${nextConfig.questions} to advance`}
          </div>
        )}

        {/* Student must explicitly click this — no auto-advance countdown */}
        <button
          id="continue-btn"
          className="btn btn-primary transition-btn"
          onClick={handleContinue}
        >
          Proceed to Next Level →
        </button>
      </div>
    </div>
  );
}
