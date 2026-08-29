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
import QuestionTimer from '../components/QuestionTimer';

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

  // Storage key for auto-saving progress
  const progressKey = student?.mobile ? `quiz_progress_${student.mobile}_${levelNum}` : null;

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
  };

  // ── Submit (manual or auto via timer) ────────────────────────────────────
  const handleSubmit = useCallback(async (isAutoSubmit = false) => {
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
        mobile:    student.mobile,
        level:     levelNum,
        answers:   answersArray,
        timeTaken: elapsed,
      });
      const result = res.data.data;
      setLastResult(result);

      // Update context so student object has updated totals
      updateStudent({
        currentLevel: result.nextLevel ?? student.currentLevel,
        status:       result.status,
        totalScore:   result.totalScore,
        totalTimeTaken: result.totalTimeTaken,
      });

      if (result.passed && result.nextLevel) {
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

  // Auto-submit when level timer fires
  const handleTimeUp = useCallback(() => {
    setToast({ type: 'warning', message: "Time's up! Submitting your answers…", duration: 2000 });
    setTimeout(() => handleSubmit(true), 2000);
  }, [handleSubmit]);

  // Per-question timer auto-advance (30 seconds per question)
  const handleQuestionTimeUp = useCallback(() => {
    if (currentIndex < questions.length - 1) {
      setToast({ type: 'warning', message: 'Question timer expired! Moving to next question…', duration: 1500 });
      setCurrentIndex((i) => i + 1);
    } else {
      setToast({ type: 'warning', message: 'Question timer expired! Submitting level…', duration: 1500 });
      handleSubmit(true);
    }
  }, [currentIndex, questions.length, handleSubmit]);

  // Handle confirmed exit
  const handleConfirmExit = () => {
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

      {/* ── Visual Per-Question Pace Indicator (No auto-move) ── */}
      {!loading && currentQuestion && (
        <QuestionTimer
          durationSeconds={30}
          questionIndex={currentIndex}
        />
      )}

      {/* ── Question card (slides in on change) ── */}
      {currentQuestion && (
        <QuestionCard
          key={currentQuestion._id}
          question={currentQuestion}
          selectedIndex={answers[currentQuestion._id] ?? null}
          onAnswer={(idx) => handleAnswer(currentQuestion._id, idx)}
          questionNumber={currentIndex + 1}
        />
      )}

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
            onClick={() => handleSubmit(false)}
            disabled={submitting}
          >
            {submitting
              ? <><span className="btn-spinner" /> Submitting…</>
              : allAnswered ? 'Submit Quiz ✓' : `Submit (${answeredCount}/${questions.length})`
            }
          </button>
        )}
      </nav>

      {/* Question dot navigator */}
      <div className="question-dots" aria-label="Question navigator">
        {questions.map((q, i) => (
          <button
            key={q._id}
            className={`dot${i === currentIndex ? ' dot-current' : ''}${answers[q._id] !== undefined ? ' dot-answered' : ''}`}
            onClick={() => setCurrentIndex(i)}
            aria-label={`Question ${i + 1}${answers[q._id] !== undefined ? ' (answered)' : ''}`}
            title={`Q${i + 1}`}
          />
        ))}
      </div>

      <ExitConfirmModal
        isOpen={showExitModal}
        onConfirm={handleConfirmExit}
        onCancel={() => setShowExitModal(false)}
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
