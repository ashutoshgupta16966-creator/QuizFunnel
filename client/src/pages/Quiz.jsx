import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { getQuestions, getRoomQuestions, submitQuiz } from '../api';
import { joinStudentRoomSocket, emitStudentProgress, emitStudentDisqualified } from '../utils/socket';
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
import GuidanceDrawer, { GUIDES } from '../components/GuidanceDrawer';

const MAX_TAB_SWITCH_ALLOWED = 4;

export default function Quiz() {
  const { level: levelParam } = useParams();
  const isPlayRoute = !levelParam || levelParam === 'play';
  const { student, updateStudent, setLastResult, clearStudent, isRoomQuiz, roomSession, clearRoomSession } = useQuiz();
  const levelNum = isPlayRoute ? (student?.currentLevel || 1) : parseInt(levelParam, 10);
  const levelConfig = LEVELS[levelNum] || LEVELS[1];
  const navigate = useNavigate();

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
  const [isRoomClosed, setIsRoomClosed] = useState(false);
  const [quizSubject, setQuizSubject]   = useState('');
  const [quizUnit, setQuizUnit]         = useState('');
  const [showGuide, setShowGuide]       = useState(false);

  const displaySubject = quizSubject || roomSession?.subject || '';
  const displayUnit    = quizUnit || roomSession?.unit || '';

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
        const stored = parseInt(localStorage.getItem(`quiz_tab_switches_${student.mobile}`) || '0', 10);
        return Math.min(Math.max(stored, 0), MAX_TAB_SWITCH_ALLOWED);
      }
    } catch { /* noop */ }
    return 0;
  });
  const [showAntiCheatModal, setShowAntiCheatModal] = useState(false);
  const [isAntiCheatTerminal, setIsAntiCheatTerminal] = useState(false);

  // ── Unique Idempotent Attempt ID for current quiz run ─────────────────────
  const activeAttemptId = useRef(
    (() => {
      try {
        const storageKey = student?.mobile ? `quiz_active_attempt_${student.mobile}_lvl${levelNum}` : null;
        let existingId = storageKey ? sessionStorage.getItem(storageKey) : null;
        if (!existingId) {
          existingId = `att_${student?.mobile || 'cand'}_lvl${levelNum}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
          if (storageKey) sessionStorage.setItem(storageKey, existingId);
        }
        return existingId;
      } catch {
        return `att_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
      }
    })()
  );

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

  // Prevent double-submit (timer + manual button race + tab switch)
  const hasSubmitted = useRef(false);

  // ── Guard: redirect if student isn't supposed to be here ─────────────────
  useEffect(() => {
    if (!student) { navigate('/'); return; }
    if (!levelConfig) { navigate('/'); return; }
    if (student.status === 'eliminated' || student.status === 'completed') {
      navigate('/results'); return;
    }
    if (!isPlayRoute && student.currentLevel !== levelNum) {
      navigate(`/quiz/${student.currentLevel}`); return;
    }
    loadQuestions();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelNum, isPlayRoute]);

  // ── Sync with Live Room Socket (Only if isRoomQuiz === true) ─────────────
  useEffect(() => {
    if (isRoomQuiz && roomSession?.roomCode && student?.mobile) {
      const cleanup = joinStudentRoomSocket(roomSession.roomCode, student, {
        onRoomClosed: () => {
          setIsRoomClosed(true);
        },
      });
      emitStudentProgress({
        roomCode: roomSession.roomCode,
        mobile: student.mobile,
        currentLevel: levelNum,
        score: student.totalScore || 0,
        status: 'in-progress',
      });
      return cleanup;
    }
  }, [isRoomQuiz, roomSession?.roomCode, student, levelNum]);

  // ── Scroll Lock when Room Closed Modal is Active ────────────────────────
  useEffect(() => {
    if (isRoomClosed) {
      const prevOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = prevOverflow;
      };
    }
  }, [isRoomClosed]);

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
      const res = await getQuestions(levelNum, student.mobile, roomSession?.roomCode);
      const { questions: qs, startedAt: sAt, subject: resSub, unit: resUn } = res.data.data;
      setQuestions(qs);
      if (resSub) setQuizSubject(resSub);
      if (resUn) setQuizUnit(resUn);
      setStartedAt(new Date(sAt));
      restoreSavedProgress(qs);
    } catch (err) {
      // If room quiz and standard questions endpoint had an error, fallback to getRoomQuestions
      if (isRoomQuiz && roomSession?.roomCode) {
        try {
          const roomRes = await getRoomQuestions(roomSession.roomCode, levelNum);
          const { questions: qs, subject: resSub, unit: resUn } = roomRes.data.data;
          if (Array.isArray(qs) && qs.length > 0) {
            setQuestions(qs);
            if (resSub) setQuizSubject(resSub);
            if (resUn) setQuizUnit(resUn);
            setStartedAt(new Date());
            restoreSavedProgress(qs);
            return;
          }
        } catch (fallbackErr) {
          console.warn('Fallback getRoomQuestions failed:', fallbackErr.message);
        }
      }
      setLoadError(err.response?.data?.error || 'Failed to load questions. Check your connection and refresh.');
    } finally {
      setLoading(false);
    }
  };

  // ── Answer selection & clearing ───────────────────────────────────────────
  const handleAnswer = useCallback((questionId, val) => {
    if (isRoomClosed || isAntiCheatTerminal || hasSubmitted.current) return;
    setAnswers((prev) => {
      const next = { ...prev };
      if (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) {
        delete next[questionId]; // deselect / clear choice
      } else {
        next[questionId] = val; // select or modify choice (number index or direct string)
      }
      return next;
    });
  }, [isRoomClosed, isAntiCheatTerminal]);

  // Helper to check if a question has been answered (supports MCQ index and direct string)
  const isQuestionAnswered = useCallback((qId) => {
    const a = answers[qId];
    if (a === undefined || a === null || a === -1) return false;
    if (typeof a === 'string' && a.trim() === '') return false;
    return true;
  }, [answers]);

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
    if (hasSubmitted.current || isRoomClosed) return;
    hasSubmitted.current = true;
    setSubmitting(true);
    clearSavedProgress();

    const elapsed = startedAt
      ? Math.floor((Date.now() - startedAt.getTime()) / 1000)
      : levelConfig.timeSeconds;

    // Build answers array supporting both MCQ and Direct question formats
    const answersArray = questions.map((q) => {
      const val = answers[q._id];
      const isDirect = q.questionType === 'direct' || (!q.options || q.options.length === 0);

      if (isDirect) {
        return {
          questionId: q._id,
          questionType: 'direct',
          directAnswer: typeof val === 'string' ? val.trim() : (val !== null && val !== undefined ? String(val).trim() : ''),
          selectedIndex: -1,
        };
      }

      return {
        questionId: q._id,
        questionType: 'mcq',
        selectedIndex: typeof val === 'number' ? val : -1,
      };
    });

    try {
      const res = await submitQuiz({
        mobile:          student.mobile,
        level:           levelNum,
        answers:         answersArray,
        timeTaken:       elapsed,
        isDisqualified:  Boolean(isDisqualified),
        isRoom:          Boolean(isRoomQuiz),
        roomCode:        roomSession?.roomCode || '',
        activeAttemptId: activeAttemptId.current,
      });
      const result = res.data.data;
      setLastResult({ ...result, isDisqualified: Boolean(isDisqualified || result.isDisqualified) });

      // Update context so student object has updated totals
      updateStudent({
        currentLevel:   result.nextLevel ?? student.currentLevel,
        status:         isDisqualified ? 'disqualified' : result.status,
        totalScore:     result.totalScore,
        totalTimeTaken: result.totalTimeTaken,
      });

      // Emit real-time progress update to host if room session
      if (isRoomQuiz && roomSession?.roomCode) {
        emitStudentProgress({
          roomCode:       roomSession.roomCode,
          mobile:         student.mobile,
          currentLevel:   levelNum,
          score:          result.totalScore ?? 0,
          timeTaken:      result.totalTimeTaken ?? elapsed,
          status:         isDisqualified ? 'disqualified' : (result.passed ? (result.nextLevel ? 'advanced' : 'completed') : 'eliminated'),
          isDisqualified: Boolean(isDisqualified),
        });
      }

      if (result.passed && result.nextLevel && !isDisqualified) {
        navigate('/level-up');
      } else {
        navigate('/results');
      }
    } catch (err) {
      hasSubmitted.current = false;
      setSubmitting(false);

      console.error('[executeSubmit Error]:', err.response?.data || err.message || err);

      // 409 = already submitted → treat as success and navigate
      if (err.response?.status === 409) {
        navigate('/results');
        return;
      }
      const errorMsg = err.response?.data?.error || err.message || 'Submission failed. Please try again.';
      setToast({ type: 'error', message: errorMsg, duration: 6000 });
    }
  }, [answers, questions, startedAt, levelNum, student, navigate, setLastResult, updateStudent, levelConfig, isRoomQuiz, roomSession]);

  // ── Manual Submit Click (with Unattempted Questions Check) ───────────────
  const handleManualSubmit = () => {
    if (isRoomClosed) return;
    const answeredCount = questions.filter((q) => isQuestionAnswered(q._id)).length;
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
    const firstUnansweredIdx = questions.findIndex((q) => !isQuestionAnswered(q._id));
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
      if (hasSubmitted.current || isAntiCheatTerminal) return;
      const now = Date.now();
      if (now - lastSwitchTime < 800) return; // Debounce blur + visibilitychange
      lastSwitchTime = now;

      setTabSwitchCount((prev) => {
        const nextCount = prev + 1;
        const clampedCount = Math.min(nextCount, MAX_TAB_SWITCH_ALLOWED);
        if (student?.mobile) {
          try {
            localStorage.setItem(`quiz_tab_switches_${student.mobile}`, String(clampedCount));
          } catch { /* noop */ }
        }

        if (nextCount >= MAX_TAB_SWITCH_ALLOWED) {
          // Exact 4th detection (if switchCount >= 4): immediately stop quiz timers, invalidate input handlers, route to disqualification flow without execution lag
          hasSubmitted.current = true;
          setIsAntiCheatTerminal(true);
          setShowAntiCheatModal(true);

          if (student?.mobile) {
            try {
              localStorage.setItem(`quiz_anti_cheated_${student.mobile}`, '1');

              // If active in a live room, notify room host via socket immediately
              if (isRoomQuiz && roomSession?.roomCode) {
                emitStudentDisqualified({
                  roomCode: roomSession.roomCode,
                  mobile:   student.mobile,
                });
              }

              // Immediately record isDisqualified: true in LocalStorage attempt history
              const HISTORY_STORAGE_KEY = 'quiz_attempts_history';
              const existing = JSON.parse(localStorage.getItem(HISTORY_STORAGE_KEY) || '[]');
              const attemptId = activeAttemptId.current || `${student.mobile}_lvl${levelNum}_${student.totalScore || 0}_${student.totalTimeTaken || 0}`;
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
                  status: 'disqualified',
                  isDisqualified: true,
                  isRoom: Boolean(isRoomQuiz),
                  roomCode: roomSession?.roomCode || '',
                  quizType: isRoomQuiz ? 'room' : 'normal',
                };
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([newRecord, ...existing].slice(0, 30)));
              } else {
                const updated = existing.map((a) => (a.id === attemptId ? {
                  ...a,
                  status: 'disqualified',
                  isDisqualified: true,
                  isRoom: Boolean(isRoomQuiz || a.isRoom),
                  roomCode: roomSession?.roomCode || a.roomCode || '',
                  quizType: isRoomQuiz ? 'room' : (a.quizType || 'normal'),
                } : a));
                localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
              }
            } catch { /* noop */ }
          }

          executeSubmit(true);
          return clampedCount;
        } else {
          // Switches 1 to (MAX-1): Trigger warning toast displaying remaining attempts
          setToast({
            type: 'warning',
            message: `Warning ${clampedCount}/${MAX_TAB_SWITCH_ALLOWED}: Switching tabs is monitored. ${MAX_TAB_SWITCH_ALLOWED}th switch will auto-disqualify.`,
            duration: 4000,
          });
          setShowAntiCheatModal(true);
          return clampedCount;
        }
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
  }, [loading, submitting, student?.mobile, executeSubmit, isRoomQuiz, roomSession]);

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
          {isRoomQuiz && roomSession?.roomCode && (
            <span className="quiz-room-tag">🏫 Room: {roomSession.roomCode}</span>
          )}
          <span className="quiz-student-name">{student.name}</span>
          <ThemeToggle />
          <button
            type="button"
            className="guidance-pill"
            onClick={() => setShowGuide(true)}
            title="View Quiz Solving Guide & Instructions"
          >
            ℹ️ Guide
          </button>
        </div>
        {startedAt && (
          <TimerBar
            totalSeconds={levelConfig.timeSeconds}
            startedAt={startedAt}
            onTimeUp={handleTimeUp}
            isPaused={isAntiCheatTerminal || submitting || hasSubmitted.current}
          />
        )}
      </header>

      <GuidanceDrawer
        isOpen={showGuide}
        onClose={() => setShowGuide(false)}
        guide={GUIDES.quiz}
      />

      {/* ── Progress bar ── */}
      <ProgressBar
        current={currentIndex + 1}
        total={questions.length}
        answered={answeredCount}
      />

      {/* ── Subject & Unit Metadata Info Banner ── */}
      {(displaySubject || displayUnit) && (
        <div className="quiz-subject-unit-banner" role="region" aria-label="Topic Information">
          <div className="quiz-banner-inner">
            {displaySubject && (
              <span className="quiz-banner-item quiz-banner-subject">
                <span className="quiz-banner-icon">📚</span>
                <span className="quiz-banner-label">Subject:</span>
                <strong className="quiz-banner-value">{displaySubject}</strong>
              </span>
            )}
            {displaySubject && displayUnit && <span className="quiz-banner-dot" aria-hidden>•</span>}
            {displayUnit && (
              <span className="quiz-banner-item quiz-banner-unit">
                <span className="quiz-banner-icon">📖</span>
                <span className="quiz-banner-label">Unit/Topic:</span>
                <span className="quiz-banner-value">{displayUnit}</span>
              </span>
            )}
          </div>
        </div>
      )}

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
        count={Math.min(tabSwitchCount, MAX_TAB_SWITCH_ALLOWED)}
        maxLimit={MAX_TAB_SWITCH_ALLOWED}
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

      {/* ── Room Closed Modal Overlay ── */}
      {isRoomClosed && (
        <div className="modal-backdrop room-closed-backdrop" role="dialog" aria-modal="true">
          <div className="modal-content room-closed-modal-content">
            <div className="room-closed-icon">🚪</div>
            <h2 className="room-closed-title">The Host has ended this room session. 🚪</h2>
            <p className="room-closed-desc">
              The administrator has closed this live quiz room. Active answering is disabled and your session has ended.
            </p>
            <button
              type="button"
              className="btn btn-primary room-closed-return-btn"
              onClick={() => {
                document.body.style.overflow = '';
                if (clearRoomSession) clearRoomSession();
                if (clearStudent) clearStudent();
                navigate('/');
              }}
            >
              OK / Return to Home
            </button>
          </div>
        </div>
      )}

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
