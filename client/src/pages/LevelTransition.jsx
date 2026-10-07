import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { LEVELS, TOTAL_LEVELS } from '../config';
import ExitConfirmModal from '../components/ExitConfirmModal';

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
  const { student, lastResult, clearStudent } = useQuiz();
  const [showExitModal, setShowExitModal] = useState(false);

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

  // Guard: redirect if state is missing or the level was not passed
  useEffect(() => {
    if (!student || !lastResult) { navigate('/'); return; }
    if (!lastResult.passed)      { navigate('/results'); return; }
  }, [student, lastResult, navigate]);

  if (!student || !lastResult) return null;

  const { score, total, nextLevel, nextLevelQuestions, totalLevels: resultTotalLevels } = lastResult;
  const totalLevelsDisplay = resultTotalLevels || TOTAL_LEVELS;
  const nextConfig   = LEVELS[nextLevel];
  const clearedLevel = nextLevel - 1;
  const dynamicNextQuestions = nextLevelQuestions || nextConfig?.questions || 15;
  const dynamicNextCutoff = nextConfig?.cutoff
    ? Math.min(nextConfig.cutoff, Math.max(1, Math.ceil(dynamicNextQuestions * 0.7)))
    : 0;

  // Manual navigation only — user must consciously click to start next level
  const handleContinue = () => navigate(`/quiz/${nextLevel}`);

  const handleConfirmExit = () => {
    clearStudent();
    navigate('/');
  };

  return (
    <div className="transition-page">
      <Confetti />

      <div className="transition-content">
        <div className="transition-celebration" role="img" aria-label="Celebration">🎉</div>

        <h1 className="transition-title">Level {clearedLevel} Cleared!</h1>
        {/* Dynamic level progression indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, margin: '0.6rem 0 0.4rem' }}>
          {Array.from({ length: totalLevelsDisplay }, (_, i) => {
            const lvl = i + 1;
            const done = lvl <= clearedLevel;
            const next = lvl === nextLevel;
            return (
              <div key={lvl} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <div style={{ width: '24px', height: '2px', background: done ? '#10b981' : 'rgba(255,255,255,0.15)' }} />}
                <div style={{
                  width: next ? '28px' : '20px', height: next ? '28px' : '20px',
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: next ? '0.78rem' : '0.65rem',
                  color: done ? '#fff' : next ? '#fff' : 'rgba(255,255,255,0.35)',
                  background: done ? 'linear-gradient(135deg,#10b981,#059669)' : next ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'rgba(255,255,255,0.06)',
                  border: done ? '2px solid #10b981' : next ? '2px solid #818cf8' : '2px solid rgba(255,255,255,0.12)',
                  boxShadow: next ? '0 0 10px rgba(99,102,241,0.5)' : 'none',
                  transition: 'all 0.3s',
                }}>{done ? '✓' : lvl}</div>
              </div>
            );
          })}
          <span style={{ marginLeft: '0.6rem', fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
            {clearedLevel} of {totalLevelsDisplay} done
          </span>
        </div>
        <p className="transition-score">{score} / {total} correct</p>
        <p className="transition-message">
          Outstanding! You've made it to the next round. Keep up the momentum!
        </p>

        {nextConfig && (
          <div className="transition-next-info">
            <strong>Up next:</strong> {nextConfig.label} — {nextConfig.sublabel}
            <br />
            {dynamicNextQuestions} questions · {Math.floor(nextConfig.timeSeconds / 60)} minutes
            {dynamicNextCutoff > 0 && ` · Need ${dynamicNextCutoff}/${dynamicNextQuestions} to advance`}
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

      <ExitConfirmModal
        isOpen={showExitModal}
        title="Are you sure you want to exit?"
        subtitle="If you exit now, your current quiz progress will be reset and you will return to the home screen."
        onCancel={() => setShowExitModal(false)}
        onConfirm={handleConfirmExit}
      />
    </div>
  );
}
