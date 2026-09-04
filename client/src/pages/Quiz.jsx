import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { getQuestions, submitQuiz } from '../api';
import { LEVELS } from '../config';
import QuestionCard from '../components/QuestionCard';
import TimerBar from '../components/TimerBar';
import ProgressBar from '../components/ProgressBar';
import Toast from '../components/Toast';
import ExitConfirmModal from '../components/ExitConfirmModal';
import ThemeToggle from '../components/ThemeToggle';
import AntiCheatModal from '../components/AntiCheatModal';
import QuestionPalette from '../components/QuestionPalette';
import UnattemptedWarningModal from '../components/UnattemptedWarningModal';

export default function Quiz() {
  const { level: levelParam } = useParams();
  const levelNum = parseInt(levelParam, 10);
  const levelConfig = LEVELS[levelNum];
  const navigate = useNavigate();
  const { student, updateStudent, setLastResult, clearStudent } = useQuiz();

  const [questions, setQuestions]       = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers]           = useState({});   // { questionId: selectedIndex }
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(null);
  const [submitting, setSubmitting]     = useState(false);
  const [toast, setToast]               = useState(null);
  const [startedAt, setStartedAt]       = useState(null);
  const [showExitModal, setShowExitModal] = useState(false);
  const [showUnattemptedModal, setShowUnattemptedModal] = useState(false);

  // Storage keys for auto-saving progress & bookmarks
  const progressKey = student?.mobile ? `quiz_progress_${student.mobile}_${levelNum}` : null;
  const bookmarkKey = student?.mobile ? `quiz_bookmarks_${student.mobile}_${levelNum}` : null;

  // ── Question Bookmarks State ─────────────────────────────────────────────
  const [bookmarks, setBookmarks] = useState(() => {
    try {
      if (bookmarkKey) {
        return JSON.parse(localStorage.getItem(bookmarkKey) || '{}');
      }
    } catch { /* noop */ }
    return {};
  });

  const handleToggleBookmark = useCallback((qId) => {
    setBookmarks((prev) => {
      const next = { ...prev };
      if (next[qId]) {
        delete next[qId];
      } else {
        next[qId] = true;
      }
      if (bookmarkKey) {
        try { localStorage.setItem(bookmarkKey, JSON.stringify(next)); } catch { /* noop */ }
      }
      return next;
    });
  }, [bookmarkKey]);

  // ── Anti-Cheating & Tab Switching State ──────────────────────────────────
  const [tabSwitchCount, setTabSwitchCount] = useState(() => {
    try {
      if (student?.mobile) {
        return parseInt(localStorage.getItem(`quiz_tab_switches_${student.mobile}`) || '0', 10);
      }
    } catch { /* noop */ }
    return 0;
  });
  const [showAntiCheatModal, setShowAntiCheatModal] = useState(false);
  const [isAntiCheatTerminal, setIsAntiCheatTerminal] = useState(false);

  // Intercept browser back button & mobile swipe-back gesture to trigger Exit Confirmation modal
  useEffect(() => {
    window.history.pushState(null, '', window.location.href);

    const handlePopState = () => {
      window.history.pushState(null, '', window.location.href);
      setShowExitModal(true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, []);

  // Prevent double-submit (timer + manual button race)
  const hasSubmitted = useRef(false);

  // ── Guard: redirect if student isn't supposed to be here ─────────────────
  useEffect(() => {
    if (!student) { navigate('/'); return; }
    if (!levelConfig) { navigate('/'); return; }
    if (student.status === 'eliminated' || student.status === 'completed') {
      navigate('/results'); return;
    }
    if (student.currentLevel !== levelNum) {
      navigate(`/quiz/${student.currentLevel}`); return;
    }
    loadQuestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelNum]);

  // ── Auto-save progress restoration ───────────────────────────────────────
  const restoreSavedProgress = (qs) => {
    if (!progressKey) return;
    try {
      const saved = localStorage.getItem(progressKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.answers && typeof parsed.answers === 'object') {
          setAnswers(parsed.answers);
        }
        if (typeof parsed?.currentIndex === 'number' && parsed.currentIndex < qs.length) {
          setCurrentIndex(parsed.currentIndex);
        }
      }
    } catch { /* noop */ }
  };

  // ── Auto-save progress change listener ───────────────────────────────────
  useEffect(() => {
    if (!progressKey || loading || questions.length === 0 || hasSubmitted.current) return;
    try {
      localStorage.setItem(progressKey, JSON.stringify({
        currentIndex,
        answers,
        updatedAt: Date.now(),
      }));
    } catch { /* noop */ }
  }, [answers, currentIndex, progressKey, loading, questions]);

  // ── Browser unload / navigation protection ────────────────────────────────
  useEffect(() => {
    const handleBeforeUnload = (e) => {
      if (!hasSubmitted.current && !loading && questions.length > 0) {
        e.preventDefault();
        e.returnValue = 'Are you sure you want to exit? Your quiz progress will be lost.';
        return e.returnValue;
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [loading, questions]);

  // ── Show reconnecting toast on API retry ──────────────────────────────────
  useEffect(() => {
    const handler = (e) => {
      setToast({
        type: 'warning',
        message: `Reconnecting… (attempt ${e.detail.attempt}/3)`,
        duration: 3000,
      });
    };
    window.addEventListener('api:retry', handler);
    return () => window.removeEventListener('api:retry', handler);
  }, []);

  const loadQuestions = async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const res = await getQuestions(levelNum, student.mobile);
      const { questions: qs, startedAt: sAt } = res.data.data;
      setQuestions(qs);
      setStartedAt(new Date(sAt));
      restoreSavedProgress(qs);
    } catch (err) {
      setLoadError(err.response?.data?.error || 'Failed to load questions. Check your connection and refresh.');
    } finally {
      setLoading(false);
    }
  };

  // ── Answer selection & clearing ───────────────────────────────────────────
  const handleAnswer = useCallback((questionId, idx) => {
    setAnswers((prev) => {
      const next = { ...prev };
      if (idx === null || idx === undefined) {
        delete next[questionId]; // deselect / clear choice
      } else {
        next[questionId] = idx; // select or modify choice
      }
      return next;
    });
  }, []);

  // ── Clear saved progress ──────────────────────────────────────────────────
  const clearSavedProgress = () => {
    if (progressKey) {
      try { localStorage.removeItem(progressKey); } catch { /* noop */ }
    }
    if (bookmarkKey) {
      try { localStorage.removeItem(bookmarkKey); } catch { /* noop */ }
    }
  };

  // ── Core Submit execution (API call) ────────────────────────────────────
  const executeSubmit = useCallback(async (isDisqualified = false) => {
    if (hasSubmitted.current) return;
    hasSubmitted.current = true;
    setSubmitting(true);
    clearSavedProgress();

    const elapsed = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
      : levelConfig.timeSeconds;

    // Build answers array; unanswered questions get -1
    const answersArray = questions.map((q) => ({
      questionId:    q._id,
      selectedIndex: answers[q._id] ?? -1,
    }));

    try {
      const res = await submitQuiz({
        mobile:         student.mobile,
        level:          levelNum,
        answers:        answersArray,
        timeTaken:      elapsed,
        isDisqualified: Boolean(isDisqualified),
      });
      const result = res.data.data;
      setLastResult({ ...result, isDisqualified: Boolean(isDisqualified || result.isDisqualified) });

      // Update context so student object has updated totals
      updateStudent({
        currentLevel:   result.nextLevel ?? student.currentLevel,
        status:         isDisqualified ? 'eliminated' : result.status,
        totalScore:     result.totalScore,
        totalTimeTaken: result.totalTimeTaken,
      });

      if (result.passed && result.nextLevel && !isDisqualified) {
        navigate('/level-up');
      } else {
        navigate('/results');
      }
    } catch (err) {
      hasSubmitted.current = false;
      setSubmitting(false);

      // 409 = already submitted → treat as success and navigate
      if (err.response?.status === 409) {
        navigate('/results');
        return;
      }
      setToast({ type: 'error', message: 'Submission failed. Please try again.', duration: 5000 });
    }
  }, [answers, questions, startedAt, levelNum, student, navigate, setLastResult, updateStudent, levelConfig]);

  // ── Manual Submit Click (with Unattempted Questions Check) ───────────────
  const handleManualSubmit = () => {
    const answeredCount = Object.keys(answers).length;
    const unattempted = questions.length - answeredCount;
    if (unattempted > 0) {
      setShowUnattemptedModal(true);
    } else {
      executeSubmit();
    }
  };

  const handleGoBackAndReview = () => {
    setShowUnattemptedModal(false);
    // Jump to the first unattempted question for convenience
    const firstUnansweredIdx = questions.findIndex(
      (q) => answers[q._id] === undefined || answers[q._id] === null || answers[q._id] === -1
    );
    if (firstUnansweredIdx !== -1) {
      setCurrentIndex(firstUnansweredIdx);
    }
  };

  const handleSubmitAnyway = () => {
    setShowUnattemptedModal(false);
    executeSubmit();
  };

  // Auto-submit when level timer fires
  const handleTimeUp = useCallback(() => {
    setToast({ type: 'warning', message: "Time's up! Submitting your answers…", duration: 2000 });
    setTimeout(() => executeSubmit(), 2000);
  }, [executeSubmit]);

  // ── Tab-Switching & Visibility Monitoring ───────────────────────────────
  useEffect(() => {
    if (loading || submitting || hasSubmitted.current) return;

    let lastSwitchTime = 0;

    const handleSwitchViolation = () => {
      if (hasSubmitted.current) return;
      const now = Date.now();
      if (now - lastSwitchTime < 800) return; // Debounce blur + visibilitychange
      lastSwitchTime = now;

      setTabSwitchCount((prev) => {
        const nextCount = prev + 1;
        if (student?.mobile) {
          try {
            localStorage.setItem(`quiz_tab_switches_${student.mobile}`, String(nextCount));
          } catch { /* noop */ }
        }

        if (nextCount >= 10) {
          // Mark this session as anti-cheat terminated — blocks detailed review
          if (student?.mobile) {
            try {
              localStorage.setItem(`quiz_anti_cheated_${student.mobile}`, '1');

              // Immediately record isDisqualified: true in LocalStorage attempt history
              const HISTORY_STORAGE_KEY = 'quiz_attempts_history';
              const existing = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
              const attemptId = `${student.mobile}_${levelNum}_${student.totalScore || 0}_${student.totalTimeTaken || 0}`;
              const alreadySaved = existing.some((a) => a.id === attemptId);
              if (!alreadySaved) {
                const newRecord = {
                  id: attemptId,
                  attemptDate: new Date().toISOString(),
                  studentName: student.name || 'Student',
                  mobile: student.mobile,
                  branch: student.branch || '',
                  levelReached: levelNum,
                  totalScore: student.totalScore || 0,
                  maxPossible: 50,
                  accuracyPct: 0,
                  totalTimeTaken: student.totalTimeTaken || 0,
                  timeFormatted: '00:00',
                  status: 'eliminated',
                  isDisqualified: true,
                };
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([newRecord, ...existing].slice(0, 30)));
              } else {
                const updated = existing.map((a) => (a.id === attemptId ? { ...a, isDisqualified: true } : a));
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
              }
            } catch { /* noop */ }
          }
          setIsAntiCheatTerminal(true);
          setShowAntiCheatModal(true);
          executeSubmit(true);
        } else {
          setShowAntiCheatModal(true);
        }
        return nextCount;
      });
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleSwitchViolation();
      }
    };

    const handleWindowBlur = () => {
      handleSwitchViolation();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [loading, submitting, student?.mobile, executeSubmit]);

  // Handle confirmed exit
  const handleConfirmExit = () => {
    if (student?.mobile) {
      try { localStorage.removeItem(`quiz_tab_switches_${student.mobile}`); } catch { /* noop */ }
    }
    clearSavedProgress();
    clearStudent();
    navigate('/');
  };

  // ── Render states ─────────────────────────────────────────────────────────
  if (!student || !levelConfig) return null;

  if (loading) {
    return (
      <div className="centered-page">
        <div className="spinner" />
        <p className="loading-text">Loading your questions…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="centered-page">
        <p className="error-icon">⚠️</p>
        <p className="error-text">{loadError}</p>
        <button className="btn btn-primary" onClick={loadQuestions}>Try Again</button>
      </div>
    );
  }

  const currentQuestion = questions[currentIndex];
  const answeredCount   = Object.keys(answers).length;
  const canGoPrev       = currentIndex > 0;
  const canGoNext       = currentIndex < questions.length - 1;
  const allAnswered     = answeredCount === questions.length;

  return (
    <div className="quiz-page">
      {/* ── Sticky header with overall level timer ── */}
      <header className="quiz-header">
        <div className="quiz-header-left">
          <span className="quiz-level-badge">{levelConfig.label}</span>
          <span className="quiz-student-name">{student.name}</span>
        </div>
        {startedAt && (
          <TimerBar
            totalSeconds={levelConfig.timeSeconds}
            startedAt={startedAt}
            onTimeUp={handleTimeUp}
          />
        )}
      </header>

      {/* ── Progress bar ── */}
      <ProgressBar
        current={currentIndex + 1}
        total={questions.length}
        answered={answeredCount}
      />

      {/* ── Question card (slides in on change) ── */}
      {currentQuestion && (
        <QuestionCard
          key={currentQuestion._id}
          question={currentQuestion}
          selectedIndex={answers[currentQuestion._id] ?? null}
          onAnswer={(idx) => handleAnswer(currentQuestion._id, idx)}
          questionNumber={currentIndex + 1}
          isBookmarked={!!bookmarks[currentQuestion._id]}
          onToggleBookmark={handleToggleBookmark}
        />
      )}

      {/* ── Interactive Question Palette Grid (1 to N) ── */}
      <QuestionPalette
        questions={questions}
        currentIndex={currentIndex}
        answers={answers}
        bookmarks={bookmarks}
        onSelectQuestion={(i) => setCurrentIndex(i)}
      />

      {/* ── Bottom Controls: Left ThemeToggle (above Prev), Right Exit (above Next) ── */}
      <div className="quiz-bottom-controls">
        <div className="quiz-bottom-left">
          <ThemeToggle />
        </div>
        <div className="quiz-bottom-right">
          <button
            className="exit-quiz-btn"
            onClick={() => setShowExitModal(true)}
            title="Exit Quiz"
            aria-label="Exit Quiz"
          >
            🚪 Exit
          </button>
        </div>
      </div>

      {/* ── Navigation ── */}
      <nav className="quiz-nav">
        <button
          className="btn btn-secondary"
          onClick={() => setCurrentIndex((i) => i - 1)}
          disabled={!canGoPrev || submitting}
        >
          ← Prev
        </button>

        <span className="quiz-answered-count">
          {answeredCount}/{questions.length} answered
        </span>

        {canGoNext ? (
          <button
            className="btn btn-primary"
            onClick={() => setCurrentIndex((i) => i + 1)}
            disabled={submitting}
          >
            Next →
          </button>
        ) : (
          <button
            id="submit-quiz-btn"
            className="btn btn-submit"
            onClick={handleManualSubmit}
            disabled={submitting}
          >
            {submitting
              ? <><span className="btn-spinner" /> Submitting…</>
              : allAnswered ? 'Submit Quiz ✓' : `Submit (${answeredCount}/${questions.length})`
            }
          </button>
        )}
      </nav>

      <ExitConfirmModal
        isOpen={showExitModal}
        onConfirm={handleConfirmExit}
        onCancel={() => setShowExitModal(false)}
      />

      <AntiCheatModal
        isOpen={showAntiCheatModal}
        count={tabSwitchCount}
        maxLimit={10}
        isLimitReached={isAntiCheatTerminal}
        onAcknowledge={() => setShowAntiCheatModal(false)}
        onTerminalProceed={() => navigate('/results')}
      />

      <UnattemptedWarningModal
        isOpen={showUnattemptedModal}
        unattemptedCount={questions.length - answeredCount}
        level={levelNum}
        onGoBack={handleGoBackAndReview}
        onSubmitAnyway={handleSubmitAnyway}
        submitting={submitting}
      />

      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          duration={toast.duration}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
}
