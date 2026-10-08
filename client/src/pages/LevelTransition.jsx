import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { LEVELS, TOTAL_LEVELS } from '../config';
import ExitConfirmModal from '../components/ExitConfirmModal';

// Simple CSS confetti burst for cleared levels
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
 * LevelTransition — shown after a student finishes a level in Level-Gated mode.
 *
 * Supports two distinct, unmistakably clear outcomes:
 * 1. SUCCESS: Cutoff cleared → celebration, level summary, explicit "Proceed to Level X" action.
 * 2. FAIL: Cutoff NOT cleared → prominent bold RED "ELIMINATED" badge, "Thank you for participating",
 *    and clear indication that the student has been removed from the quiz and cannot proceed.
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

  // Redirect guard: if state is missing or entire quiz completed, route appropriately
  useEffect(() => {
    if (!student || !lastResult) {
      navigate('/');
      return;
    }
    if (lastResult.isLastLevel && lastResult.passed) {
      navigate('/results');
    }
  }, [student, lastResult, navigate]);

  if (!student || !lastResult) return null;

  const {
    score = 0,
    total = 0,
    cutoff = 0,
    passed = false,
    nextLevel = null,
    nextLevelQuestions = null,
    totalLevels: resultTotalLevels,
    status = '',
  } = lastResult;

  const isEliminated = !passed || status === 'eliminated';
  const totalLevelsDisplay = resultTotalLevels || TOTAL_LEVELS;
  const currentLevelNum = nextLevel ? nextLevel - 1 : (student.currentLevel || 1);
  const nextConfig = nextLevel ? LEVELS[nextLevel] : null;
  const dynamicNextQuestions = nextLevelQuestions || nextConfig?.questions || 15;
  const dynamicNextCutoff = nextConfig?.cutoff
    ? Math.min(nextConfig.cutoff, Math.max(1, Math.ceil(dynamicNextQuestions * 0.7)))
    : 0;

  const handleContinue = () => {
    if (nextLevel) {
      navigate(`/quiz/${nextLevel}`);
    } else {
      navigate('/results');
    }
  };

  const handleConfirmExit = () => {
    clearStudent();
    navigate('/');
  };

  // ── FAIL CASE: ELIMINATED (Cutoff Not Cleared) ──────────────────────────
  if (isEliminated) {
    return (
      <div className="transition-page">
        <div className="transition-content">
          {/* Prominent bold RED ELIMINATED indicator */}
          <div
            className="transition-eliminated-banner"
            style={{
              fontSize: 'clamp(2.5rem, 6vw, 3.8rem)',
              fontWeight: 900,
              color: '#ef4444',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              lineHeight: 1,
              margin: '0.5rem 0 0.75rem',
              textShadow: '0 0 25px rgba(239, 68, 68, 0.45)',
            }}
          >
            ELIMINATED
          </div>

          <div style={{ fontSize: '3rem', marginBottom: '0.25rem' }} role="img" aria-label="Eliminated">
            🚫
          </div>

          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: '0.25rem 0 0.5rem', color: '#fff' }}>
            Thank You for Participating!
          </h2>

          <p className="transition-message" style={{ maxWidth: '440px', margin: '0 auto 1.25rem' }}>
            You attempted <strong>{total}</strong> questions in Level {currentLevelNum} and scored <strong>{score}</strong>.
            The required passing threshold to unlock Level {currentLevelNum + 1} was <strong>{cutoff}</strong> correct answers.
            Unfortunately, you did not meet the cutoff and cannot proceed further.
          </p>

          {/* Level Performance Summary Card */}
          <div
            style={{
              width: '100%',
              maxWidth: '380px',
              padding: '1.25rem',
              borderRadius: '16px',
              background: 'rgba(239, 68, 68, 0.08)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              marginBottom: '1.5rem',
              textAlign: 'left',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Level {currentLevelNum} Score:</span>
              <strong style={{ color: '#fff' }}>{score} / {total}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.9rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Cutoff Required:</span>
              <strong style={{ color: '#fca5a5' }}>{cutoff} / {total}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.9rem' }}>
              <span style={{ color: 'rgba(255,255,255,0.7)' }}>Status:</span>
              <strong style={{ color: '#ef4444' }}>Cutoff Not Cleared</strong>
            </div>
          </div>

          {/* Navigation Actions */}
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button
              type="button"
              className="btn btn-primary"
              style={{ background: '#4f46e5', borderColor: '#6366f1' }}
              onClick={() => navigate('/results')}
            >
              View Full Attempt Summary →
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleConfirmExit}
            >
              Return to Home
            </button>
          </div>
        </div>

        <ExitConfirmModal
          isOpen={showExitModal}
          title="Return to Home?"
          subtitle="Are you sure you want to exit and return to the main entry page?"
          onCancel={() => setShowExitModal(false)}
          onConfirm={handleConfirmExit}
        />
      </div>
    );
  }

  // ── SUCCESS CASE: LEVEL CLEARED ──────────────────────────────────────────
  return (
    <div className="transition-page">
      <Confetti />

      <div className="transition-content">
        <div className="transition-celebration" role="img" aria-label="Celebration">🎉</div>

        <h1 className="transition-title">Level {currentLevelNum} Cleared!</h1>

        {/* Dynamic level progression indicator */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, margin: '0.6rem 0 0.4rem' }}>
          {Array.from({ length: totalLevelsDisplay }, (_, i) => {
            const lvl = i + 1;
            const done = lvl <= currentLevelNum;
            const isNext = lvl === nextLevel;
            return (
              <div key={lvl} style={{ display: 'flex', alignItems: 'center' }}>
                {i > 0 && <div style={{ width: '24px', height: '2px', background: done ? '#10b981' : 'rgba(255,255,255,0.15)' }} />}
                <div style={{
                  width: isNext ? '28px' : '20px', height: isNext ? '28px' : '20px',
                  borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: isNext ? '0.78rem' : '0.65rem',
                  color: done ? '#fff' : isNext ? '#fff' : 'rgba(255,255,255,0.35)',
                  background: done ? 'linear-gradient(135deg,#10b981,#059669)' : isNext ? 'linear-gradient(135deg,#6366f1,#4f46e5)' : 'rgba(255,255,255,0.06)',
                  border: done ? '2px solid #10b981' : isNext ? '2px solid #818cf8' : '2px solid rgba(255,255,255,0.12)',
                  boxShadow: isNext ? '0 0 10px rgba(99,102,241,0.5)' : 'none',
                  transition: 'all 0.3s',
                }}>{done ? '✓' : lvl}</div>
              </div>
            );
          })}
          <span style={{ marginLeft: '0.6rem', fontSize: '0.7rem', color: 'rgba(255,255,255,0.4)', fontWeight: 600 }}>
            {currentLevelNum} of {totalLevelsDisplay} done
          </span>
        </div>

        <p className="transition-score">{score} / {total} correct</p>
        <p className="transition-message">
          You attempted {total} questions and scored {score}. You've cleared the passing cutoff and can proceed to Level {nextLevel}!
        </p>

        {nextConfig && (
          <div className="transition-next-info">
            <strong>Up next:</strong> {nextConfig.label} — {nextConfig.sublabel}
            <br />
            {dynamicNextQuestions} questions · {Math.floor(nextConfig.timeSeconds / 60)} minutes
            {dynamicNextCutoff > 0 && ` · Need ${dynamicNextCutoff}/${dynamicNextQuestions} to advance`}
          </div>
        )}

        {/* Student must explicitly click this to proceed to the next level */}
        <button
          id="continue-btn"
          className="btn btn-primary transition-btn"
          onClick={handleContinue}
        >
          Proceed to Level {nextLevel} →
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
