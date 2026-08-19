import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuiz } from '../context/QuizContext';
import { getQuestions, submitQuiz } from '../api';
import { LEVELS } from '../config';
import QuestionCard from '../components/QuestionCard';
import TimerBar from '../components/TimerBar';
import ProgressBar from '../components/ProgressBar';
import Toast from '../components/Toast';

export default function Quiz() {
  const { level: levelParam } = useParams();
  const levelNum = parseInt(levelParam, 10);
  const levelConfig = LEVELS[levelNum];
  const navigate = useNavigate();
  const { student, updateStudent, setLastResult } = useQuiz();

  const [questions, setQuestions]       = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers]           = useState({});   // { questionId: selectedIndex }
  const [loading, setLoading]           = useState(true);
  const [loadError, setLoadError]       = useState(null);
  const [submitting, setSubmitting]     = useState(false);
  const [toast, setToast]               = useState(null);
  const [startedAt, setStartedAt]       = useState(null);

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

  // ── Submit (manual or auto via timer) ────────────────────────────────────
  const handleSubmit = useCallback(async (isAutoSubmit = false) => {
    if (hasSubmitted.current) return;
    hasSubmitted.current = true;
    setSubmitting(true);

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

  // Auto-submit when timer fires
  const handleTimeUp = useCallback(() => {
    setToast({ type: 'warning', message: "Time's up! Submitting your answers…", duration: 2000 });
    setTimeout(() => handleSubmit(true), 2000);
  }, [handleSubmit]);

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
      {/* ── Sticky header with timer ── */}
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
        />
      )}

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
